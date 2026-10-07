"use client";

import { useFab } from "@/store/useFab";
import { BAY_ORDER } from "@/sim/types";
import { useWidth } from "../hooks";
import { BAY_NAME } from "../format";

const COLORS = { processing: "#3ecf8e", transit: "#4d6a82", waiting: "#7fa6c4", held: "#f0b429" } as const;

export function WipChart() {
  const snap = useFab((s) => s.snap);
  const [ref, w] = useWidth<HTMLDivElement>();
  if (!snap) return null;
  const rows = BAY_ORDER.flatMap((b) => snap.wip.filter((r) => r.bay === b));
  const total = (r: (typeof rows)[number]) => r.waiting + r.transit + r.processing + r.held;
  const max = Math.max(4, ...rows.map(total));
  const cols = w >= 640 ? 2 : 1;
  const perCol = Math.ceil(rows.length / cols);
  const colW = cols === 2 ? (w - 16) / 2 : w;
  const labelW = 74;
  const barMax = Math.max(40, colW - labelW - 34);
  const RH = 15;

  return (
    <div ref={ref} className="px-3 py-2">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[12px] text-muted">Where are lots piling up? Lots in flight by process step, now. Total {snap.kpi.wip}.</p>
        <ul className="flex gap-3 text-[11px] text-muted" aria-label="Legend">
          {(Object.keys(COLORS) as Array<keyof typeof COLORS>).map((k) => (
            <li key={k} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2" style={{ background: COLORS[k] }} />
              {k === "processing" ? "In tool" : k === "transit" ? "Moving" : k === "waiting" ? "Waiting" : "Held"}
            </li>
          ))}
        </ul>
      </div>
      {w > 0 && (
        <svg width={w} height={perCol * RH + 4} role="img" aria-label="Work in progress by process step. The lots tab lists every lot with its current step.">
          {rows.map((r, i) => {
            const col = Math.floor(i / perCol);
            const row = i % perCol;
            const x0 = col * (colW + 16);
            const y = row * RH;
            let x = x0 + labelW;
            const seg = (n: number, c: string, key: string) => {
              if (!n) return null;
              const wd = (n / max) * barMax;
              const el = <rect key={key} x={x} y={y + 2} width={Math.max(wd - 1, 1)} height={RH - 5} fill={c} />;
              x += wd;
              return el;
            };
            return (
              <g key={r.recipe}>
                <text x={x0} y={y + 11} fontSize="10.5" fill="#9bacb9" fontFamily="var(--font-mono)">
                  <title>{`${r.recipe} (${BAY_NAME[r.bay]})`}</title>
                  {r.recipe}
                </text>
                {seg(r.processing, COLORS.processing, "p")}
                {seg(r.transit, COLORS.transit, "t")}
                {seg(r.waiting, COLORS.waiting, "w")}
                {seg(r.held, COLORS.held, "h")}
                <text x={x + 4} y={y + 11} fontSize="10.5" fill="#e7edf2" fontFamily="var(--font-mono)">
                  {total(r)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
