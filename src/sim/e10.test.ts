import { describe, expect, it } from "vitest";
import type { E10State, FabEvent } from "@/events/types";
import { E10_STATES } from "@/events/types";
import { buildConfig } from "./config";
import { canTransition } from "./e10";
import { FabEngine } from "./engine";
import { quietConfig } from "./testing";

type StateEvent = Extract<FabEvent, { type: "equipment.state_changed" }>;
const stateEvents = (evs: FabEvent[], tool?: string) =>
  evs.filter((e): e is StateEvent => e.type === "equipment.state_changed" && (!tool || e.data.toolId === tool));

describe("E10 transition table", () => {
  it("forbids staying put and the jumps that make no physical sense", () => {
    for (const s of E10_STATES) expect(canTransition(s, s)).toBe(false);
    expect(canTransition("UNSCHEDULED_DOWN", "PRODUCTIVE")).toBe(false);
    expect(canTransition("ENGINEERING", "PRODUCTIVE")).toBe(false);
    expect(canTransition("STANDBY", "PRODUCTIVE")).toBe(true);
    expect(canTransition("SCHEDULED_DOWN", "ENGINEERING")).toBe(true);
  });
});

describe("E10 states in the engine", () => {
  it("starts every tool in STANDBY", () => {
    const e = new FabEngine(quietConfig());
    for (const t of e.cfg.tools) expect(e.tool(t.id).state).toBe("STANDBY");
  });

  it("goes STANDBY -> SCHEDULED_DOWN (setup) -> PRODUCTIVE -> STANDBY for a lot that needs a setup", () => {
    const cfg = quietConfig(2);
    const e = new FabEngine(cfg);
    e.drainEvents();
    e.injectLot("PWR-12", 0);
    e.advanceTo(1200);
    const lith = stateEvents(e.drainEvents()).filter((x) => x.data.toolId.startsWith("LTH"));
    const chain = lith.map((x) => `${x.data.from}>${x.data.to}:${x.data.reason}`);
    expect(chain.slice(0, 3)).toEqual(["STANDBY>SCHEDULED_DOWN:setup", "SCHEDULED_DOWN>PRODUCTIVE:process", "PRODUCTIVE>STANDBY:idle"]);
  });

  it("failure drives PRODUCTIVE -> UNSCHEDULED_DOWN -> ENGINEERING -> STANDBY and resumes the lot", () => {
    const cfg = quietConfig(2);
    const e = new FabEngine(cfg);
    const id = e.injectLot("PWR-12", 0);
    e.advanceTo(100);
    const toolId = e.lot(id)!.toolId!;
    expect(e.tool(toolId).state).toBe("PRODUCTIVE");
    e.drainEvents();
    e.forceFailure(toolId);
    expect(e.tool(toolId).state).toBe("UNSCHEDULED_DOWN");
    expect(e.tool(toolId).crew).toBe("assigned");
    e.advanceTo(cfg.shiftS);
    const chain = stateEvents(e.drainEvents(), toolId)
      .slice(0, 3)
      .map((x) => `${x.data.from}>${x.data.to}`);
    expect(chain).toEqual(["PRODUCTIVE>UNSCHEDULED_DOWN", "UNSCHEDULED_DOWN>ENGINEERING", "ENGINEERING>STANDBY"]);
    expect(e.kpi().shipped).toBe(1);
  });

  it("holds a failed tool down until a crew exists", () => {
    const cfg = quietConfig(2, { crewSize: 0 });
    const e = new FabEngine(cfg);
    e.forceFailure("ETC-01");
    e.advanceTo(cfg.shiftS);
    expect(e.tool("ETC-01").state).toBe("UNSCHEDULED_DOWN");
    expect(e.tool("ETC-01").crew).toBe("waiting");
  });

  it("runs PM as SCHEDULED_DOWN then ENGINEERING then STANDBY", () => {
    const cfg = quietConfig(2);
    const e = new FabEngine(cfg);
    e.drainEvents();
    expect(e.apply({ type: "pmEarly", toolId: "DEP-02" }).ok).toBe(true);
    expect(e.tool("DEP-02").state).toBe("SCHEDULED_DOWN");
    e.advanceTo(cfg.shiftS);
    const chain = stateEvents(e.drainEvents(), "DEP-02").map((x) => `${x.data.from}>${x.data.to}:${x.data.reason}`);
    expect(chain).toEqual(["STANDBY>SCHEDULED_DOWN:pm", "SCHEDULED_DOWN>ENGINEERING:post-pm qual", "ENGINEERING>STANDBY:qualified"]);
  });

  it("refuses PM on a tool that is down", () => {
    const e = new FabEngine(quietConfig(2, { crewSize: 0 }));
    e.forceFailure("CMP-01");
    const r = e.apply({ type: "pmEarly", toolId: "CMP-01" });
    expect(r.ok).toBe(false);
  });

  it("only ever emits legal transitions, and each event starts where the last one ended, across a full shift", () => {
    const e = new FabEngine(buildConfig(11));
    const last = new Map<string, E10State>();
    let n = 0;
    for (let t = 0; t <= e.cfg.shiftS; t += 50) {
      e.advanceTo(t);
      for (const ev of stateEvents(e.drainEvents())) {
        const { toolId, from, to } = ev.data;
        if (from === null) expect(last.has(toolId)).toBe(false);
        else {
          expect(last.get(toolId)).toBe(from);
          expect(canTransition(from, to), `${toolId} ${from}>${to}`).toBe(true);
        }
        last.set(toolId, to);
        n++;
      }
    }
    expect(n).toBeGreaterThan(200);
    const visited = new Set(last.values());
    expect(visited.size).toBeGreaterThan(1);
  });

  it("splits time exactly: state times add up to elapsed time", () => {
    const e = new FabEngine(buildConfig(5));
    e.advanceTo(9000);
    for (const t of e.snapshot().tools) {
      const sum = Object.values(t.stateTime).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(9000, 3);
    }
  });
});
