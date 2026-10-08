import type { VehicleView } from "./types";

/** Arc position (unwrapped, mod the loop length for display) of a vehicle at time t, from its planned legs. */
export function vehicleS(v: VehicleView, t: number): number {
  const plan = v.plan;
  if (!plan.length) return v.s;
  if (t <= plan[0].t0) return plan[0].s0;
  for (const seg of plan) {
    if (t <= seg.t1) {
      const span = seg.t1 - seg.t0;
      const k = span > 0 ? (t - seg.t0) / span : 1;
      return seg.s0 + (seg.s1 - seg.s0) * k;
    }
  }
  return plan[plan.length - 1].s1;
}

export type FoupPhase = "none" | "lift" | "carry" | "lower";

/** Where the vehicle's FOUP is at time t: waiting at the port, rising, hanging, or being lowered. k runs 0..1 inside lift and lower. */
export function foupPhase(v: VehicleView, t: number): { phase: FoupPhase; k: number } {
  if (!v.jobLotId) return { phase: "none", k: 0 };
  if (v.lowerT0 !== null && t >= v.lowerT0) {
    const k = Math.min(1, (t - v.lowerT0) / Math.max((v.lowerT1 ?? v.lowerT0) - v.lowerT0, 1e-6));
    return { phase: "lower", k };
  }
  if (v.liftT0 === null || t < v.liftT0) return { phase: "none", k: 0 };
  if (v.liftT1 !== null && t < v.liftT1) return { phase: "lift", k: (t - v.liftT0) / Math.max(v.liftT1 - v.liftT0, 1e-6) };
  return { phase: "carry", k: 0 };
}

/** True once the vehicle has picked up its lot, until the lot is lowered at the destination. */
export function vehicleCarrying(v: VehicleView, t: number): boolean {
  const p = foupPhase(v, t).phase;
  return p === "carry" || p === "lift" || p === "lower";
}
