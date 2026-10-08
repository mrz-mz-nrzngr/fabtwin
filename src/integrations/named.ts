import type { FabEvent } from "../events/types";
import { SPC_SPECS } from "../sim/config";
import { normaliseState } from "./adapter";
import type { AlarmObservation, Observation, ToolAdapter } from "./adapter";

/**
 * FabTwin's naming convention for values a tool reports, shared by the Sparkplug B and OPC UA adapters
 * (the protocols give names, the convention gives meaning; it is a design decision, see docs/VERIFICATION.md):
 *
 *   State                  an E10 state name, PRODUCTIVE, STANDBY, ENGINEERING, SCHEDULED_DOWN, UNSCHEDULED_DOWN
 *   LotId, Recipe, Route   text
 *   StepIndex              integer, zero based
 *   Alarm/<CODE>           boolean, true while set, severity warning
 *   Alarm/<info|warning|critical>/<CODE>   the same with a severity
 *   Measurement/<PARAM>    number, PARAM is CD, OVL or THK
 */
export interface NamedValue {
  name: string;
  value: number | boolean | string | null;
  /** Epoch milliseconds, when the source stamped the value. */
  t?: number;
}

export const NAMED_CONVENTION = ["State", "LotId", "Recipe", "Route", "StepIndex", "Alarm/<CODE>", "Alarm/<severity>/<CODE>", "Measurement/<PARAM>"] as const;

/** Applies a batch of values for one tool and returns the events. `ignored` counts names the convention does not cover. */
export function applyNamedValues(adapter: ToolAdapter, toolId: string, list: NamedValue[], t: number): { events: FabEvent[]; ignored: string[] } {
  const obs: Observation = { t };
  let touched = false;
  const events: FabEvent[] = [];
  const alarms: AlarmObservation[] = [];
  const ignored: string[] = [];
  for (const m of list) {
    const mt = m.t ?? t;
    const name = m.name;
    if (name === "State") {
      const s = normaliseState(m.value);
      if (s) {
        obs.state = s;
        obs.t = mt;
        touched = true;
      } else ignored.push(name);
    } else if (name === "LotId") {
      obs.lotId = typeof m.value === "string" ? m.value : null;
      touched = true;
    } else if (name === "Route") {
      obs.route = typeof m.value === "string" ? m.value : null;
      touched = true;
    } else if (name === "StepIndex") {
      obs.stepIndex = typeof m.value === "number" ? m.value : null;
      touched = true;
    } else if (name === "Recipe") {
      obs.recipe = typeof m.value === "string" ? m.value : null;
      touched = true;
    } else if (name.startsWith("Alarm/")) {
      const parts = name.split("/");
      const sev = parts.length === 3 && ["info", "warning", "critical"].includes(parts[1]) ? (parts[1] as "info" | "warning" | "critical") : "warning";
      const code = parts[parts.length - 1];
      if (typeof m.value === "boolean" && code) alarms.push({ t: mt, code, active: m.value, severity: sev, text: `${code} on ${toolId} (${name})` });
      else ignored.push(name);
    } else if (name.startsWith("Measurement/")) {
      const param = name.slice("Measurement/".length);
      const spec = SPC_SPECS.find((s) => s.param === param);
      if (spec && typeof m.value === "number") events.push(...adapter.measure(toolId, { t: mt, param, value: m.value, unit: spec.unit }));
      else ignored.push(name);
    } else ignored.push(name);
  }
  for (const a of alarms) events.push(...adapter.alarm(toolId, a));
  if (touched) events.push(...adapter.observe(toolId, obs));
  return { events, ignored };
}
