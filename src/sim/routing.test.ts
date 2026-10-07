import { describe, expect, it } from "vitest";
import { BAYS, RECIPES, ROUTES } from "./config";
import { FabEngine } from "./engine";
import { quietConfig } from "./testing";

describe("routes", () => {
  it("have 12 to 20 steps and every step names a known recipe", () => {
    for (const r of ROUTES) {
      expect(r.steps.length).toBeGreaterThanOrEqual(12);
      expect(r.steps.length).toBeLessThanOrEqual(20);
      for (const s of r.steps) expect(RECIPES[s.recipe], `${r.id} ${s.recipe}`).toBeDefined();
    }
  });

  it("are re-entrant: every route visits lithography at least three times", () => {
    for (const r of ROUTES) {
      const litho = r.steps.filter((s) => RECIPES[s.recipe].bay === "LITHO").length;
      expect(litho, r.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("covers every bay and the mix sums to one", () => {
    const used = new Set(ROUTES.flatMap((r) => r.steps.map((s) => RECIPES[s.recipe].bay)));
    for (const b of BAYS) expect(used.has(b.id)).toBe(true);
    expect(ROUTES.reduce((a, r) => a + r.mix, 0)).toBeCloseTo(1, 6);
  });
});

describe("routing through the engine", () => {
  it("walks a lot through every step in order and ships it", () => {
    const cfg = quietConfig(3);
    const e = new FabEngine(cfg);
    const id = e.injectLot("PWR-12", 0);
    e.advanceTo(cfg.shiftS);
    const events = e.drainEvents();
    const starts = events.filter((x) => x.type === "lot.started" && x.data.lotId === id);
    const route = cfg.routes.find((r) => r.id === "PWR-12")!;
    expect(starts.map((x) => (x.type === "lot.started" ? x.data.recipe : ""))).toEqual(route.steps.map((s) => s.recipe));
    const completes = events.filter((x) => x.type === "lot.completed" && x.data.lotId === id);
    expect(completes).toHaveLength(route.steps.length);
    expect(completes.map((x) => (x.type === "lot.completed" ? x.data.stepIndex : -1))).toEqual(route.steps.map((_, i) => i));
    const last = completes[completes.length - 1];
    expect(last.type === "lot.completed" && last.data.final).toBe(true);
    expect(e.kpi().shipped).toBe(1);
    expect(e.lot(id)).toBeUndefined();
  });

  it("runs each step on a tool of the right bay", () => {
    const cfg = quietConfig(4);
    const e = new FabEngine(cfg);
    e.injectLot("LOGIC-16", 0);
    e.advanceTo(cfg.shiftS);
    const bayOf = new Map(cfg.tools.map((t) => [t.id, t.bay]));
    for (const ev of e.drainEvents()) {
      if (ev.type === "lot.started") expect(bayOf.get(ev.data.toolId)).toBe(RECIPES[ev.data.recipe].bay);
    }
  });

  it("returns a lot to lithography on re-entry", () => {
    const cfg = quietConfig(5);
    const e = new FabEngine(cfg);
    const id = e.injectLot("SOC-20", 0);
    e.advanceTo(cfg.shiftS);
    const litho = e
      .drainEvents()
      .filter((x) => x.type === "lot.started" && x.data.lotId === id && x.data.recipe.startsWith("LITH"));
    expect(litho).toHaveLength(5);
  });
});
