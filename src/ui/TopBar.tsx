"use client";

import { useFab } from "@/store/useFab";
import type { Speed } from "@/store/useFab";
import { Foup } from "@/art/Foup";
import { Btn } from "./kit";
import { fmtClock } from "./format";

const SPEEDS: Array<{ v: Speed; label: string }> = [
  { v: 0, label: "Pause" },
  { v: 1, label: "1x" },
  { v: 10, label: "10x" },
  { v: 60, label: "60x" },
];

export function Objectives({ stacked = false }: { stacked?: boolean }) {
  const snap = useFab((s) => s.snap);
  if (!snap) return null;
  return (
    <ul className={`flex ${stacked ? "flex-col gap-1" : "flex-wrap gap-x-4 gap-y-0.5"}`} aria-label="Shift objectives">
      {snap.objectives.map((o) => {
        const val =
          o.id === "ship" ? `${o.value ?? 0} of ${o.target}` : o.id === "hotCt" ? (o.value === null ? "no hot lot shipped yet" : `${Math.round(o.value / 60)} min vs ${Math.round(o.target / 60)} min limit`) : `${o.value ?? 0} so far`;
        const status = snap.ended ? (o.met ? "met" : "missed") : o.failed ? (o.id === "qt" ? "violated" : "over limit") : o.met ? "on track" : "open";
        const tone = status === "met" || status === "on track" ? "text-prd" : status === "missed" || status === "violated" || status === "over limit" ? "text-udt" : "text-muted";
        return (
          <li key={o.id} className="flex items-baseline gap-1.5 text-[12px]">
            <span className="text-ink">{o.label}</span>
            <span className="num text-muted">{val}</span>
            <span className={`text-[11px] ${tone}`}>{status}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function TopBar({ onLive, onReport, onBrief }: { onLive: () => void; onReport: () => void; onBrief: () => void }) {
  const snap = useFab((s) => s.snap);
  const speed = useFab((s) => s.speed);
  const setSpeed = useFab((s) => s.setSpeed);
  const phase = useFab((s) => s.phase);
  const mode = useFab((s) => s.mode);
  const view = useFab((s) => s.view);
  const setView = useFab((s) => s.setView);
  const live = useFab((s) => s.live);
  const t = snap?.t ?? 0;
  const shift = snap?.shiftS ?? 14400;

  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line bg-panel px-3 py-2" data-testid="topbar">
      <div className="flex items-center gap-2">
        <Foup size={34} shell="#cfd8df" />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight">FabTwin</p>
          <p className="text-[11px] text-muted">Shift lead console</p>
        </div>
      </div>

      <div className="min-w-[170px]">
        <p className="num text-[18px] leading-none" aria-label="Shift clock">
          {mode === "live" ? "LIVE" : fmtClock(t)}
          <span className="text-[12px] text-muted"> {mode === "live" ? `${live.state}` : `/ ${fmtClock(shift)}`}</span>
        </p>
        <div className="mt-1 h-1 w-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={shift} aria-valuenow={Math.round(t)} aria-label="Shift progress">
          <div className="h-full bg-steel" style={{ width: `${mode === "live" ? 100 : (t / shift) * 100}%` }} />
        </div>
      </div>

      <div role="group" aria-label="Time controls" className="flex">
        {SPEEDS.map(({ v, label }) => (
          <button
            key={v}
            type="button"
            aria-pressed={speed === v}
            disabled={mode === "live" || phase === "ended"}
            onClick={() => setSpeed(v)}
            className={`num min-h-8 min-w-12 border border-line px-2.5 text-[12px] first:rounded-l-xs last:rounded-r-xs -ml-px first:ml-0 ${
              speed === v ? "border-accent bg-accent text-accent-ink font-medium relative z-10" : "bg-raised text-ink hover:border-steel"
            } disabled:text-muted`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="hidden min-w-0 flex-1 xl:block">
        <Objectives />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="text-right leading-tight" title="Score is computed from simulated results">
          <p className="text-[11px] text-muted">Score</p>
          <p className="num text-[18px]" aria-live="off">
            {mode === "live" ? "-" : (snap?.score ?? 0).toLocaleString("en-US")}
          </p>
        </div>
        <div role="group" aria-label="Floor view" className="hidden md:flex">
          {(["3d", "2d"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`min-h-8 border border-line px-2.5 text-[12px] first:rounded-l-xs last:rounded-r-xs -ml-px first:ml-0 ${view === v ? "bg-raised text-ink border-steel relative z-10" : "text-muted hover:text-ink"}`}
            >
              {v === "3d" ? "3D floor" : "2D map"}
            </button>
          ))}
        </div>
        <Btn onClick={onLive} className="hidden md:block">
          {mode === "live" ? "Live feed" : "Live mode"}
        </Btn>
        {phase === "ended" ? <Btn variant="primary" onClick={onReport}>Shift report</Btn> : <Btn onClick={onBrief} className="hidden md:block">Briefing</Btn>}
      </div>
    </header>
  );
}
