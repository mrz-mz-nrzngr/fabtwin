/**
 * Headless live-mode client. It runs the same source code and LiveTwin the browser uses, so a run
 * proves an integration end to end without a browser. Prints a one-line summary every few seconds.
 *
 *   tsx scripts/live-probe.ts ws ws://127.0.0.1:8787 [seconds]
 *   tsx scripts/live-probe.ts sparkplug ws://127.0.0.1:18831 [seconds] [group]
 */
import { LiveTwin } from "../src/live/twin";
import { createWsSource } from "../src/live/sources";
import type { LiveSource, SourceHandlers } from "../src/live/sources";
import { createSparkplugSource } from "../src/integrations/sparkplug/source";
import type { FabEvent } from "../src/events/types";

const [kind = "ws", url = "ws://127.0.0.1:8787", secondsArg = "30", group = ""] = process.argv.slice(2);
const seconds = Number(secondsArg);
const twin = new LiveTwin();
const counts: Record<string, number> = {};
let rejected = 0;
const seen: string[] = [];

const handlers: SourceHandlers = {
  onEvents: (events: FabEvent[]) => {
    twin.apply(events);
    for (const e of events) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      if (seen.length < 400 && (e.type !== "collection_event" || e.data.ceid !== 1010)) {
        const d = e.data as unknown as Record<string, unknown>;
        seen.push(`${e.type} ${String(d.toolId ?? "")} ${String(d.lotId ?? "")} ${e.type === "equipment.state_changed" ? `${String(d.from)}->${String(d.to)}` : String(d.code ?? d.name ?? "")}`.trim());
      }
    }
  },
  onState: (id, state, detail) => console.log(`source ${id}: ${state}${detail ? ` (${detail})` : ""}`),
  onRejected: (_id, errs) => {
    rejected += errs.length;
    console.log(`rejected: ${errs[0]}`);
  },
};

const urls = url.split(",");
const sources: LiveSource[] = kind === "sparkplug" ? [createSparkplugSource({ kind: "sparkplug", urls, sparkplug: { groupId: group } }, handlers)] : urls.map((u) => createWsSource(u, handlers));
sources.forEach((s) => s.connect());

const started = Date.now();
const timer = setInterval(() => {
  const s = twin.snapshot();
  const states: Record<string, number> = {};
  for (const t of s.tools) states[t.state] = (states[t.state] ?? 0) + 1;
  const moving = s.vehicles.filter((v) => v.phase !== "idle").length;
  console.log(
    `t=${Math.round((Date.now() - started) / 1000)}s events ${JSON.stringify(counts)} rejected ${rejected} | tools ${JSON.stringify(states)} | wip ${s.kpi.wip} shipped ${s.kpi.shipped} thr ${s.kpi.throughputPerHr.toFixed(1)}/h ct ${s.kpi.avgCtS === null ? "-" : Math.round(s.kpi.avgCtS)}s util ${(s.kpi.avgUtil * 100).toFixed(0)}% | vehicles moving ${moving} | spc ${s.spc.map((x) => x.points.length).join("/")} | ignored ${twin.stats.ignoredTools.join(",") || "-"}`,
  );
  if ((Date.now() - started) / 1000 >= seconds) {
    clearInterval(timer);
    sources.forEach((x) => x.close());
    console.log("--- sample of the events received ---");
    console.log(seen.slice(0, 14).join("\n"));
    process.exit(0);
  }
}, 5000);
