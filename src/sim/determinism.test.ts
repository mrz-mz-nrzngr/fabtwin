import { describe, expect, it } from "vitest";
import { buildConfig } from "./config";
import { FabEngine, runShift } from "./engine";
import type { Command } from "./types";

function trace(seed: number, step: number, cmds: Array<{ t: number; cmd: Command }> = []) {
  const e = new FabEngine(buildConfig(seed));
  const events: unknown[] = [];
  const pending = [...cmds].sort((a, b) => a.t - b.t);
  for (let t = 0; t <= e.cfg.shiftS; t += step) {
    while (pending.length && pending[0].t <= t) {
      e.advanceTo(pending[0].t);
      e.apply(pending.shift()!.cmd);
    }
    e.advanceTo(t);
    events.push(...e.drainEvents());
  }
  e.advanceTo(e.cfg.shiftS);
  events.push(...e.drainEvents());
  return { events, snap: e.snapshot() };
}

describe("determinism", () => {
  it("same seed gives the same shift, event for event", () => {
    const a = trace(42, 60);
    const b = trace(42, 60);
    expect(a.events.length).toBeGreaterThan(1000);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.snap)).toBe(JSON.stringify(b.snap));
  });

  it("different seeds give different shifts", () => {
    const a = trace(42, 600);
    const b = trace(43, 600);
    expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(b.events));
  });

  it("does not depend on how the clock is chopped into steps", () => {
    const a = trace(7, 1);
    const b = trace(7, 937);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.snap.kpi)).toBe(JSON.stringify(b.snap.kpi));
  });

  it("replays a command log to the same result", () => {
    const cmds: Array<{ t: number; cmd: Command }> = [
      { t: 600, cmd: { type: "setRule", bay: "LITHO", rule: "CR" } },
      { t: 900, cmd: { type: "setRule", bay: "ETCH", rule: "EDD" } },
      { t: 1500, cmd: { type: "pmEarly", toolId: "LTH-02" } },
    ];
    const live = new FabEngine(buildConfig(5));
    for (const c of cmds) {
      live.advanceTo(c.t);
      live.apply(c.cmd);
    }
    live.advanceTo(live.cfg.shiftS);
    const replay = runShift(buildConfig(5), live.commandLog.map(({ t, cmd }) => ({ t, cmd })));
    expect(JSON.stringify(replay.snapshot())).toBe(JSON.stringify(live.snapshot()));
  });

  it("keeps a failure the same failure when the player acts elsewhere", () => {
    const failTimes = (cmds: Array<{ t: number; cmd: Command }>) => {
      const { events } = trace(9, 100, cmds);
      return (events as Array<{ type: string; t: number; data: { toolId?: string; to?: string; reason?: string } }>)
        .filter((e) => e.type === "equipment.state_changed" && e.data.reason === "failure")
        .map((e) => `${e.data.toolId}`)
        .slice(0, 3);
    };
    const base = failTimes([]);
    const acted = failTimes([{ t: 200, cmd: { type: "setRule", bay: "DEP", rule: "EDD" } }]);
    expect(base.length).toBeGreaterThan(0);
    expect(acted[0]).toBe(base[0]);
  });
});
