import { describe, expect, it } from "vitest";
import { SparkplugMapper } from "./mapper";
import { DataType, decodePayload, encodePayload } from "./proto";
import type { Metric } from "./proto";
import { parseTopic } from "./topic";

const str = (name: string, value: string, extra: Partial<Metric> = {}): Metric => ({ name, datatype: DataType.String, value, ...extra });
const bool = (name: string, value: boolean): Metric => ({ name, datatype: DataType.Boolean, value });
const dbl = (name: string, value: number): Metric => ({ name, datatype: DataType.Double, value });
const bd = (n: number): Metric => ({ name: "bdSeq", datatype: DataType.Int64, value: n });
const msg = (seq: number | undefined, ts: number, metrics: Metric[]) => encodePayload({ timestamp: ts, seq, metrics });

describe("Sparkplug payload codec", () => {
  it("round-trips every scalar type, including negative ints", () => {
    const p = {
      timestamp: 1768197660000,
      seq: 7,
      metrics: [
        str("State", "PRODUCTIVE", { timestamp: 1768197660001 }),
        bool("Alarm/OVERTEMP", true),
        dbl("Measurement/CD", 45.123),
        { name: "f", datatype: DataType.Float, value: 1.5 },
        { name: "i8", datatype: DataType.Int8, value: -5 },
        { name: "i32", datatype: DataType.Int32, value: -70000 },
        { name: "u16", datatype: DataType.UInt16, value: 4000 },
        { name: "i64", datatype: DataType.Int64, value: 255 },
        { name: "alias", alias: 9, datatype: DataType.Boolean, isNull: true, value: null },
      ],
    };
    const back = decodePayload(encodePayload(p));
    expect(back.seq).toBe(7);
    expect(back.timestamp).toBe(1768197660000);
    expect(back.metrics.map((m) => m.value)).toEqual(["PRODUCTIVE", true, 45.123, 1.5, -5, -70000, 4000, 255, null]);
    expect(back.metrics[0].timestamp).toBe(1768197660001);
    expect(back.metrics[8].alias).toBe(9);
  });

  it("uses the field numbers of the specification", () => {
    // Payload.seq is field 3 (tag 0x18), Metric is field 2 (tag 0x12); Metric.name is field 1 (0x0a), Metric.stringValue is field 15 (0x7a).
    const bytes = encodePayload({ seq: 3, metrics: [{ name: "a", datatype: DataType.String, value: "b" }] });
    const hex = Buffer.from(bytes).toString("hex");
    expect(hex).toContain("0a0161"); // name = "a"
    expect(hex).toContain("200c"); // datatype (field 4) = 12 String
    expect(hex).toContain("7a0162"); // string_value (field 15) = "b"
    expect(hex.endsWith("1803")).toBe(true); // seq (field 3) = 3
  });

  it("rejects garbage", () => {
    expect(() => decodePayload(Uint8Array.from([0xff, 0xff, 0xff]))).toThrow();
  });
});

describe("Sparkplug topics", () => {
  it("parses node and device topics and rejects malformed ones", () => {
    expect(parseTopic("spBv1.0/Fab1/NBIRTH/Litho")).toEqual({ type: "NBIRTH", groupId: "Fab1", edgeNodeId: "Litho", deviceId: undefined });
    expect(parseTopic("spBv1.0/Fab1/DDATA/Litho/LTH-01")?.deviceId).toBe("LTH-01");
    expect(parseTopic("spBv1.0/Fab1/DDATA/Litho")).toBeNull();
    expect(parseTopic("spBv1.0/Fab1/NDATA/Litho/LTH-01")).toBeNull();
    expect(parseTopic("spBv1.0/STATE/host")).toBeNull();
    expect(parseTopic("other/Fab1/NBIRTH/Litho")).toBeNull();
  });
});

