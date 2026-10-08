import { describe, expect, it } from "vitest";
import { FabEngine } from "@/sim/engine";
import { buildConfig, EPOCH_MS } from "@/sim/config";
import { foupPhase } from "@/sim/motion";
import { LiveTwin } from "./twin";
import type { FabEvent } from "@/events/types";

let seq = 0;
const ev = (t: number, type: FabEvent["type"], data: object): FabEvent => ({ v: 1, seq: ++seq, t: EPOCH_MS + t * 1000, source: "test", type, data }) as FabEvent;

describe("LiveTwin", () => {
  it("ships a lot through a known route and updates KPIs", () => {
    const tw = new LiveTwin(buildConfig(1));
    tw.apply([ev(0, "collection_event", { ceid: 1001, name: "LotReleased", lotId: "L1", reports: { route: "PWR-12", hot: false } })], 1000);
    tw.apply([ev(10, "lot.started", { lotId: "L1", toolId: "LTH-01", stepIndex: 0, recipe: "LITH-ACT", route: "PWR-12" })], 2000);
    let s = tw.snapshot(2000);
    expect(s.kpi.wip).toBe(1);
    expect(s.lots[0].status).toBe("transit");
    s = tw.snapshot(2000 + 5000);
    expect(s.lots[0].loc).toEqual({ k: "tool", id: "LTH-01" });
    tw.apply([ev(170, "lot.completed", { lotId: "L1", toolId: "LTH-01", stepIndex: 0, recipe: "LITH-ACT", durationS: 160, final: false, route: "PWR-12" })], 3000);
    s = tw.snapshot(3000);
    const v = s.vehicles.find((x) => x.jobLotId === "L1")!;
    expect(v).toBeTruthy();
    expect(v.plan.length).toBe(4);
    expect(foupPhase(v, v.liftT0! + 1).phase).toBe("lift");
    expect(foupPhase(v, v.lowerT0! + 1).phase).toBe("lower");
    expect(s.lots[0].step).toBe(1);
    // Final step ships the lot.
    tw.apply([ev(900, "lot.completed", { lotId: "L1", toolId: "ETC-01", stepIndex: 11, recipe: "MET-CD", durationS: 100, final: true, route: "PWR-12" })], 4000);
    s = tw.snapshot(4000);
    expect(s.kpi.shipped).toBe(1);
    expect(s.kpi.wip).toBe(0);
    expect(s.kpi.avgCtS).toBeCloseTo(900, 0);
    expect(s.kpi.xFactor).toBeGreaterThan(0);
  });

  it("counts events for tools it does not know and drops them", () => {
    const tw = new LiveTwin(buildConfig(1));
    tw.apply([ev(0, "equipment.state_changed", { toolId: "XYZ-99", from: null, to: "PRODUCTIVE" })]);
    expect(tw.stats.ignoredTools).toEqual(["XYZ-99"]);
  });

  it("reproduces the simulator's own KPIs and tool states from its event stream", () => {
    const cfg = buildConfig(2);
    const e = new FabEngine(cfg);
    const all: FabEvent[] = [];
    const tw = new LiveTwin(cfg);
    for (let t = 0; t <= 5400; t += 60) {
      e.advanceTo(t);
      const evs = e.drainEvents();
      all.push(...evs);
      tw.apply(evs, 1000 + t * 1000);
    }
    const sim = e.snapshot();
    const live = tw.snapshot(1000 + 5400 * 1000);
    expect(live.kpi.shipped).toBe(sim.kpi.shipped);
    for (const t of sim.tools) expect(live.tools.find((x) => x.id === t.id)!.state).toBe(t.state);
    expect(live.kpi.throughputPerHr).toBeGreaterThan(0);
    expect(live.vehicles.length).toBe(14);
  });
});
