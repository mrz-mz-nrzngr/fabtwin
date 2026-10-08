import type { AlarmRec, HistoryEntry, ReadModels } from "@/store/readmodels";
import type { Kpi, LotView, ToolView, WipRow } from "@/sim/types";
import type { MesView } from "./mes";

/** Shapes the API returns. Kept separate from the engine's internal views so the API contract can stay put when the engine changes. */

const iso = (baseMs: number, s: number) => new Date(baseMs + Math.round(s * 1000)).toISOString();

export function meta(v: MesView) {
  return {
    source: v.source,
    simulated: v.source === "simulation",
    seed: v.seed,
    atS: Math.round(v.t * 10) / 10,
    at: iso(v.baseMs, v.t),
    shiftS: v.shiftS,
  };
}

export function lotDto(l: LotView, baseMs: number) {
  return {
    id: l.id,
    route: l.route,
    hot: l.hot,
    expedited: l.prio === 1,
    held: l.held,
    holdReason: l.holdReason,
    step: l.step,
    steps: l.steps,
    recipe: l.recipe,
    bay: l.bay,
    status: l.status,
    location: { kind: l.loc.k, id: l.loc.k === "gone" ? null : l.loc.id },
    toolId: l.toolId,
    releasedAt: iso(baseMs, l.releasedAt),
    due: iso(baseMs, l.due),
    queueTimeLeftS: l.qtLeft === null ? null : Math.round(l.qtLeft),
    queueTimeViolations: l.qtViolations,
    excursionFlag: l.ooc,
  };
}

export function toolDto(t: ToolView, baseMs: number) {
  return {
    id: t.id,
    bay: t.bay,
    state: t.state,
    reason: t.reason,
    since: iso(baseMs, t.since),
    lotId: t.lotId,
    recipe: t.recipe,
    utilization: Math.round(t.util * 1000) / 1000,
    lotsDone: t.lotsDone,
    degradationWarning: t.warn,
    pmDueInS: Math.round(t.pmDueIn),
    stateSeconds: t.stateTime,
  };
}

export function alarmDto(a: AlarmRec, baseMs: number) {
  return {
    id: a.id,
    code: a.code,
    severity: a.severity,
    text: a.text,
    toolId: a.toolId ?? null,
    lotId: a.lotId ?? null,
    setAt: iso(baseMs, a.setT),
    clearedAt: a.clearedT === null ? null : iso(baseMs, a.clearedT),
    active: a.clearedT === null,
  };
}

export function kpiDto(k: Kpi) {
  return {
    shipped: k.shipped,
    shippedHot: k.shippedHot,
    wip: k.wip,
    throughputPerHour: Math.round(k.throughputPerHr * 100) / 100,
    meanCycleTimeS: k.avgCtS === null ? null : Math.round(k.avgCtS),
    meanHotCycleTimeS: k.avgHotCtS === null ? null : Math.round(k.avgHotCtS),
    xFactor: k.xFactor === null ? null : Math.round(k.xFactor * 100) / 100,
    onTimeDelivery: k.otd === null ? null : Math.round(k.otd * 1000) / 1000,
    queueTimeViolations: k.qtViolations,
    qualityEscapes: k.oocEscapes,
    meanToolUtilization: Math.round(k.avgUtil * 1000) / 1000,
    unscheduledDowntimeS: Math.round(k.downtimeS),
  };
}

export function wipDto(rows: WipRow[], lots: LotView[]) {
  const byBay = new Map<string, number>();
  for (const l of lots) byBay.set(l.bay, (byBay.get(l.bay) ?? 0) + 1);
  return {
    totalLots: lots.length,
    byBay: [...byBay.entries()].map(([bay, lots]) => ({ bay, lots })),
    byStep: rows.map((r) => ({ recipe: r.recipe, bay: r.bay, waiting: r.waiting, inTransit: r.transit, inTool: r.processing, held: r.held, total: r.waiting + r.transit + r.processing + r.held })),
  };
}

export function historyRows(models: ReadModels, baseMs: number, lotId?: string) {
  const ids = lotId ? [lotId] : Object.keys(models.lotHistory).sort();
  const rows: Array<{ lotId: string; route: string | null; hot: boolean | null; atS: number; at: string; kind: HistoryEntry["kind"]; toolId: string | null; stepIndex: number | null; text: string }> = [];
  for (const id of ids) {
    const idx = models.lotIndex[id];
    for (const h of models.lotHistory[id] ?? []) {
      rows.push({ lotId: id, route: idx?.route ?? null, hot: idx?.hot ?? null, atS: Math.round(h.t * 10) / 10, at: iso(baseMs, h.t), kind: h.kind, toolId: h.toolId ?? null, stepIndex: h.step ?? null, text: h.text });
    }
  }
  return rows.sort((a, b) => a.atS - b.atS || (a.lotId < b.lotId ? -1 : 1));
}

const q = (s: string | number | boolean | null) => {
  if (s === null) return "";
  const x = String(s);
  return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
};

/** RFC 4180 CSV, CRLF line ends. */
export function toCsv(header: string[], rows: Array<Array<string | number | boolean | null>>): string {
  return [header.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\r\n") + "\r\n";
}
