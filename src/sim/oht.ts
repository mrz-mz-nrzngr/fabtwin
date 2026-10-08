import type { VehicleSeg } from "./types";

/**
 * Overhead hoist transport track with blocking.
 *
 * The loop is cut into cells a little longer than one vehicle. A vehicle holds the cell it is
 * in, and holds the next one for the whole time it takes to cross into it, so two vehicles are
 * never closer than one cell centre to centre. A vehicle that cannot enter the next cell waits
 * where it is, and so queues up everything behind it, exactly like a stopped vehicle on a real
 * single-lane monorail with no bypass. Idle vehicles wait in a siding off the track and do not
 * block (a design decision, see docs/VERIFICATION.md).
 *
 * Planning is by reservation: when a vehicle starts or resumes a run, it books every cell it can
 * reach, each with the time it will leave it. A cell with an unknown release time (a vehicle
 * dwelling at a port, or itself stopped) is held until that vehicle plans its next run.
 */

export interface TrackVehicle {
  id: string;
  /** Unwrapped arc position of the vehicle's planned head, always a cell centre while stopped. */
  s: number;
  /** Time at which the vehicle reaches `s`. May be in the future, because runs are planned ahead. */
  posT: number;
  cell: number;
  /** True once the vehicle owns the cell it stands in. */
  holding: boolean;
  /** Time the vehicle took its first cell of the current job. Before it, the vehicle waits in the siding. */
  entryT: number | null;
  cellsLeft: number;
  plan: VehicleSeg[];
  blockedOn: number | null;
  blockedSince: number;
  /** Total seconds this vehicle has spent stopped for another vehicle. */
  waitS: number;
}

export class OhtTrack {
  readonly cells: number;
  readonly cellLen: number;
  private readonly busyUntil: number[];
  private readonly vehicles = new Map<string, TrackVehicle>();

  constructor(
    readonly loopLength: number,
    readonly speed: number,
    private readonly onArrive: (v: TrackVehicle, t: number) => void,
    cellTarget = 3.25,
  ) {
    this.cells = Math.max(4, Math.round(loopLength / cellTarget));
    this.cellLen = loopLength / this.cells;
    this.busyUntil = new Array<number>(this.cells).fill(0);
  }

  register(v: TrackVehicle) {
    this.vehicles.set(v.id, v);
  }

  cellOf(s: number): number {
    const p = ((s % this.loopLength) + this.loopLength) % this.loopLength;
    return Math.min(this.cells - 1, Math.floor(p / this.cellLen));
  }

  center(cell: number): number {
    return (cell + 0.5) * this.cellLen;
  }

  /** Cells to drive forward from cell a to cell b. */
  fwdCells(a: number, b: number): number {
    return (((b - a) % this.cells) + this.cells) % this.cells;
  }

  /** Put a vehicle at rest at the centre of the cell containing s. */
  place(v: TrackVehicle, s: number, t: number) {
    v.cell = this.cellOf(s);
    v.s = this.center(v.cell);
    v.posT = t;
    v.holding = false;
    v.entryT = null;
    v.cellsLeft = 0;
    v.plan = [];
    v.blockedOn = null;
  }

  /** Start a run of `cells` cells from where the vehicle stands, no earlier than `now`. */
  start(v: TrackVehicle, cells: number, now: number) {
    v.cellsLeft = cells;
    v.posT = Math.max(v.posT, now);
    this.plan(v, now);
  }

  /** Stand still for a dwell. The cell stays held. Returns the end time. */
  dwell(v: TrackVehicle, t0: number, seconds: number): number {
    this.addSeg(v, t0, t0 + seconds, v.s, v.s);
    v.posT = t0 + seconds;
    return v.posT;
  }

  /** Give up the cell the vehicle stands in and go to the siding. */
  park(v: TrackVehicle, now: number) {
    if (v.holding) this.free(v.cell, Math.max(now, v.posT), now);
    v.holding = false;
    v.entryT = null;
    v.s = this.center(v.cell);
    v.cellsLeft = 0;
  }

  /** Cells currently held, for tests and instrumentation. */
  heldCells(now: number): number[] {
    const out: number[] = [];
    this.busyUntil.forEach((b, c) => {
      if (b > now) out.push(c);
    });
    return out;
  }

  private free(cell: number, at: number, now: number) {
    this.busyUntil[cell] = at;
    this.wake(cell, now);
  }

  private wake(cell: number, now: number) {
    const waiting = [...this.vehicles.values()]
      .filter((x) => x.blockedOn === cell)
      .sort((a, b) => a.blockedSince - b.blockedSince || (a.id < b.id ? -1 : 1));
    for (const w of waiting) {
      if (this.busyUntil[cell] === Infinity && w.blockedOn === cell) continue;
      w.blockedOn = null;
      this.plan(w, now);
    }
  }

  private addSeg(v: TrackVehicle, t0: number, t1: number, s0: number, s1: number) {
    if (t1 <= t0) return;
    const last = v.plan[v.plan.length - 1];
    const still = s0 === s1;
    if (last && last.t1 === t0 && last.s1 === s0) {
      const lastStill = last.s0 === last.s1;
      const sameRate = !still && !lastStill && Math.abs((last.s1 - last.s0) / (last.t1 - last.t0) - (s1 - s0) / (t1 - t0)) < 1e-9;
      if ((still && lastStill) || sameRate) {
        last.t1 = t1;
        last.s1 = s1;
        return;
      }
    }
    v.plan.push({ t0, t1, s0, s1 });
  }

  private plan(v: TrackVehicle, now: number) {
    let t = v.posT;
    let s = v.s;
    if (!v.holding) {
      const b = this.busyUntil[v.cell];
      if (b === Infinity) {
        this.block(v, v.cell, t);
        return;
      }
      const te = Math.max(t, b);
      if (te > t) this.addSeg(v, t, te, s, s);
      v.waitS += te - t;
      t = te;
      this.busyUntil[v.cell] = Infinity;
      v.holding = true;
      v.entryT = te;
    }
    const dt = this.cellLen / this.speed;
    while (v.cellsLeft > 0) {
      const nc = (v.cell + 1) % this.cells;
      const b = this.busyUntil[nc];
      if (b === Infinity) {
        v.posT = t;
        v.s = s;
        this.block(v, nc, t);
        return;
      }
      const te = Math.max(t, b);
      if (te > t) {
        this.addSeg(v, t, te, s, s);
        v.waitS += te - t;
      }
      this.busyUntil[nc] = Infinity;
      const ta = te + dt;
      this.addSeg(v, te, ta, s, s + this.cellLen);
      this.busyUntil[v.cell] = ta;
      const left = v.cell;
      s += this.cellLen;
      v.cell = nc;
      v.cellsLeft--;
      t = ta;
      v.posT = t;
      v.s = s;
      this.wake(left, now);
    }
    v.posT = t;
    v.s = s;
    v.blockedOn = null;
    this.onArrive(v, t);
  }

  private block(v: TrackVehicle, cell: number, t: number) {
    if (v.blockedOn !== cell) v.blockedSince = t;
    v.blockedOn = cell;
    v.posT = t;
  }
}
