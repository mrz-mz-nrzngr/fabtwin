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

/** True once the vehicle has picked up its lot (after the first dwell). */
export function vehicleCarrying(v: VehicleView, t: number): boolean {
  if (!v.lotId) return false;
  const plan = v.plan;
  return plan.length >= 3 ? t >= plan[2].t0 && t < plan[3].t1 : true;
}
