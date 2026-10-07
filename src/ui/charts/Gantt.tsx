"use client";

import { useState } from "react";
import { useFab } from "@/store/useFab";
import { E10_STATES } from "@/events/types";
import { E10_LABEL } from "@/sim/e10";
import { E10_COLOR, StatusGlyph } from "@/art/StatusGlyph";
import { useWidth } from "../hooks";
import { fmtClock } from "../format";

export function Gantt() {
  const snap = useFab((s) => s.snap);
  const models = useFab((s) => s.models);
  const select = useFab((s) => s.select);
  const selection = useFab((s) => s.selection);
  const [win, setWin] = useState<"shift" | "hour">("shift");
  const [ref, w] = useWidth<HTMLDivElement>();
  if (!snap) return null;
  const now = snap.t;
  const span = win === "shift" ? snap.shiftS : 3600;
  const t1 = win === "shift" ? snap.shiftS : Math.max(3600, now);
  const t0 = t1 - span;
  const labelW = 54;
  const RH = 11;
  const plotW = Math.max(60, w - labelW - 8);
  const x = (t: number) => labelW + ((Math.min(Math.max(t, t0), t1) - t0) / span) * plotW;
  const ticks: number[] = [];
  const step = win === "shift" ? 1800 : 600;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t);
  const H = snap.tools.length * RH + 18;

  return (
    <div ref={ref} className="px-3 py-2">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">What was each tool doing? Equipment state over time, SEMI E10 states.</p>
        <div className="flex items-center gap-3">
          <ul className="hidden gap-3 text-[11px] text-muted lg:flex" aria-label="Legend">
            {E10_STATES.map((s) => (
              <li key={s} className="flex items-center gap-1">
                <StatusGlyph state={s} size={9} />
                {E10_LABEL[s]}
              </li>
            ))}
          </ul>
          <div role="group" aria-label="Time window" className="flex">
            {(["shift", "hour"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={win === k}
                onClick={() => setWin(k)}
                className={`min-h-7 border border-line px-2 text-[12px] first:rounded-l-xs last:rounded-r-xs -ml-px first:ml-0 ${win === k ? "border-steel bg-raised text-ink relative z-10" : "text-muted hover:text-ink"}`}
              >
                {k === "shift" ? "Whole shift" : "Last hour"}
              </button>
            ))}
          </div>
        </div>
      </div>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Tool utilization timeline. The equipment tab lists the same states in a table.">
          {snap.tools.map((tool, i) => {
            const y = i * RH;
            const segs = models.gantt[tool.id] ?? [];
            const sel = selection?.kind === "tool" && selection.id === tool.id;
            return (
              <g key={tool.id}>
                <text x={0} y={y + 9} fontSize="10" fontFamily="var(--font-mono)" fill={sel ? "#ff5c93" : "#9bacb9"} style={{ cursor: "pointer" }} onClick={() => select({ kind: "tool", id: tool.id })}>
                  {tool.id}
                </text>
                {segs.map((s, k) => {
                  const a = s.from;
                  const b = s.to ?? now;
                  if (b < t0 || a > t1) return null;
                  const xa = x(a);
                  const xb = x(b);
                  return (
                    <rect key={k} x={xa} y={y + 1} width={Math.max(xb - xa, 0.6)} height={RH - 3} fill={E10_COLOR[s.state]} opacity={s.state === "STANDBY" ? 0.7 : 1}>
                      <title>{`${tool.id} ${E10_LABEL[s.state]} (${s.reason}) ${fmtClock(a)} to ${fmtClock(b)}`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={snap.tools.length * RH} stroke="#0d1115" strokeWidth="1" opacity="0.7" />
              <text x={x(t)} y={H - 4} fontSize="9.5" textAnchor="middle" fill="#9bacb9" fontFamily="var(--font-mono)">
                {fmtClock(t).slice(0, 5)}
              </text>
            </g>
          ))}
          <line x1={x(now)} x2={x(now)} y1={0} y2={snap.tools.length * RH} stroke="#ff5c93" strokeWidth="1.5" />
        </svg>
      )}
    </div>
  );
}
