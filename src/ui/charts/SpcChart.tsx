"use client";

import { useState } from "react";
import { useFab } from "@/store/useFab";
import { RULE_TEXT } from "@/sim/spc";
import { useWidth } from "../hooks";
import { Empty } from "../kit";
import { Wafer } from "@/art/Wafer";
import { fmtClock } from "../format";

export function SpcChart() {
  const snap = useFab((s) => s.snap);
  const select = useFab((s) => s.select);
  const [param, setParam] = useState<"CD" | "OVL" | "THK">("CD");
  const [ref, w] = useWidth<HTMLDivElement>();
  if (!snap) return null;
  const series = snap.spc.find((s) => s.param === param) ?? snap.spc[0];
  const pts = series.points.slice(-70);
  const H = 190;
  const padL = 44;
  const padR = 10;
  const padT = 8;
  const padB = 16;
  const wide = w >= 720;
  const chartW = wide ? w - 24 - 230 : w;
  const plotW = Math.max(80, chartW - padL - padR);
  const zMax = 4.2;
  const y = (v: number) => {
    const z = (v - series.target) / series.sigma;
    const c = Math.max(-zMax, Math.min(zMax, z));
    return padT + ((zMax - c) / (2 * zMax)) * (H - padT - padB);
  };
  const x = (i: number) => padL + (pts.length <= 1 ? plotW / 2 : (i / (Math.max(pts.length, 70) - 1)) * plotW);
  const levels: Array<[number, string, string, string]> = [
    [3, "#f0524f", "5 4", "+3σ"],
    [2, "#4d6a82", "2 3", ""],
    [1, "#33414d", "2 3", ""],
    [0, "#7fa6c4", "", "CL"],
    [-1, "#33414d", "2 3", ""],
    [-2, "#4d6a82", "2 3", ""],
    [-3, "#f0524f", "5 4", "-3σ"],
  ];
  const viol = [...series.points].reverse().filter((p) => p.rules.length > 0).slice(0, 6);

  return (
    <div ref={ref} className="px-3 py-2">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">
          {series.label}, individual values in {series.unit}. Metrology lots only. Limits are fixed at target ± 3σ ({series.target} ± {(series.sigma * 3).toFixed(1)} {series.unit}).
        </p>
        <div role="tablist" aria-label="SPC parameter" className="flex">
          {snap.spc.map((s) => (
            <button
              key={s.param}
              role="tab"
              aria-selected={param === s.param}
              onClick={() => setParam(s.param)}
              className={`num min-h-7 border border-line px-2.5 text-[12px] first:rounded-l-xs last:rounded-r-xs -ml-px first:ml-0 ${param === s.param ? "border-steel bg-raised text-ink relative z-10" : "text-muted hover:text-ink"}`}
            >
              {s.param}
            </button>
          ))}
        </div>
      </div>
      {pts.length === 0 ? (
        <Empty art={<Wafer size={72} />} title="No measurements yet">
          Metrology tools post a point each time a lot is measured. Start the shift and the chart fills as lots reach CD-SEM, overlay and film-thickness steps.
        </Empty>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: wide ? "1fr 230px" : "1fr" }}>
          <svg width={chartW} height={H} role="img" aria-label={`SPC chart for ${series.label}. ${viol.length} recent rule violations. A list of violations sits beside the chart.`}>
            {levels.map(([z, c, dash, label]) => (
              <g key={z}>
                <line x1={padL} x2={padL + plotW} y1={y(series.target + z * series.sigma)} y2={y(series.target + z * series.sigma)} stroke={c} strokeDasharray={dash} strokeWidth={z === 0 ? 1.2 : 1} />
                <text x={padL - 5} y={y(series.target + z * series.sigma) + 3} fontSize="9.5" textAnchor="end" fill="#9bacb9" fontFamily="var(--font-mono)">
                  {label || (z > 0 ? `+${z}σ` : `${z}σ`)}
                </text>
              </g>
            ))}
            <polyline points={pts.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} fill="none" stroke="#4d6a82" strokeWidth="1" />
            {pts.map((p, i) => {
              const cx = x(i);
              const cy = y(p.value);
              const r1 = p.rules.includes(1);
              if (p.rules.length === 0) return <circle key={i} cx={cx} cy={cy} r="2.3" fill="#7fa6c4" />;
              return r1 ? (
                <polygon key={i} points={`${cx},${cy - 5} ${cx + 4.5},${cy + 4} ${cx - 4.5},${cy + 4}`} fill="#f0524f">
                  <title>{`${p.lotId} ${p.value} ${series.unit}, ${p.rules.map((r) => RULE_TEXT[r]).join(", ")}`}</title>
                </polygon>
              ) : (
                <rect key={i} x={cx - 3.5} y={cy - 3.5} width="7" height="7" fill="#f0b429">
                  <title>{`${p.lotId} ${p.value} ${series.unit}, ${p.rules.map((r) => RULE_TEXT[r]).join(", ")}`}</title>
                </rect>
              );
            })}
          </svg>
          <div>
            <p className="mb-1 text-[12px] font-medium text-muted">Rule violations, newest first</p>
            {viol.length === 0 ? (
              <p className="text-[12px] text-muted">None. Western Electric rules 1 to 4 are checked on every point.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {viol.map((p) => (
                  <li key={p.lotId + p.t} className="text-[12px]">
                    <span className="num text-[11px] text-muted">
                      {fmtClock(p.t).slice(0, 5)} · {p.lotId}
                    </span>
                    <span className="block leading-snug">{p.rules.map((r) => RULE_TEXT[r]).join("; ")}</span>
                    {p.upstream !== "-" && (
                      <button type="button" className="num text-[11px] text-steel hover:text-ink" onClick={() => select({ kind: "tool", id: p.upstream })}>
                        Suspect {p.upstream}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-muted">Triangle: rule 1 (lot auto-held). Square: rules 2 to 4.</p>
          </div>
        </div>
      )}
    </div>
  );
}
