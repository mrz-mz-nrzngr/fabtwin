import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { parseFabEvent, parseFrame } from "@/events/validate";
import type { FabEvent } from "@/events/types";
import { buildConfig } from "./config";
import { FabEngine } from "./engine";

const schema = JSON.parse(readFileSync(resolve(__dirname, "../../docs/fabtwin-event.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

function shiftEvents(seed: number): FabEvent[] {
  const e = new FabEngine(buildConfig(seed));
  e.apply({ type: "setRule", bay: "LITHO", rule: "CR" });
  const all: FabEvent[] = [];
  for (let t = 0; t <= e.cfg.shiftS; t += 300) {
    e.advanceTo(t);
    all.push(...e.drainEvents());
  }
  return all;
}

describe("event schema v1", () => {
  const events = shiftEvents(21);

  it("every simulator event validates against the JSON Schema", () => {
    expect(events.length).toBeGreaterThan(1000);
    for (const ev of events) {
      const ok = validate(ev);
      expect(ok, JSON.stringify(validate.errors) + JSON.stringify(ev)).toBe(true);
    }
  });

  it("the runtime parser and the JSON Schema agree", () => {
    for (const ev of events.slice(0, 600)) expect(parseFabEvent(ev).ok).toBe(true);
    const bad: unknown[] = [
      { v: 2, seq: 1, t: 1, source: "x", type: "alarm.set", data: {} },
      { v: 1, seq: 0, t: 1, source: "x", type: "alarm.cleared", data: { alarmId: "a", code: "c" } },
      { v: 1, seq: 1, t: 1, source: "x", type: "equipment.state_changed", data: { toolId: "T", from: "IDLE", to: "STANDBY" } },
      { v: 1, seq: 1, t: 1, source: "x", type: "lot.started", data: { lotId: "L1", toolId: "T", stepIndex: -1, recipe: "R" } },
      { v: 1, seq: 1, t: 1, source: "x", type: "mystery", data: {} },
    ];
    for (const b of bad) {
      expect(parseFabEvent(b).ok).toBe(false);
      expect(validate(b)).toBe(false);
    }
  });

  it("covers every event type in the contract", () => {
    const seen = new Set(events.map((e) => e.type));
    for (const t of ["equipment.state_changed", "alarm.set", "alarm.cleared", "lot.started", "lot.completed", "collection_event"]) {
      expect(seen.has(t as FabEvent["type"]), t).toBe(true);
    }
  });

  it("numbers events 1..n without gaps and keeps time monotonic", () => {
    events.forEach((e, i) => expect(e.seq).toBe(i + 1));
    for (let i = 1; i < events.length; i++) expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
  });

  it("parseFrame accepts one event, an array, or an events envelope, and reports bad entries", () => {
    const one = events[0];
    expect(parseFrame(one).events).toHaveLength(1);
    expect(parseFrame([one, events[1]]).events).toHaveLength(2);
    expect(parseFrame({ events: [one] }).events).toHaveLength(1);
    const mixed = parseFrame([one, { nope: true }]);
    expect(mixed.events).toHaveLength(1);
    expect(mixed.errors).toHaveLength(1);
  });
});
