import { E10_STATES, SCHEMA_VERSION } from "../events/types";
import type { AlarmSeverity, E10State, FabEvent } from "../events/types";

/**
 * Shared by every protocol adapter (Sparkplug B, OPC UA). A protocol delivers observations about a
 * tool (its state, current lot, a measurement, an alarm bit) and this class turns them into schema v1
 * events. Lot start and complete are derived from the state and the lot id, because neither protocol
 * has a lot concept of its own. That rule is a design decision, written down in docs/VERIFICATION.md:
 *
 *   a lot is in process while the tool is PRODUCTIVE and reports a non-empty lot id.
 *   It starts when that becomes true and completes when it stops being true (state leaves
 *   PRODUCTIVE, or the lot id changes or clears).
 */

export interface Observation {
  /** Event time in epoch milliseconds. */
  t: number;
  state?: E10State;
  lotId?: string | null;
  recipe?: string | null;
  /** Route name and step index of the lot, when the source knows them. They let the console tell when a lot ships. */
  route?: string | null;
  stepIndex?: number | null;
}

export interface AlarmObservation {
  t: number;
  code: string;
  active: boolean;
  severity?: AlarmSeverity;
  text?: string;
}

export interface MeasurementObservation {
  t: number;
  param: string;
  value: number;
  unit: string;
}

interface ToolMem {
  state: E10State | null;
  lotId: string | null;
  recipe: string | null;
  inProcess: { lotId: string; recipe: string; startT: number; route?: string; stepIndex?: number } | null;
  alarms: Set<string>;
  measurement: { param: string; value: number; unit: string } | null;
  stepIndex: number | null;
  route: string | null;
}

export interface AdapterOptions {
  source: string;
  /** Route and step index to put on lot events, per tool. Optional; the console works without them. */
  stepOf?: (toolId: string) => { route?: string; stepIndex: number } | undefined;
}

export const normaliseState = (raw: unknown): E10State | null => {
  if (typeof raw === "number") return E10_STATES[raw] ?? null;
  if (typeof raw !== "string") return null;
  const up = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((E10_STATES as readonly string[]).includes(up)) return up as E10State;
  const alias: Record<string, E10State> = { RUN: "PRODUCTIVE", RUNNING: "PRODUCTIVE", IDLE: "STANDBY", DOWN: "UNSCHEDULED_DOWN", FAULT: "UNSCHEDULED_DOWN", PM: "SCHEDULED_DOWN", MAINTENANCE: "SCHEDULED_DOWN" };
  return alias[up] ?? null;
};

export class ToolAdapter {
  private seq = 0;
  private mem = new Map<string, ToolMem>();

  constructor(private readonly opts: AdapterOptions) {}

  private tool(id: string): ToolMem {
    let m = this.mem.get(id);
    if (!m) {
      m = { state: null, lotId: null, recipe: null, inProcess: null, alarms: new Set(), measurement: null, stepIndex: null, route: null };
      this.mem.set(id, m);
    }
    return m;
  }

  private ev<T extends FabEvent["type"]>(t: number, type: T, data: Extract<FabEvent, { type: T }>["data"]): FabEvent {
    return { v: SCHEMA_VERSION, seq: ++this.seq, t, source: this.opts.source, type, data } as FabEvent;
  }

  toolIds(): string[] {
    return [...this.mem.keys()];
  }

  observe(toolId: string, o: Observation): FabEvent[] {
    const m = this.tool(toolId);
    const out: FabEvent[] = [];
    const prevState = m.state;
    if (o.lotId !== undefined) m.lotId = o.lotId && o.lotId.length ? o.lotId : null;
    if (o.route !== undefined) m.route = o.route && o.route.length ? o.route : null;
    if (o.stepIndex !== undefined) m.stepIndex = o.stepIndex;
    if (o.recipe !== undefined) m.recipe = o.recipe && o.recipe.length ? o.recipe : null;
    const next = o.state ?? m.state;

    const wasIn = m.inProcess;
    const nowIn = next === "PRODUCTIVE" && m.lotId !== null ? m.lotId : null;
    const closes = wasIn !== null && (nowIn === null || nowIn !== wasIn.lotId);
    // A lot ends before the state change that follows it, so the Gantt segment and lot history line up.
    if (closes && wasIn) {
      out.push(this.complete(toolId, m, wasIn, o.t));
      m.inProcess = null;
    }
    if (next !== null && next !== prevState) {
      out.push(this.ev(o.t, "equipment.state_changed", { toolId, from: prevState, to: next, reason: prevState === null ? "initial" : "reported", lotId: nowIn ?? m.lotId, recipe: m.recipe }));
      m.state = next;
    }
    if (nowIn !== null && m.inProcess === null) {
      m.inProcess = { lotId: nowIn, recipe: m.recipe ?? "UNKNOWN", startT: o.t };
      const step = this.stepFor(toolId, m);
      m.inProcess.route = step.route;
      m.inProcess.stepIndex = step.stepIndex;
      out.push(this.ev(o.t, "lot.started", { lotId: nowIn, toolId, stepIndex: step.stepIndex, recipe: m.inProcess.recipe, ...(step.route ? { route: step.route } : {}) }));
    }
    return out;
  }

  measure(toolId: string, o: MeasurementObservation): FabEvent[] {
    const m = this.tool(toolId);
    m.measurement = { param: o.param, value: o.value, unit: o.unit };
    return [];
  }

  alarm(toolId: string, a: AlarmObservation): FabEvent[] {
    const m = this.tool(toolId);
    const alarmId = `ALM-${toolId}-${a.code}`;
    if (a.active && !m.alarms.has(alarmId)) {
      m.alarms.add(alarmId);
      return [this.ev(a.t, "alarm.set", { alarmId, code: a.code, severity: a.severity ?? "warning", text: a.text ?? `${a.code} on ${toolId}`, toolId })];
    }
    if (!a.active && m.alarms.has(alarmId)) {
      m.alarms.delete(alarmId);
      return [this.ev(a.t, "alarm.cleared", { alarmId, code: a.code, toolId, clearedBy: this.opts.source })];
    }
    return [];
  }

  /** Clear every alarm set by a connectivity code, for example when an edge node comes back. */
  clearAlarm(toolId: string, code: string, t: number): FabEvent[] {
    return this.alarm(toolId, { t, code, active: false });
  }

  private stepFor(toolId: string, m: ToolMem): { route?: string; stepIndex: number } {
    if (m.route !== null) return { route: m.route, stepIndex: m.stepIndex ?? 0 };
    const s = this.opts.stepOf?.(toolId);
    return { route: s?.route, stepIndex: s?.stepIndex ?? m.stepIndex ?? 0 };
  }

  private complete(toolId: string, m: ToolMem, lot: { lotId: string; recipe: string; startT: number; route?: string; stepIndex?: number }, t: number): FabEvent {
    const step = { route: lot.route, stepIndex: lot.stepIndex ?? 0 };
    const measurement = m.measurement ?? undefined;
    m.measurement = null;
    return this.ev(t, "lot.completed", {
      lotId: lot.lotId,
      toolId,
      stepIndex: step.stepIndex,
      recipe: lot.recipe,
      durationS: Math.max(0, Math.round(((t - lot.startT) / 1000) * 10) / 10),
      final: false,
      ...(step.route ? { route: step.route } : {}),
      ...(measurement ? { measurement } : {}),
    });
  }
}
