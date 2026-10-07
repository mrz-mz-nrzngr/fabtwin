import { E10_STATES, SCHEMA_VERSION } from "./types";
import type { FabEvent } from "./types";

export type ParseResult = { ok: true; event: FabEvent } | { ok: false; error: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);
const optStr = (x: unknown) => x === undefined || typeof x === "string";

/**
 * Runtime check for one event. It mirrors docs/fabtwin-event.schema.json. The test suite
 * runs both against the same samples so they cannot drift apart.
 */
export function parseFabEvent(input: unknown): ParseResult {
  if (!isObj(input)) return { ok: false, error: "event must be an object" };
  if (input.v !== SCHEMA_VERSION) return { ok: false, error: `unsupported schema version ${String(input.v)}` };
  if (!isInt(input.seq) || input.seq < 1) return { ok: false, error: "seq must be a positive integer" };
  if (!isInt(input.t) || input.t < 0) return { ok: false, error: "t must be epoch milliseconds" };
  if (!isStr(input.source)) return { ok: false, error: "source must be a non-empty string" };
  const d = input.data;
  if (!isObj(d)) return { ok: false, error: "data must be an object" };
  const bad = (m: string): ParseResult => ({ ok: false, error: `${String(input.type)}: ${m}` });
  switch (input.type) {
    case "equipment.state_changed":
      if (!isStr(d.toolId)) return bad("toolId required");
      if (d.from !== null && !E10_STATES.includes(d.from as never)) return bad("from must be an E10 state or null");
      if (!E10_STATES.includes(d.to as never)) return bad("to must be an E10 state");
      break;
    case "alarm.set":
      if (!isStr(d.alarmId) || !isStr(d.code)) return bad("alarmId and code required");
      if (!["info", "warning", "critical"].includes(d.severity as string)) return bad("severity invalid");
      if (typeof d.text !== "string") return bad("text required");
      if (!optStr(d.toolId) || !optStr(d.lotId)) return bad("toolId and lotId must be strings");
      break;
    case "alarm.cleared":
      if (!isStr(d.alarmId) || !isStr(d.code)) return bad("alarmId and code required");
      break;
    case "lot.started":
      if (!isStr(d.lotId) || !isStr(d.toolId) || !isStr(d.recipe)) return bad("lotId, toolId, recipe required");
      if (!isInt(d.stepIndex) || d.stepIndex < 0) return bad("stepIndex must be a non-negative integer");
      break;
    case "lot.completed":
      if (!isStr(d.lotId) || !isStr(d.toolId) || !isStr(d.recipe)) return bad("lotId, toolId, recipe required");
      if (!isInt(d.stepIndex) || d.stepIndex < 0) return bad("stepIndex must be a non-negative integer");
      if (typeof d.durationS !== "number" || d.durationS < 0) return bad("durationS required");
      if (typeof d.final !== "boolean") return bad("final required");
      break;
    case "collection_event":
      if (!isInt(d.ceid) || d.ceid < 0) return bad("ceid must be a non-negative integer");
      if (!isStr(d.name)) return bad("name required");
      break;
    default:
      return { ok: false, error: `unknown event type ${String(input.type)}` };
  }
  return { ok: true, event: input as unknown as FabEvent };
}

/** Accepts a single event, an array, or `{ events: [...] }`. Invalid entries are reported, not thrown. */
export function parseFrame(raw: unknown): { events: FabEvent[]; errors: string[] } {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.events) ? raw.events : [raw];
  const events: FabEvent[] = [];
  const errors: string[] = [];
  for (const item of list) {
    const r = parseFabEvent(item);
    if (r.ok) events.push(r.event);
    else errors.push(r.error);
  }
  return { events, errors };
}
