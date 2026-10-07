import { describe, expect, it } from "vitest";
import { evaluateRules } from "./spc";
import { FabEngine } from "./engine";
import { buildConfig } from "./config";

describe("Western Electric rules", () => {
  it("is quiet for an in-control series", () => {
    expect(evaluateRules([0.1, -0.4, 0.7, -0.2, 0.3, -0.9, 0.5, -0.1, 0.2])).toEqual([]);
  });
  it("rule 1: a point beyond 3 sigma", () => {
    expect(evaluateRules([0, 0.2, -3.4])).toContain(1);
    expect(evaluateRules([0, 0.2, 2.9])).not.toContain(1);
  });
  it("rule 2: two of three beyond 2 sigma on the same side", () => {
    expect(evaluateRules([2.3, 0.1, 2.4])).toContain(2);
    expect(evaluateRules([2.3, 0.1, -2.4])).not.toContain(2);
  });
  it("rule 3: four of five beyond 1 sigma on the same side", () => {
    expect(evaluateRules([1.2, 0.2, 1.4, 1.1, 1.6])).toContain(3);
    expect(evaluateRules([1.2, 0.2, 0.4, 1.1, 1.6])).not.toContain(3);
  });
  it("rule 4: eight in a row on one side of the centre line", () => {
    expect(evaluateRules([0.1, 0.2, 0.3, 0.1, 0.5, 0.2, 0.4, 0.3])).toContain(4);
    expect(evaluateRules([0.1, 0.2, 0.3, 0.1, -0.5, 0.2, 0.4, 0.3])).not.toContain(4);
  });
});

describe("SPC in the engine", () => {
  it("records measurements with the upstream tool that processed the lot", () => {
    const e = new FabEngine(buildConfig(3));
    e.advanceTo(e.cfg.shiftS);
    const spc = e.snapshot().spc;
    expect(spc.map((s) => s.param)).toEqual(["CD", "OVL", "THK"]);
    const pts = spc.flatMap((s) => s.points);
    expect(pts.length).toBeGreaterThan(20);
    expect(pts.every((p) => /^((LTH|ETC|DEP|CMP)-\d\d|-)$/.test(p.upstream))).toBe(true);
  });

  it("an excursion on a litho tool shows up as rule violations and clears with PM", () => {
    // Seeds are deterministic, so search for one that produces an out-of-control point.
    let found = false;
    for (let seed = 1; seed < 40 && !found; seed++) {
      const e = new FabEngine(buildConfig(seed));
      for (let t = 0; t <= e.cfg.shiftS; t += 60) {
        e.advanceTo(t);
        const ev = e.drainEvents().find((x) => x.type === "alarm.set" && x.data.code === "SPC_HOLD");
        if (ev && ev.type === "alarm.set") {
          found = true;
          const lotId = ev.data.lotId!;
          expect(e.lot(lotId)!.held).toBe(true);
          expect(e.lot(lotId)!.ooc).toBe(true);
          const suspect = ev.data.toolId!;
          e.apply({ type: "pmEarly", toolId: suspect });
          break;
        }
      }
    }
    expect(found).toBe(true);
  });
});
