import { describe, expect, it } from "vitest";
import type { FabEvent } from "@/events/types";
import { CEID } from "@/events/types";
import { FabEngine } from "./engine";
import { quietConfig } from "./testing";

const qtEvents = (evs: FabEvent[]) => evs.filter((e) => e.type === "collection_event" && e.data.ceid === CEID.QT_VIOLATION);

describe("queue-time limits", () => {
  it("flags a violation, raises an alarm and counts it when the next tool never becomes free", () => {
    const cfg = quietConfig(7, { crewSize: 0 });
    const e = new FabEngine(cfg);
    const id = e.injectLot("PWR-12", 0);
    for (const t of cfg.tools.filter((x) => x.bay === "ETCH")) e.forceFailure(t.id);
    e.advanceTo(2000);
    const evs = e.drainEvents();
    const qt = qtEvents(evs);
    expect(qt).toHaveLength(1);
    expect(qt[0].type === "collection_event" && qt[0].data.lotId).toBe(id);
    const limit = cfg.routes[0].steps[1].qtS!;
    expect(qt[0].type === "collection_event" && qt[0].data.reports?.limitS).toBe(limit);
    expect(qt[0].type === "collection_event" && Number(qt[0].data.reports?.waitedS)).toBeGreaterThanOrEqual(limit);
    expect(evs.some((x) => x.type === "alarm.set" && x.data.code === "QT_VIOLATION" && x.data.lotId === id)).toBe(true);
    expect(e.kpi().qtViolations).toBe(1);
    expect(e.lot(id)!.qtViolations).toBe(1);
  });

  it("warns at 75 percent of the allowance before it violates", () => {
    const cfg = quietConfig(7, { crewSize: 0 });
    const e = new FabEngine(cfg);
    const id = e.injectLot("PWR-12", 0);
    for (const t of cfg.tools.filter((x) => x.bay === "ETCH")) e.forceFailure(t.id);
    e.advanceTo(2000);
    const evs = e.drainEvents();
    const warn = evs.findIndex((x) => x.type === "alarm.set" && x.data.code === "QT_RISK" && x.data.lotId === id);
    const viol = evs.findIndex((x) => x.type === "alarm.set" && x.data.code === "QT_VIOLATION");
    expect(warn).toBeGreaterThanOrEqual(0);
    expect(warn).toBeLessThan(viol);
  });

  it("does not flag a lot that starts in time, and clears the clock at track-in", () => {
    const cfg = quietConfig(7);
    const e = new FabEngine(cfg);
    e.injectLot("PWR-12", 0);
    e.advanceTo(5000);
    expect(qtEvents(e.drainEvents())).toHaveLength(0);
    expect(e.kpi().qtViolations).toBe(0);
  });

  it("charges a re-clean: the violating step takes longer", () => {
    const run = (down: boolean) => {
      const cfg = quietConfig(9, { crewSize: down ? 1 : 3 });
      const e = new FabEngine(cfg);
      const id = e.injectLot("PWR-12", 1);
      if (down) for (const t of cfg.tools.filter((x) => x.bay === "ETCH")) e.forceFailure(t.id);
      e.advanceTo(cfg.shiftS);
      const evs = e.drainEvents();
      const done = evs.find((x) => x.type === "lot.completed" && x.data.lotId === id && x.data.stepIndex === 1);
      return done?.type === "lot.completed" ? done.data.durationS : 0;
    };
    expect(run(true)).toBeGreaterThan(run(false) * 1.05);
  });

  it("reports an active queue-time clock on the lot view", () => {
    const cfg = quietConfig(7, { crewSize: 0 });
    const e = new FabEngine(cfg);
    const id = e.injectLot("PWR-12", 0);
    for (const t of cfg.tools.filter((x) => x.bay === "ETCH")) e.forceFailure(t.id);
    e.advanceTo(800);
    const v = e.lot(id)!;
    expect(v.qtLeft).not.toBeNull();
    expect(v.qtLeft!).toBeLessThan(cfg.routes[0].steps[1].qtS!);
  });
});
