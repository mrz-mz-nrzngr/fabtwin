import { CEID } from "@/events/types";
import type { AlarmSeverity, E10State, FabEvent } from "@/events/types";

/**
 * Read models built purely from the event stream. The same reducer serves the simulator
 * and a live WebSocket feed, which is what makes live mode a drop-in.
 */

export interface AlarmRec {
  id: string;
  code: string;
  severity: AlarmSeverity;
  text: string;
  toolId?: string;
  lotId?: string;
  setT: number;
  clearedT: number | null;
  clearedBy?: string;
}

export interface GanttSeg {
  from: number;
  to: number | null;
  state: E10State;
  reason: string;
  lotId?: string | null;
}

export type HistoryKind = "release" | "track-in" | "track-out" | "hold" | "unhold" | "expedite" | "qt" | "alarm" | "shipped";

export interface HistoryEntry {
  t: number;
  kind: HistoryKind;
  text: string;
  toolId?: string;
  step?: number;
}

export interface LotIndexEntry {
  route?: string;
  hot?: boolean;
  shippedAt?: number;
}

export interface ReadModels {
  baseMs: number;
  eventCount: number;
  alarms: AlarmRec[];
  gantt: Record<string, GanttSeg[]>;
  lotHistory: Record<string, HistoryEntry[]>;
  lotIndex: Record<string, LotIndexEntry>;
}

export const MAX_ALARMS = 400;
export const MAX_SEGS = 600;

export function emptyModels(baseMs: number): ReadModels {
  return { baseMs, eventCount: 0, alarms: [], gantt: {}, lotHistory: {}, lotIndex: {} };
}

const mm = (s: number) => `${Math.round(s / 60)} min`;

export function applyEvents(prev: ReadModels, events: FabEvent[]): ReadModels {
  if (!events.length) return prev;
  const m: ReadModels = { ...prev, eventCount: prev.eventCount + events.length };
  let alarms = prev.alarms;
  const gantt = { ...prev.gantt };
  const ganttCopied = new Set<string>();
  const history = { ...prev.lotHistory };
  const histCopied = new Set<string>();
  const index = { ...prev.lotIndex };

  const addHist = (lotId: string, e: HistoryEntry) => {
    if (!histCopied.has(lotId)) {
      history[lotId] = [...(history[lotId] ?? [])];
      histCopied.add(lotId);
    }
    history[lotId].push(e);
  };
  const idx = (lotId: string) => (index[lotId] = { ...(index[lotId] ?? {}) });

  for (const ev of events) {
    const t = (ev.t - prev.baseMs) / 1000;
    switch (ev.type) {
      case "equipment.state_changed": {
        const id = ev.data.toolId;
        if (!ganttCopied.has(id)) {
          gantt[id] = [...(gantt[id] ?? [])];
          ganttCopied.add(id);
        }
        const segs = gantt[id];
        const open = segs[segs.length - 1];
        if (open && open.to === null) segs[segs.length - 1] = { ...open, to: t };
        segs.push({ from: t, to: null, state: ev.data.to, reason: ev.data.reason ?? "", lotId: ev.data.lotId });
        if (segs.length > MAX_SEGS) segs.splice(0, segs.length - MAX_SEGS);
        break;
      }
      case "alarm.set": {
        if (alarms === prev.alarms) alarms = [...alarms];
        alarms.push({
          id: ev.data.alarmId,
          code: ev.data.code,
          severity: ev.data.severity,
          text: ev.data.text,
          toolId: ev.data.toolId,
          lotId: ev.data.lotId,
          setT: t,
          clearedT: null,
        });
        if (alarms.length > MAX_ALARMS) alarms.splice(0, alarms.length - MAX_ALARMS);
        if (ev.data.lotId) addHist(ev.data.lotId, { t, kind: "alarm", text: `${ev.data.code}: ${ev.data.text}` });
        break;
      }
      case "alarm.cleared": {
        if (alarms === prev.alarms) alarms = [...alarms];
        const i = alarms.findIndex((a) => a.id === ev.data.alarmId);
        if (i >= 0) alarms[i] = { ...alarms[i], clearedT: t, clearedBy: ev.data.clearedBy };
        break;
      }
      case "lot.started": {
        const e = idx(ev.data.lotId);
        e.route = ev.data.route ?? e.route;
        e.hot = ev.data.hot ?? e.hot;
        addHist(ev.data.lotId, { t, kind: "track-in", toolId: ev.data.toolId, step: ev.data.stepIndex, text: `Track-in on ${ev.data.toolId}, ${ev.data.recipe}` });
        break;
      }
      case "lot.completed": {
        const e = idx(ev.data.lotId);
        e.route = ev.data.route ?? e.route;
        e.hot = ev.data.hot ?? e.hot;
        const meas = ev.data.measurement ? `, ${ev.data.measurement.param} ${ev.data.measurement.value} ${ev.data.measurement.unit}` : "";
        addHist(ev.data.lotId, { t, kind: "track-out", toolId: ev.data.toolId, step: ev.data.stepIndex, text: `Track-out ${ev.data.recipe} after ${mm(ev.data.durationS)}${meas}` });
        break;
      }
      case "collection_event": {
        const lotId = ev.data.lotId;
        if (!lotId) break;
        const r = ev.data.reports ?? {};
        switch (ev.data.ceid) {
          case CEID.LOT_RELEASED: {
            const e = idx(lotId);
            e.route = String(r.route ?? e.route ?? "");
            e.hot = Boolean(r.hot);
            addHist(lotId, { t, kind: "release", text: `Released onto ${String(r.route)}${r.hot ? " as a hot lot" : ""}` });
            break;
          }
          case CEID.LOT_HELD:
            addHist(lotId, { t, kind: "hold", text: `Held, reason ${String(r.reason ?? "operator")}${r.suspect ? `, suspect ${String(r.suspect)}` : ""}` });
            break;
          case CEID.LOT_RELEASED_FROM_HOLD:
            addHist(lotId, { t, kind: "unhold", text: `Released from hold by ${String(r.by ?? "operator")}` });
            break;
          case CEID.LOT_EXPEDITED:
            addHist(lotId, { t, kind: "expedite", text: "Expedited by the shift lead" });
            break;
          case CEID.QT_VIOLATION:
            addHist(lotId, { t, kind: "qt", step: Number(r.stepIndex), text: `Queue-time violation before ${String(r.recipe)}: waited ${mm(Number(r.waitedS))} against a ${mm(Number(r.limitS))} limit` });
            break;
          case CEID.LOT_SHIPPED: {
            const e = idx(lotId);
            e.shippedAt = t;
            addHist(lotId, { t, kind: "shipped", text: `Shipped after ${mm(Number(r.cycleTimeS))}${r.onTime ? ", on time" : ", late"}${r.oocEscape ? ", with an excursion flag" : ""}` });
            break;
          }
        }
        break;
      }
    }
  }
  m.alarms = alarms;
  m.gantt = gantt;
  m.lotHistory = history;
  m.lotIndex = index;
  return m;
}