describe("Sparkplug mapper", () => {
  const T0 = 1768197600000;
  const mk = () => {
    const rebirths: string[] = [];
    const m = new SparkplugMapper({ onRebirth: (g, n) => rebirths.push(`${g}/${n}`), now: () => T0 });
    return { m, rebirths };
  };

  it("maps births and data to state, lot and alarm events", () => {
    const { m } = mk();
    const topic = (t: string) => `spBv1.0/Fab1/${t}/Litho`;
    m.handle(topic("NBIRTH"), msg(0, T0, [bd(0), bool("Node Control/Rebirth", false)]));
    const birth = m.handle(`${topic("DBIRTH")}/LTH-01`, msg(1, T0, [str("State", "STANDBY"), str("LotId", ""), str("Recipe", "")]));
    expect(birth.events.map((e) => e.type)).toEqual(["equipment.state_changed"]);
    const start = m.handle(`${topic("DDATA")}/LTH-01`, msg(2, T0 + 5000, [str("Recipe", "LITH-ACT"), str("LotId", "L0001"), str("State", "PRODUCTIVE")]));
    expect(start.events.map((e) => e.type)).toEqual(["equipment.state_changed", "lot.started"]);
    const alarm = m.handle(`${topic("DDATA")}/LTH-01`, msg(3, T0 + 8000, [bool("Alarm/critical/OVERTEMP", true)]));
    expect(alarm.events[0]).toMatchObject({ type: "alarm.set", data: { code: "OVERTEMP", severity: "critical", toolId: "LTH-01" } });
    const dup = m.handle(`${topic("DDATA")}/LTH-01`, msg(4, T0 + 8100, [bool("Alarm/critical/OVERTEMP", true)]));
    expect(dup.events).toHaveLength(0);
    const end = m.handle(`${topic("DDATA")}/LTH-01`, msg(5, T0 + 15000, [dbl("Measurement/CD", 45.4), str("State", "STANDBY"), bool("Alarm/critical/OVERTEMP", false)]));
    expect(end.events.map((e) => e.type)).toEqual(["alarm.cleared", "lot.completed", "equipment.state_changed"]);
    const done = end.events.find((e) => e.type === "lot.completed");
    expect(done).toMatchObject({ data: { lotId: "L0001", toolId: "LTH-01", recipe: "LITH-ACT", durationS: 10, measurement: { param: "CD", value: 45.4, unit: "nm" } } });
  });

  it("raises a connectivity alarm on NDEATH and clears it on the next NBIRTH, ignoring a stale death", () => {
    const { m } = mk();
    m.handle("spBv1.0/Fab1/NBIRTH/Etch", msg(0, T0, [bd(4)]));
    m.handle("spBv1.0/Fab1/DBIRTH/Etch/ETC-01", msg(1, T0, [str("State", "PRODUCTIVE")]));
    const stale = m.handle("spBv1.0/Fab1/NDEATH/Etch", encodePayload({ metrics: [bd(3)] }));
    expect(stale.events).toHaveLength(0);
    expect(m.stats.staleDeaths).toBe(1);
    const dead = m.handle("spBv1.0/Fab1/NDEATH/Etch", encodePayload({ timestamp: T0 + 1000, metrics: [bd(4)] }));
    expect(dead.events[0]).toMatchObject({ type: "alarm.set", data: { code: "EDGE_NODE_OFFLINE", toolId: "ETC-01", severity: "critical" } });
    const back = m.handle("spBv1.0/Fab1/NBIRTH/Etch", msg(0, T0 + 9000, [bd(5)]));
    expect(back.events[0]).toMatchObject({ type: "alarm.cleared", data: { code: "EDGE_NODE_OFFLINE" } });
  });

  it("resolves aliases from the birth and asks for a rebirth when an alias is unknown", () => {
    const { m, rebirths } = mk();
    m.handle("spBv1.0/Fab1/NBIRTH/Met", msg(0, T0, [bd(0)]));
    m.handle("spBv1.0/Fab1/DBIRTH/Met/MET-01", msg(1, T0, [{ ...str("State", "STANDBY"), alias: 11 }]));
    const ok = m.handle("spBv1.0/Fab1/DDATA/Met/MET-01", msg(2, T0 + 1000, [{ alias: 11, datatype: DataType.String, value: "PRODUCTIVE" }, { name: "LotId", datatype: DataType.String, value: "L9" }]));
    expect(ok.events.some((e) => e.type === "equipment.state_changed" && e.data.to === "PRODUCTIVE")).toBe(true);
    m.handle("spBv1.0/Fab1/DDATA/Met/MET-01", msg(3, T0 + 2000, [{ alias: 99, datatype: DataType.String, value: "x" }]));
    expect(m.stats.unknownAlias).toBe(1);
    expect(rebirths).toEqual(["Fab1/Met"]);
  });

  it("detects a sequence gap and a late join, and asks for rebirth", () => {
    const { m, rebirths } = mk();
    m.handle("spBv1.0/Fab1/DDATA/Late/LTH-02", msg(40, T0, [str("State", "STANDBY")]));
    expect(rebirths).toEqual(["Fab1/Late"]);
    m.handle("spBv1.0/Fab1/NBIRTH/Gap", msg(255, T0, [bd(0)]));
    m.handle("spBv1.0/Fab1/DDATA/Gap/LTH-03", msg(0, T0, [str("State", "STANDBY")]));
    expect(m.stats.seqGaps).toBe(0);
    m.handle("spBv1.0/Fab1/DDATA/Gap/LTH-03", msg(5, T0, [str("State", "PRODUCTIVE")]));
    expect(m.stats.seqGaps).toBe(1);
    expect(rebirths).toEqual(["Fab1/Late", "Fab1/Gap"]);
  });

  it("counts payloads it cannot decode", () => {
    const { m } = mk();
    const r = m.handle("spBv1.0/Fab1/DDATA/X/Y", Uint8Array.from([1, 2, 3, 4, 5]));
    expect(r.errors).toHaveLength(1);
    expect(m.stats.decodeErrors).toBe(1);
  });
});
