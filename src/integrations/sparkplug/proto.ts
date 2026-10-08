import { Enum, Field, OneOf, Root, Type } from "protobufjs/light";

/**
 * Sparkplug B payload, written here from the field numbers and types in section 6.4 of the
 * Sparkplug 3.0.0 specification. The upstream .proto file (Eclipse Tahu) is EPL-2.0 and is not
 * copied: this is an independent definition of the wire format. Only the parts FabTwin reads are
 * defined (Payload, Metric, DataType, and the scalar values). DataSet, Template, MetaData and
 * PropertySet are left out. protobufjs skips unknown fields on decode, so a payload that carries
 * them still decodes.
 */

export const DataType = {
  Unknown: 0,
  Int8: 1,
  Int16: 2,
  Int32: 3,
  Int64: 4,
  UInt8: 5,
  UInt16: 6,
  UInt32: 7,
  UInt64: 8,
  Float: 9,
  Double: 10,
  Boolean: 11,
  String: 12,
  DateTime: 13,
  Text: 14,
} as const;

export type MetricValue = number | boolean | string | null;

export interface Metric {
  name?: string;
  alias?: number;
  /** Epoch milliseconds. */
  timestamp?: number;
  datatype: number;
  isNull?: boolean;
  value: MetricValue;
}

export interface Payload {
  /** Epoch milliseconds. */
  timestamp?: number;
  metrics: Metric[];
  seq?: number;
}

function build(): { payload: Type; metric: Type } {
  const root = new Root();
  const metric = new Type("Metric")
    .add(new Field("name", 1, "string"))
    .add(new Field("alias", 2, "uint64"))
    .add(new Field("timestamp", 3, "uint64"))
    .add(new Field("datatype", 4, "uint32"))
    .add(new Field("isHistorical", 5, "bool"))
    .add(new Field("isTransient", 6, "bool"))
    .add(new Field("isNull", 7, "bool"))
    .add(new Field("intValue", 10, "uint32"))
    .add(new Field("longValue", 11, "uint64"))
    .add(new Field("floatValue", 12, "float"))
    .add(new Field("doubleValue", 13, "double"))
    .add(new Field("booleanValue", 14, "bool"))
    .add(new Field("stringValue", 15, "string"))
    .add(new Field("bytesValue", 16, "bytes"))
    .add(new OneOf("value", ["intValue", "longValue", "floatValue", "doubleValue", "booleanValue", "stringValue", "bytesValue"]));
  const payload = new Type("Payload")
    .add(new Field("timestamp", 1, "uint64"))
    .add(new Field("metrics", 2, "Metric", "repeated"))
    .add(new Field("seq", 3, "uint64"))
    .add(new Field("uuid", 4, "string"))
    .add(new Field("body", 5, "bytes"));
  root.add(new Enum("DataType", DataType));
  root.add(metric);
  root.add(payload);
  root.resolveAll();
  return { payload, metric };
}

const types = build();

const toNum = (x: unknown): number => (typeof x === "number" ? x : Number(x));

/** The wire carries IntN as an unsigned 32-bit varint, so negative values need reinterpreting. */
function sign(value: MetricValue, datatype: number): MetricValue {
  if (typeof value !== "number") return value;
  if (datatype === DataType.Int8) return (value << 24) >> 24;
  if (datatype === DataType.Int16) return (value << 16) >> 16;
  if (datatype === DataType.Int32) return value | 0;
  return value;
}

/** Wire format to plain objects. Throws on bytes that are not a protobuf message. */
export function decodePayload(bytes: Uint8Array): Payload {
  const msg = types.payload.decode(bytes);
  const o = types.payload.toObject(msg, { longs: Number, defaults: false, bytes: String }) as {
    timestamp?: number;
    seq?: number;
    metrics?: Array<Record<string, unknown>>;
  };
  const metrics: Metric[] = (o.metrics ?? []).map((m) => {
    let value: MetricValue = null;
    if (m.intValue !== undefined) value = toNum(m.intValue);
    else if (m.longValue !== undefined) value = toNum(m.longValue);
    else if (m.floatValue !== undefined) value = toNum(m.floatValue);
    else if (m.doubleValue !== undefined) value = toNum(m.doubleValue);
    else if (m.booleanValue !== undefined) value = Boolean(m.booleanValue);
    else if (m.stringValue !== undefined) value = String(m.stringValue);
    const datatype = m.datatype === undefined ? DataType.Unknown : toNum(m.datatype);
    return {
      name: m.name as string | undefined,
      alias: m.alias === undefined ? undefined : toNum(m.alias),
      timestamp: m.timestamp === undefined ? undefined : toNum(m.timestamp),
      datatype,
      isNull: m.isNull === undefined ? undefined : Boolean(m.isNull),
      value: m.isNull ? null : sign(value, datatype),
    };
  });
  return { timestamp: o.timestamp === undefined ? undefined : toNum(o.timestamp), seq: o.seq === undefined ? undefined : toNum(o.seq), metrics };
}

/** Plain objects to wire format. Used by the edge simulator and the tests. */
export function encodePayload(p: Payload): Uint8Array {
  const metrics = p.metrics.map((m) => {
    const o: Record<string, unknown> = { datatype: m.datatype };
    if (m.name !== undefined) o.name = m.name;
    if (m.alias !== undefined) o.alias = m.alias;
    if (m.timestamp !== undefined) o.timestamp = m.timestamp;
    if (m.isNull) o.isNull = true;
    else if (m.value !== null) {
      switch (m.datatype) {
        case DataType.Float:
          o.floatValue = m.value;
          break;
        case DataType.Double:
          o.doubleValue = m.value;
          break;
        case DataType.Boolean:
          o.booleanValue = m.value;
          break;
        case DataType.String:
        case DataType.Text:
          o.stringValue = m.value;
          break;
        case DataType.Int64:
        case DataType.UInt64:
        case DataType.DateTime:
          o.longValue = m.value;
          break;
        default:
          o.intValue = typeof m.value === "number" && m.value < 0 ? m.value >>> 0 : m.value;
      }
    }
    return o;
  });
  const obj: Record<string, unknown> = { metrics };
  if (p.timestamp !== undefined) obj.timestamp = p.timestamp;
  if (p.seq !== undefined) obj.seq = p.seq;
  const err = types.payload.verify(obj);
  if (err) throw new Error(`invalid Sparkplug payload: ${err}`);
  return types.payload.encode(types.payload.fromObject(obj)).finish();
}
