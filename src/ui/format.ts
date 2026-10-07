import type { BayId } from "@/sim/types";

export function fmtClock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function fmtMin(s: number): string {
  const sign = s < 0 ? "-" : "";
  const a = Math.abs(Math.round(s));
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}

export function fmtDur(s: number): string {
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

export const BAY_NAME: Record<BayId, string> = {
  LITHO: "Lithography",
  ETCH: "Etch",
  DEP: "Deposition",
  CMP: "CMP",
  METRO: "Metrology",
};

export const pct = (x: number) => `${Math.round(x * 100)}%`;
