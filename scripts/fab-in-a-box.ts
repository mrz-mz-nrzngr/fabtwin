/**
 * Fab in a box: a small fab of real SECS/GEM equipment simulators driving FabTwin's live mode.
 *
 *   GemBench equipment (one process per tool, HSMS)  <--S2F41 START/FINISH, S1F3-->  this host (MES)
 *        |  GemBench's own FabTwin bridge, one WebSocket per tool
 *        v
 *   this host enriches lot events with the MES's route knowledge  -->  ws://localhost:8787  -->  FabTwin live mode
 *
 * The equipment speaks real HSMS and GEM. The host plays the MES: it releases lots, dispatches each
 * step to an idle tool with a remote command, reads metrology results with S1F3, and raises tool
 * faults with GemBench's test stimuli. GemBench's bridge turns what the equipment does into FabTwin
 * events. GEM has no idea which step of a route a lot is on, so this host adds route, step, hot and
 * the final flag, plus LotReleased and LotShipped collection events (docs/EVENT_SCHEMA.md).
 *
 *   GEMBENCH_DIR=/path/to/built/gembench npm run fab-in-a-box     (see scripts/fab-in-a-box.sh)
 *   env: HUB_PORT=8787 STEP_S=10 DURATION=0 SEED=5 KEEP=1
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { EventHub } from "./lib/hub";
import { CEID, SCHEMA_VERSION } from "../src/events/types";
import type { FabEvent } from "../src/events/types";
import { A, HsmsHost } from "./lib/hsms";
import { SVID, equipmentYaml } from "./lib/gem-equipment";
import type { GemTool, ToolKind } from "./lib/gem-equipment";
import { MiniFab } from "./lib/minifab";
import type { FabLot, FabTool } from "./lib/minifab";
import { RECIPES } from "../src/sim/config";

const HUB_PORT = Number(process.env.HUB_PORT ?? 8787);
const STEP_S = Number(process.env.STEP_S ?? 10);
const DURATION = Number(process.env.DURATION ?? 0);
const SEED = Number(process.env.SEED ?? 5);
const GEMBENCH_DIR = process.env.GEMBENCH_DIR ?? "";
const dll = process.env.GEMBENCH_DLL ?? join(GEMBENCH_DIR, "src/GemBench.Cli/bin/Release/net10.0/gembench.dll");
if (!existsSync(dll)) {
  console.error(`GemBench is not built. Expected ${dll}. Run scripts/fab-in-a-box.sh, or set GEMBENCH_DIR to a built GemBench checkout.`);
  process.exit(2);
}

const PLAN: Array<[string, ToolKind]> = [
  ["LTH-01", "litho"],
  ["LTH-02", "litho"],
  ["ETC-01", "etch"],
  ["ETC-02", "etch"],
  ["DEP-01", "dep"],
  ["CMP-01", "cmp"],
  ["MET-01", "metro"],
  ["MET-02", "metro"],
];
const BAY = { litho: "LITHO", etch: "ETCH", dep: "DEP", cmp: "CMP", metro: "METRO" } as const;
const tools: GemTool[] = PLAN.map(([id, kind], i) => ({ id, kind, hsmsPort: 5101 + i, wsPort: 8801 + i }));
const fabTools: FabTool[] = tools.map((t) => ({ id: t.id, bay: BAY[t.kind] }));

const dir = join(tmpdir(), "fabtwin-fab-in-a-box");
mkdirSync(dir, { recursive: true });
const children: ChildProcess[] = [];
const say = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

let stopping = false;
function shutdown(code = 0) {
  stopping = true;
  for (const c of children) if (c.pid) c.kill("SIGTERM");
  hub?.close();
  setTimeout(() => process.exit(code), 400);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// ---------------------------------------------------------------- hub WebSocket (what FabTwin connects to)
const hub = new EventHub(HUB_PORT, (n) => say(`FabTwin connected to the hub (${n} client${n === 1 ? "" : "s"})`));
let mesSeq = 0;
const publish = (events: FabEvent[]) => hub.publish(events);

const mes = (type: FabEvent["type"], data: object): FabEvent => ({ v: SCHEMA_VERSION, seq: ++mesSeq, t: Date.now(), source: "fab-in-a-box-mes", type, data }) as FabEvent;

// ---------------------------------------------------------------- the MES's knowledge of what runs where
interface Assignment {
  lot: FabLot;
  recipe: string;
  step: number;
  final: boolean;
  measurement?: { param: string; value: number; unit: string };
}
const queue = new Map<string, Assignment[]>();
const hsms = new Map<string, HsmsHost>();
const releasedAt = new Map<string, number>();
let shippedCount = 0;

function enrich(raw: FabEvent): FabEvent {
  const d = raw.data as unknown as Record<string, unknown>;
  const toolId = String(d.toolId ?? "");
  const out = { ...raw, source: `gembench:${toolId || "unknown"}` } as FabEvent;
  const q = queue.get(toolId) ?? [];
  if (raw.type === "lot.started") {
    const a = q[0];
    if (a) Object.assign(out.data, { route: a.lot.route.id, stepIndex: a.step, hot: a.lot.hot, wafers: 25 });
  } else if (raw.type === "lot.completed") {
    const a = q.shift();
    if (a) Object.assign(out.data, { route: a.lot.route.id, stepIndex: a.step, hot: a.lot.hot, final: a.final, ...(a.measurement ? { measurement: a.measurement } : {}) });
    if (a?.final) {
      shippedCount++;
      const ct = (Date.now() - (releasedAt.get(a.lot.id) ?? Date.now())) / 1000;
      queueMicrotask(() => publish([mes("collection_event", { ceid: CEID.LOT_SHIPPED, name: "LotShipped", lotId: a.lot.id, reports: { cycleTimeS: Math.round(ct), onTime: true, oocEscape: false } })]));
      say(`lot ${a.lot.id} shipped (${a.lot.route.id}, ${Math.round(ct)} s in the fab, ${shippedCount} total)`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- start the equipment
async function startEquipment() {
  for (const t of tools) {
    const file = join(dir, `${t.id}.yaml`);
    writeFileSync(file, equipmentYaml(t, SEED + t.hsmsPort));
    const p = spawn("dotnet", [dll, "equipment", "--config", file, "--fabtwin-port", String(t.wsPort), "--quiet"], { stdio: ["ignore", "ignore", "inherit"] });
    children.push(p);
    p.on("exit", (code) => {
      if (!stopping && code) say(`equipment ${t.id} exited with ${code}`);
    });
  }
  say(`started ${tools.length} GemBench equipment simulators (HSMS ports ${tools[0].hsmsPort}-${tools[tools.length - 1].hsmsPort}), config in ${dir}`);
  for (const t of tools) {
    const h = new HsmsHost("127.0.0.1", t.hsmsPort);
    for (let i = 0; ; i++) {
      try {
        await h.connect();
        break;
      } catch {
        if (i > 80) throw new Error(`equipment ${t.id} never accepted an HSMS connection`);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    await h.select();
    await h.goOnline();
    hsms.set(t.id, h);
  }
  say("all equipment selected and online (S1F13, S1F17), control state Online Remote");
  for (const t of tools) await connectBridge(t);
}

function connectBridge(t: GemTool): Promise<void> {
  return new Promise((resolve) => {
    const open = (n: number) => {
      const ws = new WebSocket(`ws://127.0.0.1:${t.wsPort}`);
      ws.on("open", () => resolve());
      ws.on("message", (m) => {
        const parsed = JSON.parse(m.toString()) as { events: FabEvent[] };
        publish(parsed.events.map(enrich));
      });
      ws.on("error", () => (n < 60 ? setTimeout(() => open(n + 1), 250) : resolve()));
    };
    open(0);
  });
}

// ---------------------------------------------------------------- the flow
async function main() {
  await startEquipment();
  const rnd = (() => {
    let a = SEED;
    return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();
  const fab: MiniFab = new MiniFab(
    { tools: fabTools, seed: SEED, releaseEveryS: 16, maxWip: 14, stepS: STEP_S, mtbfS: 700, repairS: 22 },
    {
      onRelease(lot) {
        releasedAt.set(lot.id, Date.now());
        publish([mes("collection_event", { ceid: CEID.LOT_RELEASED, name: "LotReleased", lotId: lot.id, reports: { route: lot.route.id, hot: lot.hot } })]);
      },
      onStart(tool, lot, recipe) {
        const a: Assignment = { lot, recipe, step: lot.step, final: lot.step >= lot.route.steps.length - 1 };
        queue.set(tool.id, [...(queue.get(tool.id) ?? []), a]);
        const dur = STEP_S * (0.7 + 0.6 * rnd());
        void (async () => {
          const h = hsms.get(tool.id)!;
          let hcack = -1;
          for (let attempt = 0; attempt < 4 && hcack !== 0; attempt++) {
            hcack = await h.command("START", { LotID: A(lot.id), RecipeName: A(recipe) });
            if (hcack !== 0) await new Promise((r) => setTimeout(r, 700));
          }
          if (hcack !== 0) say(`START refused by ${tool.id}, HCACK ${hcack}`);
          await new Promise((r) => setTimeout(r, dur * 1000));
          const param = RECIPES[recipe]?.measures;
          if (param) {
            const v = await h.readSv(SVID[param]);
            if (typeof v === "number") a.measurement = { param, value: Math.round(v * 1000) / 1000, unit: "nm" };
          }
          await h.command("FINISH");
          // The equipment resets itself to idle one second after FINISH (processing state model). Do not dispatch before that.
          await new Promise((r) => setTimeout(r, 1300));
          fab.finish(tool.id);
        })().catch((e: Error) => say(`flow error on ${tool.id}: ${e.message}`));
        return undefined;
      },
      onFinish() {},
      onAlarm(tool, _code, active) {
        const h = hsms.get(tool.id)!;
        void h.command(active ? "GB_RAISE_ALARM" : "GB_CLEAR_ALARM", { ALID: { t: "U4", v: 1001 } }).then((r) => say(`${tool.id} chamber fault ${active ? "raised" : "cleared"} (S2F41, HCACK ${r})`));
      },
    },
  );
  fab.run(500);
  say(`MES flow running. FabTwin live mode: ws://localhost:${HUB_PORT}`);
  const started = Date.now();
  const ticker = setInterval(() => {
    say(`wip ${fab.wip}, shipped ${shippedCount}, ${hub.forwarded} events forwarded to ${hub.clients} client(s)`);
    if (DURATION && (Date.now() - started) / 1000 >= DURATION) {
      clearInterval(ticker);
      say("duration reached, stopping");
      for (const h of hsms.values()) h.close();
      shutdown(0);
    }
  }, 10000);
}

main().catch((e: Error) => {
  console.error(e.message);
  shutdown(1);
});
