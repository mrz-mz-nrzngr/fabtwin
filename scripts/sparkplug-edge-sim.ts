/**
 * Sparkplug B edge-node simulator. One MQTT client per bay plays an edge node, with the bay's tools
 * as devices. It sends the real thing: NBIRTH and DBIRTH, DDATA on change, sequence numbers 0 to 255,
 * a bdSeq metric, an NDEATH will message, and a rebirth when it receives Node Control/Rebirth.
 * The lots, tools and measurements come from scripts/lib/minifab.ts. Nothing here is hardware.
 *
 *   BROKER=mqtt://127.0.0.1:18830 GROUP=FabTwin npm run sparkplug-sim
 *   KILL_NODE=Etch KILL_AT=40 REVIVE_AT=70   drops one edge node's connection to show NDEATH and the rebirth
 */
import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import { DataType, decodePayload, encodePayload } from "../src/integrations/sparkplug/proto";
import type { Metric } from "../src/integrations/sparkplug/proto";
import { DEMO_TOOLS, MiniFab } from "./lib/minifab";
import type { FabTool } from "./lib/minifab";

const BROKER = process.env.BROKER ?? "mqtt://127.0.0.1:18830";
const GROUP = process.env.GROUP ?? "FabTwin";
const SEED = Number(process.env.SEED ?? 11);
const DURATION = Number(process.env.DURATION ?? 0);
const KILL_NODE = process.env.KILL_NODE ?? "";
const KILL_AT = Number(process.env.KILL_AT ?? 0);
const REVIVE_AT = Number(process.env.REVIVE_AT ?? 0);

const NODE_OF: Record<string, string> = { LITHO: "Litho", ETCH: "Etch", DEP: "Dep", CMP: "Cmp", METRO: "Metro" };

const s = (name: string, value: string): Metric => ({ name, datatype: DataType.String, value, timestamp: Date.now() });
const b = (name: string, value: boolean): Metric => ({ name, datatype: DataType.Boolean, value, timestamp: Date.now() });
const d = (name: string, value: number): Metric => ({ name, datatype: DataType.Double, value, timestamp: Date.now() });
const i64 = (name: string, value: number): Metric => ({ name, datatype: DataType.Int64, value, timestamp: Date.now() });

interface DeviceState {
  state: string;
  lotId: string;
  recipe: string;
  route: string;
  stepIndex: number;
}

class EdgeNode {
  client!: MqttClient;
  seq = 0;
  bdSeq = -1;
  devices = new Map<string, DeviceState>();
  alive = false;
  /** Set once the node has been dropped on purpose, so a revived node is not dropped again. */
  killed = false;

  constructor(readonly id: string, readonly tools: FabTool[]) {
    for (const t of tools) this.devices.set(t.id, { state: "STANDBY", lotId: "", recipe: "", route: "", stepIndex: 0 });
  }

  private nextSeq(): number {
    const v = this.seq;
    this.seq = (this.seq + 1) % 256;
    return v;
  }

  private topic(type: string, device?: string) {
    return `spBv1.0/${GROUP}/${type}/${this.id}${device ? `/${device}` : ""}`;
  }

  connect() {
    this.bdSeq = (this.bdSeq + 1) % 256;
    const will = encodePayload({ metrics: [i64("bdSeq", this.bdSeq)] });
    this.client = mqtt.connect(BROKER, {
      clientId: `fabtwin-edge-${this.id}-${process.pid}`,
      clean: true,
      will: { topic: this.topic("NDEATH"), payload: Buffer.from(will), qos: 1, retain: false },
      reconnectPeriod: 0,
    });
    this.client.on("connect", () => {
      this.client.subscribe(this.topic("NCMD"), { qos: 1 });
      this.birth();
      this.alive = true;
      console.log(`[${this.id}] connected, NBIRTH bdSeq=${this.bdSeq}`);
    });
    this.client.on("message", (_t, payload) => {
      const p = decodePayload(payload);
      if (p.metrics.some((m) => m.name === "Node Control/Rebirth" && m.value === true)) {
        console.log(`[${this.id}] rebirth requested`);
        this.birth();
      }
    });
    this.client.on("error", (e) => console.error(`[${this.id}] ${e.message}`));
  }

