import { describe, expect, it } from "vitest";
import { FabEngine } from "./engine";
import { quietConfig } from "./testing";

describe("player commands", () => {
  it("changes a bay's dispatch rule and rejects a no-op", () => {
    const e = new FabEngine(quietConfig());
    expect(e.apply({ type: "setRule", bay: "ETCH", rule: "CR" }).ok).toBe(true);
    expect(e.ruleOf("ETCH")).toBe("CR");
    expect(e.apply({ type: "setRule", bay: "ETCH", rule: "CR" }).ok).toBe(false);
  });

  it("expedite is limited by the shift budget and cannot be repeated on a lot", () => {
    const cfg = quietConfig(1, { expediteBudget: 2 });
    const e = new FabEngine(cfg);
    const a = e.injectLot("PWR-12", 5);
    const b = e.injectLot("PWR-12", 5);
    const c = e.injectLot("PWR-12", 5);
    expect(e.apply({ type: "expedite", lotId: a }).ok).toBe(true);
    expect(e.apply({ type: "expedite", lotId: a }).ok).toBe(false);
    expect(e.apply({ type: "expedite", lotId: b }).ok).toBe(true);
    expect(e.apply({ type: "expedite", lotId: c }).ok).toBe(false);
    expect(e.snapshot().expeditesLeft).toBe(0);
  });

  it("an expedited lot is dispatched ahead of an older lot", () => {
    const cfg = quietConfig(1);
    const e = new FabEngine(cfg);
    // Take every litho tool out so lots queue up, then free one.
    for (const t of cfg.tools.filter((x) => x.bay === "LITHO")) e.forceFailure(t.id);
    const old = e.injectLot("PWR-12", 0);
    e.advanceTo(10);
    const late = e.injectLot("PWR-12", 0);
    e.apply({ type: "expedite", lotId: late });
    e.advanceTo(cfg.shiftS);
    const starts = e.drainEvents().filter((x) => x.type === "lot.started" && x.data.stepIndex === 0);
    const order = starts.map((x) => (x.type === "lot.started" ? x.data.lotId : ""));
    expect(order.indexOf(late)).toBeLessThan(order.indexOf(old));
  });

  it("hold keeps a waiting lot out of dispatch, release lets it go", () => {
    const cfg = quietConfig(1);
    const e = new FabEngine(cfg);
    for (const t of cfg.tools.filter((x) => x.bay === "LITHO")) e.forceFailure(t.id);
    const id = e.injectLot("PWR-12", 0);
    expect(e.apply({ type: "hold", lotId: id }).ok).toBe(true);
    e.advanceTo(3000);
    expect(e.tool("LTH-01").state).toBe("STANDBY");
    expect(e.lot(id)!.status).toBe("waiting");
    expect(e.lot(id)!.held).toBe(true);
    expect(e.apply({ type: "hold", lotId: id }).ok).toBe(false);
    expect(e.apply({ type: "release", lotId: id }).ok).toBe(true);
    e.advanceTo(3200);
    expect(e.lot(id)!.status).not.toBe("waiting");
  });

  it("assignCrew moves a down tool to the front of the crew queue", () => {
    const cfg = quietConfig(1, { crewSize: 1 });
    const e = new FabEngine(cfg);
    e.forceFailure("DEP-01");
    e.forceFailure("DEP-02");
    e.forceFailure("DEP-03");
    expect(e.tool("DEP-01").crew).toBe("assigned");
    expect(e.snapshot().crew.waiting).toEqual(["DEP-02", "DEP-03"]);
    const r = e.apply({ type: "assignCrew", toolId: "DEP-03" });
    expect(r.ok).toBe(true);
    expect(e.snapshot().crew.waiting).toEqual(["DEP-03", "DEP-02"]);
    expect(e.apply({ type: "assignCrew", toolId: "DEP-01" }).ok).toBe(false);
    expect(e.apply({ type: "assignCrew", toolId: "LTH-01" }).ok).toBe(false);
  });

  it("early PM defuses a pending failure", () => {
    const cfg = quietConfig(3, { failuresEnabled: true });
    const probe = new FabEngine(cfg);
    probe.advanceTo(cfg.shiftS);
    const failing = probe
      .drainEvents()
      .find((x) => x.type === "equipment.state_changed" && x.data.reason === "failure");
    expect(failing).toBeDefined();
    const toolId = failing!.type === "equipment.state_changed" ? failing!.data.toolId : "";
    const failAtMs = failing!.t - cfg.epochMs;
    const e = new FabEngine(cfg);
    e.advanceTo(failAtMs / 1000 - 1200);
    expect(e.apply({ type: "pmEarly", toolId }).ok).toBe(true);
    e.advanceTo(failAtMs / 1000 + 5);
    expect(e.tool(toolId).state).not.toBe("UNSCHEDULED_DOWN");
  });

  it("rejects commands after the shift ends", () => {
    const cfg = quietConfig(1);
    const e = new FabEngine(cfg);
    e.advanceTo(cfg.shiftS);
    expect(e.snapshot().ended).toBe(true);
    expect(e.apply({ type: "setRule", bay: "CMP", rule: "EDD" }).ok).toBe(false);
  });
});
