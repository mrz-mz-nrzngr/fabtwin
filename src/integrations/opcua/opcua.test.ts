import { describe, expect, it } from "vitest";
import { OpcUaMapper } from "./mapper";

const T = 1768197600000;

describe("OpcUaMapper", () => {
  it("batches a tool's values from one publish into ordered events", () => {
    const m = new OpcUaMapper();
    m.setValue("ETC-01", "State", "STANDBY", T);
    m.setValue("ETC-01", "LotId", "", T);
    expect(m.flush(T).map((e) => e.type)).toEqual(["equipment.state_changed"]);
    m.setValue("ETC-01", "Recipe", "ETCH-ACT", T + 5000);
    m.setValue("ETC-01", "LotId", "L0007", T + 5000);
    m.setValue("ETC-01", "Route", "LOGIC-16", T + 5000);
    m.setValue("ETC-01", "StepIndex", 1, T + 5000);
    m.setValue("ETC-01", "State", "PRODUCTIVE", T + 5000);
    const start = m.flush(T + 5000);
    expect(start.map((e) => e.type)).toEqual(["equipment.state_changed", "lot.started"]);
    expect(start[1]).toMatchObject({ data: { lotId: "L0007", recipe: "ETCH-ACT", route: "LOGIC-16", stepIndex: 1 } });
  });

  it("treats dotted browse names like slashed metric names", () => {
    const m = new OpcUaMapper();
    m.setValue("MET-01", "Alarm.critical.TOOL_FAULT", true, T);
    const ev = m.flush(T);
    expect(ev[0]).toMatchObject({ type: "alarm.set", data: { code: "TOOL_FAULT", severity: "critical", toolId: "MET-01" } });
  });

  it("raises and clears a quality alarm instead of using a bad value", () => {
    const m = new OpcUaMapper();
    m.setValue("DEP-01", "State", "PRODUCTIVE", T, false);
    expect(m.flush(T)).toMatchObject([{ type: "alarm.set", data: { code: "OPCUA_BAD_QUALITY" } }]);
    m.setValue("DEP-01", "State", "STANDBY", T + 1000, true);
    const ev = m.flush(T + 1000);
    expect(ev.map((e) => e.type)).toEqual(["alarm.cleared", "equipment.state_changed"]);
  });

  it("sets connection alarms on all known tools and clears them on reconnect", () => {
    const m = new OpcUaMapper();
    m.setValue("A-1", "State", "STANDBY", T);
    m.setValue("A-2", "State", "STANDBY", T);
    m.flush(T);
    expect(m.connectionLost(T + 1)).toHaveLength(2);
    expect(m.connectionLost(T + 2)).toHaveLength(0);
    expect(m.connectionRestored(T + 3).map((e) => e.type)).toEqual(["alarm.cleared", "alarm.cleared"]);
  });

  it("collects names it does not know", () => {
    const m = new OpcUaMapper();
    m.setValue("LTH-01", "Temperature", 21.5, T);
    m.flush(T);
    expect([...m.ignoredNames]).toEqual(["Temperature"]);
  });
});
