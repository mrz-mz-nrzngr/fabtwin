import { describe, expect, it } from "vitest";
import { buildConfig } from "./config";
import { FabEngine } from "./engine";
import { vehicleS } from "./motion";
import { OhtTrack } from "./oht";
import type { TrackVehicle } from "./oht";

const mk = (id: string): TrackVehicle => ({ id, s: 0, posT: 0, cell: 0, holding: false, entryT: null, cellsLeft: 0, plan: [], blockedOn: null, blockedSince: 0, waitS: 0 });

function posAt(v: TrackVehicle, t: number): number {
  const plan = v.plan;
  if (!plan.length) return v.s;
  if (t <= plan[0].t0) return plan[0].s0;
  for (const g of plan) if (t <= g.t1) return g.s0 + ((g.s1 - g.s0) * (t - g.t0)) / Math.max(g.t1 - g.t0, 1e-9);
  return plan[plan.length - 1].s1;
}

describe("OHT track blocking", () => {
  it("makes a follower wait behind a vehicle that dwells at a port", () => {
    const arrivals: Array<[string, number]> = [];
    const track = new OhtTrack(304, 6, (v, t) => arrivals.push([v.id, t]));
    const lead = mk("A");
    const follow = mk("B");
    track.register(lead);
    track.register(follow);
    const L = track.cellLen;
    track.place(lead, 10 * L, 0);
    track.place(follow, 2 * L, 0);
    // The leader drives 6 cells and then dwells, still holding its cell. Dwell has not ended, so the cell is held for good.
    track.start(lead, 6, 0);
    track.dwell(lead, arrivals[0][1], 4);
    // The follower wants to go 20 cells, through the leader's position.
    track.start(follow, 20, 0);
    expect(follow.blockedOn).not.toBeNull();
    const stoppedAt = follow.s;
    expect(lead.s - stoppedAt).toBeGreaterThanOrEqual(L * 0.99);
    // The leader moves on three cells and stops again: the follower creeps up behind it but is still blocked.
    track.start(lead, 3, 4);
    expect(follow.s).toBeGreaterThan(stoppedAt);
    expect(lead.s - follow.s).toBeGreaterThanOrEqual(L * 0.99);
    expect(follow.blockedOn).not.toBeNull();
    // The leader finishes and parks in the siding: the follower runs its remaining cells.
    track.park(lead, 8);
    expect(follow.blockedOn).toBeNull();
    expect(follow.cellsLeft).toBe(0);
    expect(follow.waitS).toBeGreaterThan(0);
    expect(arrivals.some(([id]) => id === "B")).toBe(true);
  });

  it("never lets two vehicles closer than one cell, with several on the loop", () => {
    const track = new OhtTrack(304, 6, () => undefined);
    const vs = ["A", "B", "C", "D", "E"].map((id, i) => {
      const v = mk(id);
      track.register(v);
      track.place(v, (i * 304) / 5 + 3, 0);
      return v;
    });
    // Everyone runs 30 cells at once, so they bunch up at the stopped ones' positions.
    for (const v of vs) track.start(v, 30, 0);
    let min = Infinity;
    for (let t = 0; t <= 120; t += 0.25) {
      const ps = vs.filter((v) => v.entryT !== null && t >= v.entryT).map((v) => ((posAt(v, t) % 304) + 304) % 304);
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) {
          const d = Math.abs(ps[i] - ps[j]);
          min = Math.min(min, Math.min(d, 304 - d));
        }
    }
    expect(min).toBeGreaterThanOrEqual(track.cellLen * 0.99);
  });
});

describe("OHT in the engine", () => {
  it("keeps every pair of active vehicles at least one cell apart over a whole shift and records waiting", () => {
    const e = new FabEngine(buildConfig(3));
    const cell = e.snapshot().oht;
    expect(cell.cells).toBeGreaterThan(50);
    const L = e.cfg.loopLength;
    const minGap = L / cell.cells;
    let worst = Infinity;
    let blockedSamples = 0;
    for (let t = 60; t <= e.cfg.shiftS; t += 20) {
      e.advanceTo(t);
      const snap = e.snapshot();
      blockedSamples += snap.oht.blockedNow;
      const act = snap.vehicles.filter((v) => v.phase !== "idle" && v.entryT !== null && t >= v.entryT);
      const ps = act.map((v) => ((vehicleS(v, t) % L) + L) % L);
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) {
          const d = Math.abs(ps[i] - ps[j]);
          worst = Math.min(worst, Math.min(d, L - d));
        }
    }
    expect(worst).toBeGreaterThanOrEqual(minGap * 0.99);
    expect(e.snapshot().oht.waitS).toBeGreaterThan(0);
    expect(blockedSamples).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic, blocking included", () => {
    const run = () => {
      const e = new FabEngine(buildConfig(5));
      e.advanceTo(7200);
      const s = e.snapshot();
      return JSON.stringify({ k: s.kpi, o: s.oht, v: s.vehicles.map((v) => [v.id, v.phase, v.s]) });
    };
    expect(run()).toBe(run());
  });
});
