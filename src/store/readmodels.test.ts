import { describe, expect, it } from "vitest";
import { buildConfig } from "@/sim/config";
import { FabEngine } from "@/sim/engine";
import { applyEvents, emptyModels } from "./readmodels";

describe("event read models", () => {
  const cfg = buildConfig(13);
  const e = new FabEngine(cfg);
  e.advanceTo(cfg.shiftS);
  const events = e.drainEvents();
  const m = applyEvents(emptyModels(cfg.epochMs), events);

  it("builds contiguous Gantt segments per tool that end where the next begins", () => {
    for (const t of cfg.tools) {
      const segs = m.gantt[t.id];
      expect(segs.length).toBeGreaterThan(1);
      for (let i = 1; i < segs.length; i++) expect(segs[i - 1].to).toBe(segs[i].from);
      expect(segs[segs.length - 1].to).toBeNull();
    }
  });

  it("pairs alarm set and clear and keeps severities", () => {
    expect(m.alarms.length).toBeGreaterThan(10);
    expect(m.alarms.some((a) => a.clearedT !== null)).toBe(true);
    for (const a of m.alarms) if (a.clearedT !== null) expect(a.clearedT).toBeGreaterThanOrEqual(a.setT);
  });

  it("builds a genealogy for a shipped lot that starts at release or track-in and ends shipped", () => {
    const shipped = Object.entries(m.lotIndex).find(([, v]) => v.shippedAt !== undefined)!;
    const h = m.lotHistory[shipped[0]];
    expect(h[h.length - 1].kind).toBe("shipped");
    expect(h.filter((x) => x.kind === "track-in").length).toBe(h.filter((x) => x.kind === "track-out").length);
  });

  it("is copy-on-write: the previous model is untouched", () => {
    const base = emptyModels(cfg.epochMs);
    const next = applyEvents(base, events.slice(0, 50));
    expect(base.eventCount).toBe(0);
    expect(next.eventCount).toBe(50);
    expect(base.alarms).toHaveLength(0);
  });
});
