import { describe, expect, it } from "vitest";
import { buildConfig } from "./config";
import { FabEngine } from "./engine";
import { buildReport, runAutopilot } from "./report";
import { scoreOf } from "./score";

describe("shift report", () => {
  const seed = 4;
  const player = new FabEngine(buildConfig(seed));
  for (const bay of ["LITHO", "ETCH", "DEP", "CMP", "METRO"] as const) player.apply({ type: "setRule", bay, rule: "CR" });
  player.advanceTo(player.cfg.shiftS);
  const report = buildReport(player);

  it("compares the player against an autopilot run of the same seed", () => {
    const ap = runAutopilot(seed);
    expect(report.autopilot.kpi.shipped).toBe(ap.kpi().shipped);
    expect(report.autopilot.score).toBe(ap.snapshot().score);
    expect(report.kpi.avgHotCtS!).toBeLessThan(report.autopilot.kpi.avgHotCtS!);
  });

  it("explains the result with drivers backed by numbers, and itemises the score", () => {
    expect(report.drivers.length).toBeGreaterThanOrEqual(4);
    for (const d of report.drivers) expect(d.detail).toMatch(/\d/);
    expect(report.score.lines.reduce((a, l) => a + l.points, 0)).toBe(report.score.total);
    expect(report.score.total).toBe(player.snapshot().score);
  });

  it("only counts end-of-shift objective bonuses once the shift has ended", () => {
    const e = new FabEngine(buildConfig(seed));
    e.advanceTo(100);
    const s = e.snapshot();
    expect(scoreOf(s.kpi, s.objectives, false).lines.find((l) => l.label === "Queue-time objective")!.points).toBe(0);
    expect(s.score).toBe(0);
  });

  it("carries a replay that reproduces the shift", () => {
    expect(report.replay.commands.length).toBe(5);
    const again = new FabEngine(buildConfig(report.replay.seed));
    for (const c of report.replay.commands) {
      again.advanceTo(c.t);
      again.apply(c.cmd);
    }
    again.advanceTo(again.cfg.shiftS);
    expect(again.snapshot().score).toBe(report.score.total);
  });
});
