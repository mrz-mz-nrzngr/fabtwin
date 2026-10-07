"use client";

import { useEffect, useRef } from "react";
import { useFab, simNow } from "@/store/useFab";
import { buildTools, LOOP, loopPos, STOCKERS } from "@/sim/config";
import { vehicleCarrying, vehicleS } from "@/sim/motion";
import { E10_COLOR } from "@/art/StatusGlyph";
import { BAY_NAME } from "./format";
import type { BayId } from "@/sim/types";

const BAY_TINT: Record<BayId, string> = { LITHO: "#2c2a1c", ETCH: "#1c2a2e", DEP: "#1f2433", CMP: "#2a2230", METRO: "#1e2c24" };

/**
 * Simplified 2D floor map. Same data as the 3D scene, drawn as SVG so it works on phones
 * and on machines without WebGL. Vehicles move through refs, not React state.
 */
export function Floor2D({ portrait = false }: { portrait?: boolean }) {
  const snap = useFab((s) => s.snap);
  const selection = useFab((s) => s.selection);
  const select = useFab((s) => s.select);
  const vehRefs = useRef<Record<string, SVGGElement | null>>({});
  const cargoRefs = useRef<Record<string, SVGRectElement | null>>({});

  const P = (x: number, z: number): [number, number] => (portrait ? [-z, x] : [x, z]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const st = useFab.getState();
      const s = st.snap;
      if (s) {
        const t = simNow();
        for (const v of s.vehicles) {
          const g = vehRefs.current[v.id];
          if (!g) continue;
          const pos = loopPos(vehicleS(v, t));
          const [px, pz] = portrait ? [-pos.z, pos.x] : [pos.x, pos.z];
          g.setAttribute("transform", `translate(${px.toFixed(2)} ${pz.toFixed(2)})`);
          const c = cargoRefs.current[v.id];
          if (c) c.setAttribute("opacity", vehicleCarrying(v, t) ? "1" : "0");
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [portrait]);

  if (!snap) return null;
  const toolDefs = snap.tools;
  // Tool positions come from the config embedded in the snapshot order, so import lazily.
  const cfg = positions();
  const pad = 6;
  const w = portrait ? LOOP.z1 - LOOP.z0 + 2 * pad : LOOP.x1 - LOOP.x0 + 2 * pad;
  const h = portrait ? LOOP.x1 - LOOP.x0 + 2 * pad : LOOP.z1 - LOOP.z0 + 2 * pad;
  const minX = portrait ? LOOP.z0 - pad : LOOP.x0 - pad;
  const minY = portrait ? LOOP.x0 - pad : LOOP.z0 - pad;

  const loopRect = (() => {
    const [a, b] = P(LOOP.x0, LOOP.z0);
    const [c, d] = P(LOOP.x1, LOOP.z1);
    return { x: Math.min(a, c), y: Math.min(b, d), w: Math.abs(c - a), h: Math.abs(d - b) };
  })();

  const lotsAt = new Map<string, number>();
  for (const l of snap.lots) if (l.loc.k === "stocker") lotsAt.set(l.loc.id, (lotsAt.get(l.loc.id) ?? 0) + 1);

  return (
    <svg
      viewBox={`${minX} ${minY} ${w} ${h}`}
      className="h-auto w-full"
      style={{ maxHeight: portrait ? undefined : "100%" }}
      role="group"
      aria-label="Simplified floor map. Tools are listed with the same states in the equipment table."
    >
      <rect x={minX} y={minY} width={w} height={h} fill="#0f151a" />
      {snap.bays.map((b) => {
        const rects = cfg.bayRects[b.id];
        return rects.map((r, i) => {
          const [x1, y1] = P(r.x0, r.z0);
          const [x2, y2] = P(r.x1, r.z1);
          return (
            <g key={b.id + i}>
              <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill={BAY_TINT[b.id]} />
              {i === 0 && (
                <text x={Math.min(x1, x2)} y={Math.min(y1, y2) - 0.9} fontSize="2.6" fill="#9bacb9">
                  {BAY_NAME[b.id]}
                </text>
              )}
            </g>
          );
        });
      })}
      <rect x={loopRect.x} y={loopRect.y} width={loopRect.w} height={loopRect.h} fill="none" stroke="#4d6a82" strokeWidth="0.6" />
      <text x={loopRect.x + 1} y={loopRect.y - 1} fontSize="2.3" fill="#7fa6c4">
        OHT loop
      </text>
      {cfg.stockers.map((st) => {
        const [x, y] = P(st.x, st.z);
        return (
          <g key={st.id}>
            <rect x={x - 3} y={y - 4.5} width="6" height="9" fill="#26323c" stroke="#5b7a92" strokeWidth="0.4" />
            <text x={x} y={y - 0.4} fontSize="2.2" textAnchor="middle" fill="#e7edf2">
              {st.id}
            </text>
            <text x={x} y={y + 2.6} fontSize="2.6" textAnchor="middle" fill="#7fa6c4" fontFamily="var(--font-mono)">
              {lotsAt.get(st.id) ?? 0}
            </text>
          </g>
        );
      })}
      {toolDefs.map((t) => {
        const pos = cfg.toolPos[t.id];
        const [x, y] = P(pos.x, pos.z);
        const sel = selection?.kind === "tool" && selection.id === t.id;
        return (
          <g
            key={t.id}
            role="button"
            tabIndex={0}
            aria-label={`${t.id}, ${t.state.toLowerCase().replace("_", " ")}${t.lotId ? `, running ${t.lotId}` : ""}`}
            onClick={() => select({ kind: "tool", id: t.id })}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select({ kind: "tool", id: t.id }))}
            style={{ cursor: "pointer" }}
          >
            <rect x={x - 3.2} y={y - 3.2} width="6.4" height="6.4" fill="transparent" />
            <rect x={x - 2.5} y={y - 2.8} width="5" height="5.6" rx="0.4" fill="#26323c" stroke={sel ? "#ff5c93" : "#3b4a57"} strokeWidth={sel ? 0.7 : 0.35} />
            <rect x={x - 2.5} y={y - 2.8} width="5" height="1.3" fill={E10_COLOR[t.state]} />
            <text x={x} y={y + 1.2} fontSize="2" textAnchor="middle" fill="#e7edf2" fontFamily="var(--font-mono)">
              {t.id.slice(-2)}
            </text>
            {t.lotId && <rect x={x - 1.1} y={y + 1.7} width="2.2" height="0.9" fill="#e7edf2" />}
          </g>
        );
      })}
      {snap.vehicles.map((v) => (
        <g key={v.id} ref={(el) => void (vehRefs.current[v.id] = el)}>
          <circle r="0.9" fill="#7fa6c4" />
          <rect ref={(el) => void (cargoRefs.current[v.id] = el)} x="-0.8" y="0.8" width="1.6" height="1.6" fill="#e7edf2" opacity="0" />
        </g>
      ))}
    </svg>
  );
}

let cached: ReturnType<typeof computePositions> | null = null;
function computePositions() {
  const tools = buildTools(1);
  const toolPos: Record<string, { x: number; z: number }> = {};
  const byBay: Record<string, Array<{ x: number; z: number }>> = {};
  for (const t of tools) {
    toolPos[t.id] = { x: t.x, z: t.z };
    (byBay[t.bay] ??= []).push({ x: t.x, z: t.z });
  }
  const bayRects = {} as Record<BayId, Array<{ x0: number; x1: number; z0: number; z1: number }>>;
  for (const [bay, list] of Object.entries(byBay)) {
    const rows = new Map<number, number[]>();
    for (const p of list) rows.set(p.z, [...(rows.get(p.z) ?? []), p.x]);
    bayRects[bay as BayId] = [...rows.entries()].map(([z, xs]) => ({ x0: Math.min(...xs) - 3.5, x1: Math.max(...xs) + 3.5, z0: z - 4.6, z1: z + 4.6 }));
  }
  return { toolPos, bayRects, stockers: STOCKERS };
}
function positions() {
  return (cached ??= computePositions());
}