  private birth() {
    this.seq = 0;
    this.client.publish(this.topic("NBIRTH"), Buffer.from(encodePayload({ timestamp: Date.now(), seq: this.nextSeq(), metrics: [i64("bdSeq", this.bdSeq), b("Node Control/Rebirth", false)] })), { qos: 0 });
    for (const [id, st] of this.devices) {
      this.client.publish(this.topic("DBIRTH", id), Buffer.from(encodePayload({ timestamp: Date.now(), seq: this.nextSeq(), metrics: this.fullMetrics(st) })), { qos: 0 });
    }
  }

  private fullMetrics(st: DeviceState): Metric[] {
    return [s("State", st.state), s("LotId", st.lotId), s("Recipe", st.recipe), s("Route", st.route), i64("StepIndex", st.stepIndex)];
  }

  data(deviceId: string, metrics: Metric[]) {
    if (!this.alive) return;
    this.client.publish(this.topic("DDATA", deviceId), Buffer.from(encodePayload({ timestamp: Date.now(), seq: this.nextSeq(), metrics })), { qos: 0 });
  }

  kill() {
    this.alive = false;
    this.killed = true;
    this.client.end(true);
    console.log(`[${this.id}] connection dropped without DISCONNECT, the broker publishes the NDEATH will`);
  }
}

const nodes = new Map<string, EdgeNode>();
for (const [bay, name] of Object.entries(NODE_OF)) nodes.set(bay, new EdgeNode(name, DEMO_TOOLS.filter((t) => t.bay === bay)));
nodes.forEach((n) => n.connect());

const fab = new MiniFab(
  { tools: DEMO_TOOLS, seed: SEED, releaseEveryS: 14, maxWip: 18, mtbfS: 900, repairS: 22 },
  {
    onStart(tool, lot, recipe) {
      const n = nodes.get(tool.bay)!;
      const st = n.devices.get(tool.id)!;
      Object.assign(st, { state: "PRODUCTIVE", lotId: lot.id, recipe, route: lot.route.id, stepIndex: lot.step });
      n.data(tool.id, [s("Recipe", recipe), s("Route", lot.route.id), i64("StepIndex", lot.step), s("LotId", lot.id), s("State", "PRODUCTIVE")]);
      return 8 + Math.random() * 8;
    },
    onFinish(tool, lot) {
      const n = nodes.get(tool.bay)!;
      const st = n.devices.get(tool.id)!;
      Object.assign(st, { state: "STANDBY", lotId: "" });
      void lot;
      n.data(tool.id, [...pendingMeasure.splice(0).filter((m) => m.tool === tool.id).map((m) => m.metric), s("State", "STANDBY"), s("LotId", "")]);
    },
    onPhase(tool, phase, reason) {
      const n = nodes.get(tool.bay)!;
      n.devices.get(tool.id)!.state = phase;
      n.data(tool.id, [s("State", phase)]);
      console.log(`[${n.id}] ${tool.id} -> ${phase} (${reason})`);
    },
    onAlarm(tool, code, active, text) {
      nodes.get(tool.bay)!.data(tool.id, [b(`Alarm/critical/${code}`, active)]);
      console.log(`[${nodes.get(tool.bay)!.id}] ${tool.id} alarm ${code} ${active ? "SET" : "CLEARED"}: ${text}`);
    },
    onMeasure(tool, param, value) {
      pendingMeasure.push({ tool: tool.id, metric: d(`Measurement/${param}`, value) });
    },
  },
);
const pendingMeasure: Array<{ tool: string; metric: Metric }> = [];
const stop = fab.run(500);

const started = Date.now();
const timer = setInterval(() => {
  const el = (Date.now() - started) / 1000;
  const victim = nodes.get(Object.keys(NODE_OF).find((k) => NODE_OF[k] === KILL_NODE) ?? "");
  if (KILL_NODE && KILL_AT && el >= KILL_AT && victim?.alive && !victim.killed) victim.kill();
  if (KILL_NODE && REVIVE_AT && el >= REVIVE_AT) {
    if (victim && !victim.alive && !victim.client.connected && !victim.client.reconnecting) victim.connect();
  }
  if (DURATION && el >= DURATION) {
    clearInterval(timer);
    stop();
    nodes.forEach((n) => n.client.end());
    console.log(`done after ${Math.round(el)} s, ${fab.shipped} lots shipped by the flow`);
  }
}, 1000);

console.log(`Sparkplug B edge simulator: ${nodes.size} edge nodes, ${DEMO_TOOLS.length} devices, group ${GROUP}, broker ${BROKER}`);
