"use client";

import { useMemo, useState } from "react";
import { useFab } from "@/store/useFab";
import { E10_LABEL } from "@/sim/e10";
import { StatusGlyph } from "@/art/StatusGlyph";
import { Foup } from "@/art/Foup";
import { Empty, HotTag, SEV_LABEL, SevGlyph } from "./kit";
import { BAY_NAME, fmtClock, fmtMin, pct } from "./format";
import { WipChart } from "./charts/WipChart";
import { Gantt } from "./charts/Gantt";
import { SpcChart } from "./charts/SpcChart";

export type DockTab = "equipment" | "lots" | "wip" | "util" | "spc" | "alarms";
export const DOCK_TABS: Array<{ id: DockTab; label: string }> = [
  { id: "equipment", label: "Equipment" },
  { id: "lots", label: "Lots" },
  { id: "wip", label: "WIP by step" },
  { id: "util", label: "Utilization" },
  { id: "spc", label: "SPC" },
  { id: "alarms", label: "Alarms" },
];

export function DockTabs({ tab, setTab, tabs = DOCK_TABS }: { tab: DockTab; setTab: (t: DockTab) => void; tabs?: typeof DOCK_TABS }) {
  const alarms = useFab((s) => s.models.alarms);
  const active = alarms.filter((a) => a.clearedT === null).length;
  return (
    <div role="tablist" aria-label="Instruments" className="flex overflow-x-auto border-b border-line scroll-thin">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`panel-${t.id}`}
          onClick={() => setTab(t.id)}
          className={`min-h-9 shrink-0 max-md:min-h-[44px] max-md:min-w-[44px] border-b-2 px-3 text-[12px] ${tab === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
        >
          {t.label}
          {t.id === "alarms" && active > 0 && <span className="num ml-1.5 text-[11px] text-sdt">{active}</span>}
        </button>
      ))}
    </div>
  );
}

export function DockBody({ tab }: { tab: DockTab }) {
  return (
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-auto scroll-thin">
      {tab === "equipment" && <EquipmentTable />}
      {tab === "lots" && <LotSearch />}
      {tab === "wip" && <WipChart />}
      {tab === "util" && <Gantt />}
      {tab === "spc" && <SpcChart />}
      {tab === "alarms" && <AlarmList />}
    </div>
  );
}

function EquipmentTable() {
  const snap = useFab((s) => s.snap);
  const select = useFab((s) => s.select);
  const selection = useFab((s) => s.selection);
  if (!snap) return null;
  return (
    <table className="grid-table text-[12px]">
      <thead>
        <tr>
          <th>Tool</th>
          <th>Bay</th>
          <th>State</th>
          <th>Lot</th>
          <th>Recipe</th>
          <th>Util</th>
          <th>Next PM</th>
        </tr>
      </thead>
      <tbody>
        {snap.tools.map((t) => {
          const sel = selection?.kind === "tool" && selection.id === t.id;
          return (
            <tr key={t.id} data-selected={sel}>
              <td>
                <button type="button" className="num text-steel hover:text-accent max-md:inline-flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center" onClick={() => select({ kind: "tool", id: t.id })}>
                  {t.id}
                </button>
              </td>
              <td className="text-muted">{BAY_NAME[t.bay]}</td>
              <td>
                <span className="flex items-center gap-1.5">
                  <StatusGlyph state={t.state} size={10} />
                  {E10_LABEL[t.state]}
                  <span className="text-muted">{t.reason && t.reason !== "idle" ? `(${t.reason})` : ""}</span>
                </span>
              </td>
              <td className="num">{t.lotId ?? <span className="text-muted">-</span>}</td>
              <td className="num text-muted">{t.recipe ?? "-"}</td>
              <td className="num">{pct(t.util)}</td>
              <td className="num text-muted">{t.pmPending ? "queued" : fmtMin(Math.max(0, t.pmDueIn))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type Filter = "all" | "hot" | "held" | "qt" | "shipped";

function LotSearch() {
  const snap = useFab((s) => s.snap);
  const models = useFab((s) => s.models);
  const select = useFab((s) => s.select);
  const selection = useFab((s) => s.selection);
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filter>("all");

  const rows = useMemo(() => {
    if (!snap) return [];
    const needle = q.trim().toLowerCase();
    let list = snap.lots.map((l) => ({ ...l, shipped: false as boolean }));
    if (f === "hot") list = list.filter((l) => l.hot || l.prio === 1);
    if (f === "held") list = list.filter((l) => l.held);
    if (f === "qt") list = list.filter((l) => l.qtLeft !== null && l.qtLeft < 300);
    if (needle) list = list.filter((l) => `${l.id} ${l.route} ${l.recipe} ${l.toolId ?? ""} ${l.bay}`.toLowerCase().includes(needle));
    list.sort((a, b) => a.due - b.due);
    return list;
  }, [snap, q, f]);

  const shippedRows = useMemo(() => {
    if (f !== "shipped" && !q.trim()) return [];
    const needle = q.trim().toLowerCase();
    return Object.entries(models.lotIndex)
      .filter(([id, v]) => v.shippedAt !== undefined && (!needle || id.toLowerCase().includes(needle) || (v.route ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => b[1].shippedAt! - a[1].shippedAt!)
      .slice(0, 40);
  }, [models.lotIndex, q, f]);

  if (!snap) return null;
  const FILTERS: Array<[Filter, string]> = [
    ["all", "All in fab"],
    ["hot", "Hot and expedited"],
    ["held", "On hold"],
    ["qt", "Queue-time risk"],
    ["shipped", "Shipped"],
  ];
  const showFab = f !== "shipped";
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <label className="flex items-center gap-2 text-[12px] text-muted">
          Search
          <input
            type="search"
            name="lot-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Lot id, route, recipe or tool"
            className="num min-h-8 max-md:min-h-[44px] w-56 rounded-xs border border-line bg-raised px-2 text-[12px] text-ink placeholder:text-muted"
          />
        </label>
        <div role="group" aria-label="Lot filter" className="flex flex-wrap gap-1">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)} className={`min-h-7 max-md:min-h-[44px] rounded-xs border px-2 text-[12px] ${f === k ? "border-steel bg-raised text-ink" : "border-line text-muted hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="num ml-auto text-[11px] text-muted">{showFab ? `${rows.length} of ${snap.lots.length} lots` : `${shippedRows.length} shipped lots`}</span>
      </div>
      {showFab && rows.length === 0 && shippedRows.length === 0 ? (
        <Empty art={<Foup size={64} />} title="No lots match">
          {q ? `Nothing in the fab matches "${q}".` : f === "held" ? "No lot is on hold. SPC excursions and your own holds land here." : f === "qt" ? "No lot is close to a queue-time limit." : "The fab is empty."}
        </Empty>
      ) : (
        <table className="grid-table text-[12px]">
          <thead>
            <tr>
              <th>Lot</th>
              <th>Route</th>
              <th>Step</th>
              <th>Recipe</th>
              <th>Status</th>
              <th>Where</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {showFab &&
              rows.map((l) => {
                const dueIn = l.due - snap.t;
                return (
                  <tr key={l.id} data-selected={selection?.kind === "lot" && selection.id === l.id}>
                    <td className="num">
                      <button type="button" className="text-steel hover:text-accent max-md:inline-flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center" onClick={() => select({ kind: "lot", id: l.id })}>
                        {l.id}
                      </button>{" "}
                      {(l.hot || l.prio === 1) && <HotTag expedited={l.prio === 1} />}
                    </td>
                    <td className="num text-muted">{l.route}</td>
                    <td className="num">
                      {l.step + 1}/{l.steps}
                    </td>
                    <td className="num text-muted">{l.recipe}</td>
                    <td>{l.held ? <span className="text-sdt">On hold</span> : l.status === "waiting" ? "Waiting" : l.status === "transit" ? "Moving" : "In tool"}</td>
                    <td className="num text-muted">{l.loc.k === "gone" ? "-" : l.loc.id}</td>
                    <td className={`num ${dueIn < 0 ? "text-udt" : "text-muted"}`}>{dueIn < 0 ? `late ${fmtMin(-dueIn)}` : fmtMin(dueIn)}</td>
                  </tr>
                );
              })}
            {shippedRows.map(([id, v]) => (
              <tr key={id} data-selected={selection?.kind === "lot" && selection.id === id}>
                <td className="num">
                  <button type="button" className="text-steel hover:text-accent max-md:inline-flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center" onClick={() => select({ kind: "lot", id })}>
                    {id}
                  </button>
                </td>
                <td className="num text-muted">{v.route ?? "-"}</td>
                <td className="num">done</td>
                <td className="num text-muted">-</td>
                <td>Shipped</td>
                <td className="num text-muted">-</td>
                <td className="num text-muted">{fmtClock(v.shippedAt!).slice(0, 5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AlarmList() {
  const models = useFab((s) => s.models);
  const select = useFab((s) => s.select);
  const [activeOnly, setActiveOnly] = useState(false);
  const rows = useMemo(() => [...models.alarms].reverse().filter((a) => !activeOnly || a.clearedT === null).slice(0, 150), [models.alarms, activeOnly]);
  const activeCount = models.alarms.filter((a) => a.clearedT === null).length;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2 text-[12px]">
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="accent-[#ff5c93]" />
          Active only
        </label>
        <span className="num text-[11px] text-muted">
          {activeCount} active, {models.alarms.length} in log
        </span>
      </div>
      {rows.length === 0 ? (
        <Empty art={<Foup size={64} />} title={activeOnly ? "No active alarms" : "No alarms yet"}>
          Alarms are set and cleared by equipment events: tool failures, degradation warnings, PM due, queue-time risk and violations, SPC rule breaks.
        </Empty>
      ) : (
        <table className="grid-table text-[12px]">
          <thead>
            <tr>
              <th>Set</th>
              <th>Severity</th>
              <th>Code</th>
              <th>Source</th>
              <th>Text</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="num text-muted">{fmtClock(a.setT)}</td>
                <td>
                  <span className="flex items-center gap-1.5">
                    <SevGlyph sev={a.severity} />
                    {SEV_LABEL[a.severity]}
                  </span>
                </td>
                <td className="num text-muted">{a.code}</td>
                <td className="num">
                  {a.toolId && (
                    <button type="button" className="text-steel hover:text-accent max-md:inline-flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center" onClick={() => select({ kind: "tool", id: a.toolId! })}>
                      {a.toolId}
                    </button>
                  )}{" "}
                  {a.lotId && (
                    <button type="button" className="text-steel hover:text-accent max-md:inline-flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center" onClick={() => select({ kind: "lot", id: a.lotId! })}>
                      {a.lotId}
                    </button>
                  )}
                </td>
                <td className="max-w-[46ch] truncate" title={a.text}>
                  {a.text}
                </td>
                <td className="num text-muted">{a.clearedT === null ? <span className="text-sdt">active</span> : `cleared ${fmtClock(a.clearedT).slice(0, 5)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
