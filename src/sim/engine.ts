import { CEID, SCHEMA_VERSION } from "@/events/types";
import type { AlarmSeverity, E10State, FabEvent } from "@/events/types";
import { rankLots } from "./dispatch";
import type { RankInput } from "./dispatch";
import { canTransition, emptyStateTime } from "./e10";
import { erand, nrand, urand, wrand } from "./rng";
import { routeRawS, weibullScaleForMean } from "./config";
import { evaluateRules } from "./spc";
import { scoreOf } from "./score";
import type {
  BayId,
  BayView,
  Command,
  CommandResult,
  DispatchRule,
  Kpi,
  Loc,
  LotStatus,
  LotView,
  ObjectiveView,
  RecipeDef,
  RouteDef,
  SimConfig,
  Snapshot,
  SpcPoint,
  SpcSeries,
  ToolDef,
  ToolView,
  VehicleSeg,
  VehicleView,
  WipRow,
} from "./types";

type Ref = { k: "tool" | "stocker"; id: string };

interface Sched {
  t: number;
  seq: number;
  type: string;
  id?: string;
  n?: number;
  epoch?: number;
}

class Heap {
  private a: Sched[] = [];
  get size() {
    return this.a.length;
  }
  peek(): Sched | undefined {
    return this.a[0];
  }
  private less(x: Sched, y: Sched) {
    return x.t < y.t || (x.t === y.t && x.seq < y.seq);
  }
  push(e: Sched) {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): Sched | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

interface Lot {
  id: string;
  route: RouteDef;
  hot: boolean;
  prio: 0 | 1;
  step: number;
  status: LotStatus;
  loc: Loc;
  toolId: string | null;
  held: boolean;
  holdReason: "operator" | "spc" | null;
  holdSince: number;
  due: number;
  releasedAt: number;
  readyAt: number;
  qt: { step: number; startT: number; limitS: number } | null;
  qtViolations: number;
  rework: boolean;
  ooc: { t: number; toolId: string; param: string } | null;
  lastProcTool: string | null;
  doneT: number | null;
}

interface Tool {
  def: ToolDef;
  state: E10State;
  reason: string;
  since: number;
  stateTime: Record<E10State, number>;
  current: string | null;
  procStartT: number;
  procEndsAt: number;
  procRemaining: number | null;
  assigned: string | null;
  assignedArrived: boolean;
  prestageOpen: boolean;
  recipe: string | null;
  opEpoch: number;
  failEpoch: number;
  pmEpoch: number;
  excEpoch: number;
  failAt: number | null;
  failCount: number;
  warned: boolean;
  pmPending: boolean;
  lastPmAt: number;
  pmDueAt: number;
  pmCount: number;
  drift: number;
  excCount: number;
  repairCount: number;
  crew: "none" | "waiting" | "assigned";
  endsAt: number | null;
  lotsDone: number;
}

interface Vehicle {
  id: string;
  s: number;
  jobId: number | null;
  lotId: string | null;
  jobLot: string | null;
  jobTo: Ref | null;
  plan: VehicleSeg[];
}

interface Job {
  id: number;
  lotId: string;
  from: Ref;
  to: Ref;
  createdAt: number;
}

interface Alarm {
  id: string;
  key: string;
  code: string;
}

interface Done {
  lotId: string;
  hot: boolean;
  ctS: number;
  rawS: number;
  due: number;
  doneT: number;
  onTime: boolean;
  ooc: boolean;
}

const WEIBULL_SHAPE = 2;
const RELEVANT_DRIFT_BAYS: ReadonlySet<BayId> = new Set<BayId>(["LITHO", "DEP", "CMP"]);
const SPC_AUTO_RELEASE_S = 900;
const WARN_LEAD_S = 900;

export class FabEngine {
  readonly cfg: SimConfig;
  now = 0;
  ended = false;

  private heap = new Heap();
  private seq = 0;
  private evSeq = 0;
  private out: FabEvent[] = [];

  private tools = new Map<string, Tool>();
  private toolsByBay = new Map<BayId, Tool[]>();
  private lots = new Map<string, Lot>();
  private stockers = new Map<string, Set<string>>();
  private vehicles: Vehicle[] = [];
  private jobs: Job[] = [];
  private jobSeq = 0;
  private rules = new Map<BayId, DispatchRule>();
  private recipes: Record<string, RecipeDef>;
  private routeRaw = new Map<string, number>();
  private lotSeq = 0;
  private releaseK = 0;
  private alarms = new Map<string, Alarm>();
  private alarmSeq = 0;
  private done: Done[] = [];
  private qtViolations = 0;
  private oocEscapes = 0;
  private crewQueue: string[] = [];
  private crewBusy = 0;
  private expeditesLeft: number;
  private spcPoints = new Map<string, SpcPoint[]>();
  private spcFull = new Map<string, number[]>();
  private bayCenterS = new Map<BayId, number>();
  readonly commandLog: Array<{ t: number; cmd: Command; result: CommandResult }> = [];
  readonly qtLog: Array<{ t: number; lotId: string; recipe: string }> = [];
  readonly failureLog: Array<{ t: number; toolId: string }> = [];
  readonly holdLog: Array<{ t: number; lotId: string; releasedAt: number | null }> = [];

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.recipes = cfg.recipes;
    this.expeditesLeft = cfg.expediteBudget;
    for (const r of cfg.routes) this.routeRaw.set(r.id, routeRawS(r, cfg.recipes));
    for (const b of cfg.bays) {
      this.rules.set(b.id, b.defaultRule);
      this.toolsByBay.set(b.id, []);
    }
    for (const s of cfg.stockers) this.stockers.set(s.id, new Set());
    for (const def of cfg.tools) {
      const t: Tool = {
        def,
        state: "STANDBY",
        reason: "initial",
        since: 0,
        stateTime: emptyStateTime(),
        current: null,
        procStartT: 0,
        procEndsAt: 0,
        procRemaining: null,
        assigned: null,
        assignedArrived: false,
        prestageOpen: false,
        recipe: null,
        opEpoch: 0,
        failEpoch: 0,
        pmEpoch: 0,
        excEpoch: 0,
        failAt: null,
        failCount: 0,
        warned: false,
        pmPending: false,
        lastPmAt: -urand(cfg.seed, "pmage", def.id) * def.pmIntervalS * 0.8,
        pmDueAt: 0,
        pmCount: 0,
        drift: 0,
        excCount: 0,
        repairCount: 0,
        crew: "none",
        endsAt: null,
        lotsDone: 0,
      };
      this.tools.set(def.id, t);
      this.toolsByBay.get(def.bay)!.push(t);
    }
    for (const b of cfg.bays) {
      const ts = this.toolsByBay.get(b.id)!;
      this.bayCenterS.set(b.id, ts.reduce((a, t) => a + t.def.loopS, 0) / Math.max(ts.length, 1));
    }
    for (let i = 0; i < cfg.vehicleCount; i++) {
      this.vehicles.push({
        id: `OHT-${String(i + 1).padStart(2, "0")}`,
        s: (i * cfg.loopLength) / cfg.vehicleCount,
        jobId: null,
        lotId: null,
        jobLot: null,
        jobTo: null,
        plan: [],
      });
    }
    this.bootstrap();
  }

  // ---------------------------------------------------------------- bootstrap

  private bootstrap() {
    const cfg = this.cfg;
    for (const t of this.tools.values()) {
      this.emitState(t, null, "STANDBY", "initial");
      this.scheduleFailure(t);
      this.schedulePmDue(t);
      this.scheduleExcursion(t);
    }
    for (let i = 0; i < cfg.warmLots; i++) {
      const route = this.pickRoute(urand(cfg.seed, "warm-route", i));
      const hot = urand(cfg.seed, "warm-hot", i) < cfg.hotFraction;
      const step = Math.floor(urand(cfg.seed, "warm-step", i) * route.steps.length * 0.92);
      const raw = this.routeRaw.get(route.id)!;
      const releasedAt = -(step / route.steps.length) * raw * (hot ? 1.5 : 2.6) - 60;
      const lot = this.makeLot(route, hot, releasedAt, step);
      const stockerId = cfg.stockers[Math.floor(urand(cfg.seed, "warm-st", i) * cfg.stockers.length)].id;
      lot.loc = { k: "stocker", id: stockerId };
      lot.status = "waiting";
      lot.readyAt = -urand(cfg.seed, "warm-ready", i) * 400;
      this.stockers.get(stockerId)!.add(lot.id);
      const qtDef = route.steps[step].qtS;
      if (qtDef) lot.qt = { step, startT: -urand(cfg.seed, "warm-qt", i) * qtDef * 0.15, limitS: qtDef };
      this.lots.set(lot.id, lot);
      this.scheduleQt(lot);
    }
    if (cfg.releasesEnabled) this.push({ type: "release", t: cfg.releaseIntervalS / 2, n: 0 });
    for (const b of cfg.bays) this.dispatchBay(b.id);
  }

  private pickRoute(u: number): RouteDef {
    let acc = 0;
    for (const r of this.cfg.routes) {
      acc += r.mix;
      if (u < acc) return r;
    }
    return this.cfg.routes[this.cfg.routes.length - 1];
  }

  private makeLot(route: RouteDef, hot: boolean, releasedAt: number, step = 0): Lot {
    const raw = this.routeRaw.get(route.id)!;
    const id = `L${String(++this.lotSeq).padStart(4, "0")}`;
    return {
      id,
      route,
      hot,
      prio: 0,
      step,
      status: "waiting",
      loc: { k: "gone" },
      toolId: null,
      held: false,
      holdReason: null,
      holdSince: 0,
      due: releasedAt + raw * (hot ? this.cfg.dueFactor.hot : this.cfg.dueFactor.normal),
      releasedAt,
      readyAt: releasedAt,
      qt: null,
      qtViolations: 0,
      rework: false,
      ooc: null,
      lastProcTool: null,
      doneT: null,
    };
  }

  // ---------------------------------------------------------------- scheduling

  private push(e: Omit<Sched, "seq">) {
    this.heap.push({ ...e, seq: this.seq++ });
  }

  advanceTo(target: number) {
    const to = Math.min(target, this.cfg.shiftS);
    if (this.ended || to < this.now) return;
    for (;;) {
      const top = this.heap.peek();
      if (!top || top.t > to) break;
      this.heap.pop();
      this.now = top.t;
      this.handle(top);
    }
    this.now = to;
    if (this.now >= this.cfg.shiftS) this.ended = true;
  }

  drainEvents(): FabEvent[] {
    const e = this.out;
    this.out = [];
    return e;
  }

  private handle(e: Sched) {
    switch (e.type) {
      case "release":
        return this.onRelease(e.n!);
      case "procEnd": {
        const t = this.tools.get(e.id!)!;
        if (t.opEpoch === e.epoch) this.onProcEnd(t);
        return;
      }
      case "setupEnd": {
        const t = this.tools.get(e.id!)!;
        if (t.opEpoch === e.epoch) this.onSetupEnd(t);
        return;
      }
      case "prestage": {
        const t = this.tools.get(e.id!)!;
        if (t.opEpoch === e.epoch && t.state === "PRODUCTIVE") {
          t.prestageOpen = true;
          this.dispatchBay(t.def.bay);
        }
        return;
      }
      case "pmDue": {
        const t = this.tools.get(e.id!)!;
        if (t.pmEpoch === e.epoch) this.onPmDue(t);
        return;
      }
      case "pmEnd": {
        const t = this.tools.get(e.id!)!;
        if (t.opEpoch === e.epoch) this.onPmEnd(t);
        return;
      }
      case "qualEnd": {
        const t = this.tools.get(e.id!)!;
        if (t.opEpoch === e.epoch) this.onQualEnd(t);
        return;
      }
      case "fail": {
        const t = this.tools.get(e.id!)!;
        if (t.failEpoch === e.epoch) this.onFail(t);
        return;
      }
      case "warn": {
        const t = this.tools.get(e.id!)!;
        if (t.failEpoch === e.epoch && !t.warned) {
          t.warned = true;
          this.setAlarm(`WARN:${t.def.id}`, "TOOL_DEGRADED", "warning", `${t.def.id} vibration and temperature trending high. Failure likely soon.`, { toolId: t.def.id });
        }
        return;
      }
      case "repairEnd": {
        const t = this.tools.get(e.id!)!;
        if (t.opEpoch === e.epoch) this.onRepairEnd(t);
        return;
      }
      case "excursion": {
        const t = this.tools.get(e.id!)!;
        if (t.excEpoch === e.epoch) this.onExcursion(t);
        return;
      }
      case "qtWarn":
        return this.onQtWarn(e.id!, e.n!);
      case "qtExpire":
        return this.onQtExpire(e.id!, e.n!);
      case "vehPick":
        return this.onVehPick(e.id!);
      case "vehDrop":
        return this.onVehDrop(e.id!);
      case "autoRelease": {
        const lot = this.lots.get(e.id!);
        if (lot && lot.held && lot.holdReason === "spc" && lot.holdSince === e.n) this.doRelease(lot, "auto-disposition");
        return;
      }
    }
  }

  // ---------------------------------------------------------------- events out

  private emit<T extends FabEvent["type"]>(type: T, data: Extract<FabEvent, { type: T }>["data"]) {
    this.out.push({
      v: SCHEMA_VERSION,
      seq: ++this.evSeq,
      t: this.cfg.epochMs + Math.round(this.now * 1000),
      source: "fabtwin-sim",
      type,
      data,
    } as FabEvent);
  }

  private ce(ceid: number, name: string, extra: { toolId?: string; lotId?: string; reports?: Record<string, string | number | boolean | null> } = {}) {
    this.emit("collection_event", { ceid, name, ...extra });
  }

  private emitState(t: Tool, from: E10State | null, to: E10State, reason: string) {
    this.emit("equipment.state_changed", {
      toolId: t.def.id,
      from,
      to,
      reason,
      lotId: t.current,
      recipe: t.recipe,
    });
  }

  private setState(t: Tool, to: E10State, reason: string, endsIn: number | null = null) {
    const from = t.state;
    if (from === to) {
      t.reason = reason;
      t.endsAt = endsIn === null ? null : this.now + endsIn;
      return;
    }
    if (!canTransition(from, to)) throw new Error(`Illegal E10 transition ${from} -> ${to} on ${t.def.id}`);
    t.stateTime[from] += this.now - t.since;
    t.state = to;
    t.reason = reason;
    t.since = this.now;
    t.endsAt = endsIn === null ? null : this.now + endsIn;
    this.emitState(t, from, to, reason);
  }

  private setAlarm(key: string, code: string, severity: AlarmSeverity, text: string, ref: { toolId?: string; lotId?: string }) {
    if (this.alarms.has(key)) return;
    const id = `ALM-${String(++this.alarmSeq).padStart(4, "0")}`;
    this.alarms.set(key, { id, key, code });
    this.emit("alarm.set", { alarmId: id, code, severity, text, ...ref });
  }

  private clearAlarm(key: string, by = "auto", ref: { toolId?: string; lotId?: string } = {}) {
    const a = this.alarms.get(key);
    if (!a) return;
    this.alarms.delete(key);
    this.emit("alarm.cleared", { alarmId: a.id, code: a.code, clearedBy: by, ...ref });
  }

  // ---------------------------------------------------------------- lots and dispatch

  private stepBay(l: Lot): BayId {
    return this.recipes[l.route.steps[l.step].recipe].bay;
  }

  private rankInput(l: Lot): RankInput {
    let raw = 0;
    for (let i = l.step; i < l.route.steps.length; i++) raw += this.recipes[l.route.steps[i].recipe].processS;
    return {
      id: l.id,
      prio: l.prio,
      urgent: l.qt !== null && l.qt.step === l.step && this.now - l.qt.startT >= l.qt.limitS * 0.75,
      readyAt: l.readyAt,
      due: l.due,
      recipe: l.route.steps[l.step].recipe,
      remainingRawS: raw,
      remainingSteps: l.route.steps.length - l.step,
    };
  }

  private toolEligible(t: Tool): boolean {
    if (t.pmPending || t.assigned !== null) return false;
    return (t.state === "STANDBY" && t.current === null) || (t.state === "PRODUCTIVE" && t.prestageOpen);
  }

  private dispatchBay(bay: BayId) {
    if (this.ended) return;
    const tools = this.toolsByBay.get(bay)!.filter((t) => this.toolEligible(t));
    if (!tools.length) return;
    tools.sort((a, b) => a.since - b.since || (a.def.id < b.def.id ? -1 : 1));
    const rule = this.rules.get(bay)!;
    for (const tool of tools) {
      const cands: RankInput[] = [];
      for (const l of this.lots.values()) {
        if (l.status === "waiting" && !l.held && l.loc.k === "stocker" && this.stepBay(l) === bay) cands.push(this.rankInput(l));
      }
      if (!cands.length) break;
      const best = rankLots(cands, { rule, now: this.now, toolRecipe: tool.recipe })[0];
      this.assignLot(tool, this.lots.get(best.id)!);
    }
  }

  private assignLot(tool: Tool, lot: Lot) {
    tool.assigned = lot.id;
    tool.assignedArrived = false;
    lot.toolId = tool.def.id;
    lot.status = "transit";
    this.requestTransport(lot, lot.loc as Ref, { k: "tool", id: tool.def.id });
  }

  /** Drop an assignment that cannot be honoured. A lot already at the tool is sent back to a stocker. */
  private evictAssigned(tool: Tool) {
    const id = tool.assigned;
    if (!id) return;
    const lot = this.lots.get(id)!;
    tool.assigned = null;
    tool.assignedArrived = false;
    lot.toolId = null;
    if (lot.loc.k === "tool" && lot.loc.id === tool.def.id) {
      this.sendToStocker(lot, { k: "tool", id: tool.def.id });
      return;
    }
    const qi = this.jobs.findIndex((j) => j.lotId === lot.id);
    if (qi >= 0) {
      this.jobs.splice(qi, 1);
      lot.status = "waiting";
      this.dispatchBay(this.stepBay(lot));
    }
    // Otherwise a vehicle is already carrying it. It bounces on arrival.
  }

  private chooseStocker(fromS: number, target: BayId): string {
    const L = this.cfg.loopLength;
    const fwd = (a: number, b: number) => (((b - a) % L) + L) % L;
    const c = this.bayCenterS.get(target)!;
    let best = this.cfg.stockers[0];
    let bestCost = Infinity;
    for (const s of this.cfg.stockers) {
      const cost = fwd(fromS, s.loopS) + fwd(s.loopS, c);
      if (cost < bestCost) {
        bestCost = cost;
        best = s;
      }
    }
    return best.id;
  }

  private sendToStocker(lot: Lot, from: Ref) {
    lot.status = "transit";
    const fromS = this.refS(from);
    const target = lot.step < lot.route.steps.length ? this.stepBay(lot) : "METRO";
    this.requestTransport(lot, from, { k: "stocker", id: this.chooseStocker(fromS, target) });
  }

  private refS(r: Ref): number {
    return r.k === "tool" ? this.tools.get(r.id)!.def.loopS : this.cfg.stockers.find((s) => s.id === r.id)!.loopS;
  }

  // ---------------------------------------------------------------- transport (OHT)

  private requestTransport(lot: Lot, from: Ref, to: Ref) {
    this.jobs.push({ id: ++this.jobSeq, lotId: lot.id, from, to, createdAt: this.now });
    this.assignVehicles();
  }

  private assignVehicles() {
    const L = this.cfg.loopLength;
    const fwd = (a: number, b: number) => (((b - a) % L) + L) % L;
    while (this.jobs.length) {
      const idle = this.vehicles.filter((v) => v.jobId === null);
      if (!idle.length) return;
      let bi = 0;
      for (let i = 1; i < this.jobs.length; i++) {
        const a = this.jobs[i];
        const b = this.jobs[bi];
        const pa = this.jobRank(a);
        const pb = this.jobRank(b);
        if (pa > pb || (pa === pb && a.createdAt < b.createdAt)) bi = i;
      }
      const job = this.jobs.splice(bi, 1)[0];
      const fromS = this.refS(job.from);
      const toS = this.refS(job.to);
      let v = idle[0];
      let bd = Infinity;
      for (const c of idle) {
        const d = fwd(c.s, fromS);
        if (d < bd) {
          bd = d;
          v = c;
        }
      }
      const sp = this.cfg.vehicleSpeed;
      const dw = this.cfg.vehicleDwellS;
      const dCarry = fwd(fromS, toS);
      const t0 = this.now;
      const tArr = t0 + bd / sp;
      const tPick = tArr + dw;
      const tDrop = tPick + dCarry / sp;
      const tDone = tDrop + dw;
      const s0 = v.s;
      v.plan = [
        { t0, t1: tArr, s0, s1: s0 + bd },
        { t0: tArr, t1: tPick, s0: s0 + bd, s1: s0 + bd },
        { t0: tPick, t1: tDrop, s0: s0 + bd, s1: s0 + bd + dCarry },
        { t0: tDrop, t1: tDone, s0: s0 + bd + dCarry, s1: s0 + bd + dCarry },
      ];
      v.jobId = job.id;
      v.jobLot = job.lotId;
      v.jobTo = job.to;
      this.activeJobs.set(job.id, job);
      v.s = (s0 + bd + dCarry) % L;
      this.push({ type: "vehPick", t: tPick, id: v.id });
      this.push({ type: "vehDrop", t: tDone, id: v.id });
    }
  }

  /** Transport order: expedited lots first, then lots whose queue-time clock is nearly spent. */
  private jobRank(j: Job): number {
    const l = this.lots.get(j.lotId)!;
    const urgent = l.qt !== null && l.qt.step === l.step && this.now - l.qt.startT >= l.qt.limitS * 0.75;
    return l.prio * 2 + (urgent ? 1 : 0);
  }

  private activeJobs = new Map<number, Job>();

  private onVehPick(vehId: string) {
    const v = this.vehicles.find((x) => x.id === vehId)!;
    const job = this.activeJobs.get(v.jobId!)!;
    const lot = this.lots.get(job.lotId)!;
    if (job.from.k === "stocker") this.stockers.get(job.from.id)!.delete(lot.id);
    lot.loc = { k: "vehicle", id: v.id };
    v.lotId = lot.id;
  }

  private onVehDrop(vehId: string) {
    const v = this.vehicles.find((x) => x.id === vehId)!;
    const job = this.activeJobs.get(v.jobId!)!;
    this.activeJobs.delete(job.id);
    const lot = this.lots.get(job.lotId)!;
    v.jobId = null;
    v.lotId = null;
    v.jobLot = null;
    v.jobTo = null;
    v.plan = [];
    if (job.to.k === "stocker") {
      lot.loc = { k: "stocker", id: job.to.id };
      this.stockers.get(job.to.id)!.add(lot.id);
      lot.status = "waiting";
      lot.toolId = null;
      lot.readyAt = this.now;
      this.dispatchBay(this.stepBay(lot));
    } else {
      const tool = this.tools.get(job.to.id)!;
      lot.loc = { k: "tool", id: tool.def.id };
      const ok = tool.assigned === lot.id && (tool.state === "STANDBY" || tool.state === "PRODUCTIVE") && !tool.pmPending;
      if (!ok) {
        if (tool.assigned === lot.id) {
          tool.assigned = null;
          tool.assignedArrived = false;
        }
        lot.toolId = null;
        this.sendToStocker(lot, { k: "tool", id: tool.def.id });
      } else {
        lot.status = "atTool";
        tool.assignedArrived = true;
        if (tool.state === "STANDBY" && tool.current === null) this.startLot(tool, lot);
      }
    }
    this.assignVehicles();
  }

  // ---------------------------------------------------------------- tool process flow

  private startLot(tool: Tool, lot: Lot) {
    tool.assigned = null;
    tool.assignedArrived = false;
    tool.current = lot.id;
    tool.procRemaining = null;
    lot.toolId = tool.def.id;
    lot.loc = { k: "tool", id: tool.def.id };
    lot.status = "atTool";
    lot.held = false;
    lot.holdReason = null;
    // Track-in stops the queue-time clock.
    if (lot.qt && lot.qt.step === lot.step) {
      this.clearAlarm(`QTR:${lot.id}`, "auto", { lotId: lot.id });
      this.clearAlarm(`QTV:${lot.id}`, "track-in", { lotId: lot.id });
      lot.qt = null;
    }
    this.resumeOrSetup(tool, lot);
  }

  private resumeOrSetup(tool: Tool, lot: Lot) {
    const rec = this.recipes[lot.route.steps[lot.step].recipe];
    if (tool.recipe !== rec.id && rec.setupS > 0) {
      this.setState(tool, "SCHEDULED_DOWN", "setup", rec.setupS);
      this.push({ type: "setupEnd", t: this.now + rec.setupS, id: tool.def.id, epoch: tool.opEpoch });
    } else {
      tool.recipe = rec.id;
      this.beginProcessing(tool, lot);
    }
  }

  private onSetupEnd(tool: Tool) {
    const lot = this.lots.get(tool.current!)!;
    tool.recipe = lot.route.steps[lot.step].recipe;
    this.beginProcessing(tool, lot);
  }

  private processTime(tool: Tool, lot: Lot, rec: RecipeDef): number {
    const jitter = Math.min(1.2, Math.max(0.85, 1 + 0.06 * nrand(this.cfg.seed, "proc", lot.id, lot.step)));
    return rec.processS * tool.def.speed * jitter * (lot.rework ? 1.2 : 1);
  }

  private beginProcessing(tool: Tool, lot: Lot) {
    const rec = this.recipes[lot.route.steps[lot.step].recipe];
    const resume = tool.procRemaining !== null;
    const dur = resume ? tool.procRemaining! : this.processTime(tool, lot, rec);
    if (!resume) lot.rework = false;
    tool.procRemaining = null;
    lot.status = "processing";
    tool.prestageOpen = false;
    this.setState(tool, "PRODUCTIVE", resume ? "resume" : "process", dur);
    if (!resume) {
      tool.procStartT = this.now;
      this.emit("lot.started", {
        lotId: lot.id,
        toolId: tool.def.id,
        stepIndex: lot.step,
        recipe: rec.id,
        route: lot.route.id,
        wafers: this.cfg.waferPerLot,
        hot: lot.hot,
      });
    }
    tool.procEndsAt = this.now + dur;
    this.push({ type: "procEnd", t: tool.procEndsAt, id: tool.def.id, epoch: tool.opEpoch });
    if (dur > this.cfg.prestageS) {
      this.push({ type: "prestage", t: tool.procEndsAt - this.cfg.prestageS, id: tool.def.id, epoch: tool.opEpoch });
    } else {
      tool.prestageOpen = true;
      this.dispatchBay(tool.def.bay);
    }
  }

  private onProcEnd(tool: Tool) {
    const lot = this.lots.get(tool.current!)!;
    const rec = this.recipes[lot.route.steps[lot.step].recipe];
    tool.current = null;
    tool.prestageOpen = false;
    tool.lotsDone++;
    const dur = this.now - tool.procStartT;
    let measurement: { param: string; value: number; unit: string } | undefined;
    if (rec.measures) {
      measurement = this.measure(tool, lot, rec);
    } else {
      lot.lastProcTool = tool.def.id;
      if (RELEVANT_DRIFT_BAYS.has(tool.def.bay)) {
        tool.drift += 0.015 + 0.12 * nrand(this.cfg.seed, "drift", tool.def.id, tool.lotsDone);
      }
    }
    const final = lot.step === lot.route.steps.length - 1;
    this.emit("lot.completed", {
      lotId: lot.id,
      toolId: tool.def.id,
      stepIndex: lot.step,
      recipe: rec.id,
      durationS: Math.round(dur * 10) / 10,
      final,
      route: lot.route.id,
      hot: lot.hot,
      measurement,
    });
    lot.step++;
    if (final) {
      this.ship(lot);
    } else {
      lot.readyAt = this.now;
      const q = lot.route.steps[lot.step].qtS;
      if (q) {
        lot.qt = { step: lot.step, startT: this.now, limitS: q };
        this.scheduleQt(lot);
      }
      this.sendToStocker(lot, { k: "tool", id: tool.def.id });
    }
    this.toolCycle(tool);
  }

  /** The tool just became free (finished a lot, finished qualification). Decide what it does next. */
  private toolCycle(tool: Tool) {
    if (this.ended) return;
    if (tool.state === "UNSCHEDULED_DOWN") return;
    if (tool.pmPending && tool.current === null) {
      this.evictAssigned(tool);
      this.startPm(tool);
      return;
    }
    if (tool.current !== null) {
      this.resumeOrSetup(tool, this.lots.get(tool.current)!);
      return;
    }
    if (tool.assigned && tool.assignedArrived) {
      this.startLot(tool, this.lots.get(tool.assigned)!);
      return;
    }
    if (tool.state !== "STANDBY") this.setState(tool, "STANDBY", "idle");
    this.dispatchBay(tool.def.bay);
  }

  private ship(lot: Lot) {
    lot.status = "done";
    lot.doneT = this.now;
    lot.loc = { k: "gone" };
    lot.toolId = null;
    const raw = this.routeRaw.get(lot.route.id)!;
    const ctS = this.now - lot.releasedAt;
    const ooc = lot.ooc !== null;
    if (ooc) this.oocEscapes++;
    this.done.push({ lotId: lot.id, hot: lot.hot, ctS, rawS: raw, due: lot.due, doneT: this.now, onTime: this.now <= lot.due, ooc });
    this.ce(CEID.LOT_SHIPPED, "LotShipped", {
      lotId: lot.id,
      reports: { route: lot.route.id, hot: lot.hot, cycleTimeS: Math.round(ctS), onTime: this.now <= lot.due, qtViolations: lot.qtViolations, oocEscape: ooc },
    });
    this.clearAlarm(`QTR:${lot.id}`);
    this.clearAlarm(`QTV:${lot.id}`);
    this.lots.delete(lot.id);
  }

  private onRelease(k: number) {
    const cfg = this.cfg;
    if (this.lots.size < cfg.wipCap) {
      const route = this.pickRoute(urand(cfg.seed, "route", k));
      const hot = urand(cfg.seed, "hot", k) < cfg.hotFraction;
      const lot = this.makeLot(route, hot, this.now);
      const st = cfg.stockers[cfg.stockers.length - 1].id;
      lot.loc = { k: "stocker", id: st };
      lot.readyAt = this.now;
      this.stockers.get(st)!.add(lot.id);
      this.lots.set(lot.id, lot);
      this.ce(CEID.LOT_RELEASED, "LotReleased", { lotId: lot.id, reports: { route: route.id, hot, steps: route.steps.length, due: Math.round(lot.due) } });
      this.dispatchBay(this.stepBay(lot));
    }
    this.push({ type: "release", t: this.now + cfg.releaseIntervalS, n: k + 1 });
  }

  // ---------------------------------------------------------------- queue time

  private scheduleQt(lot: Lot) {
    if (!lot.qt) return;
    const { startT, limitS, step } = lot.qt;
    const warnT = Math.max(this.now, startT + limitS * 0.75);
    this.push({ type: "qtWarn", t: warnT, id: lot.id, n: step });
    this.push({ type: "qtExpire", t: Math.max(this.now, startT + limitS), id: lot.id, n: step });
  }

  private onQtWarn(lotId: string, step: number) {
    const lot = this.lots.get(lotId);
    if (!lot || !lot.qt || lot.qt.step !== step) return;
    const rec = lot.route.steps[step].recipe;
    this.setAlarm(`QTR:${lot.id}`, "QT_RISK", "warning", `${lot.id} has used 75% of its queue-time limit before ${rec}.`, { lotId: lot.id });
  }

  private onQtExpire(lotId: string, step: number) {
    const lot = this.lots.get(lotId);
    if (!lot || !lot.qt || lot.qt.step !== step) return;
    const rec = lot.route.steps[step].recipe;
    lot.qtViolations++;
    lot.rework = true;
    this.qtViolations++;
    this.qtLog.push({ t: this.now, lotId: lot.id, recipe: rec });
    this.clearAlarm(`QTR:${lot.id}`);
    this.setAlarm(`QTV:${lot.id}`, "QT_VIOLATION", "critical", `${lot.id} exceeded its ${Math.round(lot.qt.limitS / 60)} min queue-time limit before ${rec}. Re-clean required.`, { lotId: lot.id });
    this.ce(CEID.QT_VIOLATION, "QueueTimeViolation", {
      lotId: lot.id,
      reports: { stepIndex: step, recipe: rec, limitS: lot.qt.limitS, waitedS: Math.round(this.now - lot.qt.startT) },
    });
    // The clock has done its job. Keep the object so the lot still shows the overrun until track-in.
  }

  // ---------------------------------------------------------------- reliability

  private scheduleFailure(t: Tool) {
    t.failEpoch++;
    t.warned = false;
    if (!this.cfg.failuresEnabled) {
      t.failAt = null;
      return;
    }
    const scale = weibullScaleForMean(t.def.mtbfS, WEIBULL_SHAPE);
    const ttf = wrand(this.cfg.seed, WEIBULL_SHAPE, scale, t.def.id, "fail", t.failCount);
    t.failAt = this.now + ttf;
    this.push({ type: "fail", t: t.failAt, id: t.def.id, epoch: t.failEpoch });
    if (ttf > WARN_LEAD_S + 60 && urand(this.cfg.seed, t.def.id, "warn", t.failCount) < 0.7) {
      this.push({ type: "warn", t: t.failAt - WARN_LEAD_S, id: t.def.id, epoch: t.failEpoch });
    }
    t.failCount++;
  }

  private schedulePmDue(t: Tool) {
    t.pmEpoch++;
    t.pmDueAt = Math.max(this.now, t.lastPmAt + t.def.pmIntervalS);
    this.push({ type: "pmDue", t: t.pmDueAt, id: t.def.id, epoch: t.pmEpoch });
  }

  private scheduleExcursion(t: Tool) {
    t.excEpoch++;
    if (!this.cfg.excursionsEnabled || !RELEVANT_DRIFT_BAYS.has(t.def.bay)) return;
    const when = this.now + erand(this.cfg.seed, 40000, t.def.id, "exc", t.excCount);
    this.push({ type: "excursion", t: when, id: t.def.id, epoch: t.excEpoch });
  }

  private onExcursion(t: Tool) {
    t.drift += 2.5 + urand(this.cfg.seed, t.def.id, "excmag", t.excCount);
    t.excCount++;
    this.scheduleExcursion(t);
  }

  private onFail(t: Tool) {
    if (t.state === "UNSCHEDULED_DOWN" || (t.state === "SCHEDULED_DOWN" && t.reason === "pm")) return;
    this.failureLog.push({ t: this.now, toolId: t.def.id });
    if (t.state === "PRODUCTIVE") t.procRemaining = Math.max(0, t.procEndsAt - this.now);
    t.opEpoch++;
    t.pmEpoch += 0;
    t.prestageOpen = false;
    t.recipe = null;
    this.clearAlarm(`WARN:${t.def.id}`, "failure", { toolId: t.def.id });
    this.setState(t, "UNSCHEDULED_DOWN", "failure");
    this.setAlarm(`DOWN:${t.def.id}`, "TOOL_DOWN", "critical", `${t.def.id} is down${t.current ? ` with ${t.current} inside` : ""}. Needs a repair crew.`, { toolId: t.def.id });
    this.evictAssigned(t);
    t.crew = "waiting";
    this.crewQueue.push(t.def.id);
    this.dispatchCrew();
    this.dispatchBay(t.def.bay);
  }

  private dispatchCrew() {
    while (this.crewBusy < this.cfg.crewSize && this.crewQueue.length) {
      const id = this.crewQueue.shift()!;
      const t = this.tools.get(id)!;
      if (t.state !== "UNSCHEDULED_DOWN") continue;
      this.crewBusy++;
      t.crew = "assigned";
      t.repairCount++;
      const dur = t.def.mttrS * (0.6 + 0.9 * urand(this.cfg.seed, id, "mttr", t.repairCount));
      t.endsAt = this.now + dur;
      this.push({ type: "repairEnd", t: this.now + dur, id, epoch: t.opEpoch });
      this.ce(CEID.CREW_ASSIGNED, "CrewAssigned", { toolId: id, reports: { etaS: Math.round(dur) } });
    }
  }

  private onRepairEnd(t: Tool) {
    this.crewBusy--;
    t.crew = "none";
    this.clearAlarm(`DOWN:${t.def.id}`, "repair", { toolId: t.def.id });
    this.afterMaintenance(t, "repair");
    this.setState(t, "ENGINEERING", "post-repair qual", t.def.qualS);
    this.push({ type: "qualEnd", t: this.now + t.def.qualS, id: t.def.id, epoch: t.opEpoch });
    this.dispatchCrew();
  }

  private afterMaintenance(t: Tool, _why: string) {
    void _why;
    t.lastPmAt = this.now;
    t.pmPending = false;
    t.drift = 0;
    this.clearAlarm(`PMD:${t.def.id}`, "maintenance", { toolId: t.def.id });
    for (const key of [...this.alarms.keys()]) {
      if (key.startsWith("SPC:") && key.endsWith(`:${t.def.id}`)) this.clearAlarm(key, "maintenance", { toolId: t.def.id });
    }
    this.scheduleFailure(t);
    this.schedulePmDue(t);
    this.scheduleExcursion(t);
  }

  private onPmDue(t: Tool) {
    t.pmPending = true;
    this.setAlarm(`PMD:${t.def.id}`, "PM_DUE", "info", `${t.def.id} preventive maintenance is due. It starts when the tool is idle.`, { toolId: t.def.id });
    if (t.state === "STANDBY" && t.current === null) this.toolCycle(t);
  }

  private startPm(t: Tool) {
    t.pmPending = false;
    t.opEpoch++;
    t.failEpoch++;
    t.prestageOpen = false;
    t.recipe = null;
    this.clearAlarm(`WARN:${t.def.id}`, "pm", { toolId: t.def.id });
    this.setState(t, "SCHEDULED_DOWN", "pm", t.def.pmDurS);
    this.ce(CEID.PM_STARTED, "PmStarted", { toolId: t.def.id });
    this.push({ type: "pmEnd", t: this.now + t.def.pmDurS, id: t.def.id, epoch: t.opEpoch });
    this.dispatchBay(t.def.bay);
  }

  private onPmEnd(t: Tool) {
    this.afterMaintenance(t, "pm");
    t.pmCount++;
    this.ce(CEID.PM_COMPLETED, "PmCompleted", { toolId: t.def.id });
    this.setState(t, "ENGINEERING", "post-pm qual", t.def.qualS);
    this.push({ type: "qualEnd", t: this.now + t.def.qualS, id: t.def.id, epoch: t.opEpoch });
  }

  private onQualEnd(t: Tool) {
    this.setState(t, "STANDBY", "qualified");
    this.toolCycle(t);
  }

  // ---------------------------------------------------------------- metrology and SPC

  private measure(tool: Tool, lot: Lot, rec: RecipeDef) {
    const param = rec.measures!;
    const spec = this.cfg.spc.find((s) => s.param === param)!;
    const upstream = lot.lastProcTool ? this.tools.get(lot.lastProcTool) : undefined;
    const z = (upstream ? upstream.def.bias + upstream.drift : 0) + nrand(this.cfg.seed, "meas", lot.id, lot.step);
    const value = Math.round((spec.target + z * spec.sigma) * 1000) / 1000;
    const zs = this.spcFull.get(param) ?? [];
    zs.push(z);
    this.spcFull.set(param, zs);
    const rules = evaluateRules(zs);
    const pts = this.spcPoints.get(param) ?? [];
    pts.push({ t: this.now, lotId: lot.id, toolId: tool.def.id, upstream: upstream?.def.id ?? "-", value, rules });
    if (pts.length > 120) pts.shift();
    this.spcPoints.set(param, pts);
    if (rules.length && upstream) {
      const rtxt = rules.map((r) => `rule ${r}`).join(", ");
      this.setAlarm(`SPC:${param}:${upstream.def.id}`, "SPC_RULE", rules.includes(1) ? "critical" : "warning", `${param} chart violates ${rtxt}. Suspect ${upstream.def.id}.`, { toolId: upstream.def.id });
      if (rules.includes(1) && !lot.ooc) {
        lot.ooc = { t: this.now, toolId: upstream.def.id, param };
        lot.held = true;
        lot.holdReason = "spc";
        lot.holdSince = this.now;
        this.setAlarm(`OOC:${lot.id}`, "SPC_HOLD", "critical", `${lot.id} auto-held, ${param} out of control. Fix ${upstream.def.id} then release.`, { lotId: lot.id, toolId: upstream.def.id });
        this.push({ type: "autoRelease", t: this.now + SPC_AUTO_RELEASE_S, id: lot.id, n: this.now });
        this.ce(CEID.LOT_HELD, "LotHeld", { lotId: lot.id, reports: { reason: "spc", param, suspect: upstream.def.id } });
      }
    }
    this.ce(CEID.SPC_MEASUREMENT, "SpcMeasurement", { toolId: tool.def.id, lotId: lot.id, reports: { param, value, z: Math.round(z * 100) / 100, rules: rules.join(",") } });
    return { param, value, unit: spec.unit };
  }

  // ---------------------------------------------------------------- commands

  apply(cmd: Command): CommandResult {
    const res = this.applyInner(cmd);
    this.commandLog.push({ t: this.now, cmd, result: res });
    return res;
  }

  private applyInner(cmd: Command): CommandResult {
    if (this.ended) return { ok: false, message: "The shift is over." };
    switch (cmd.type) {
      case "setRule": {
        if (!this.rules.has(cmd.bay)) return { ok: false, message: `Unknown bay ${cmd.bay}.` };
        const prev = this.rules.get(cmd.bay)!;
        if (prev === cmd.rule) return { ok: false, message: `${cmd.bay} already runs ${cmd.rule}.` };
        this.rules.set(cmd.bay, cmd.rule);
        this.ce(CEID.RULE_CHANGED, "DispatchRuleChanged", { reports: { bay: cmd.bay, from: prev, to: cmd.rule } });
        this.dispatchBay(cmd.bay);
        return { ok: true, message: `${cmd.bay} now dispatches by ${cmd.rule}.` };
      }
      case "expedite": {
        const lot = this.lots.get(cmd.lotId);
        if (!lot) return { ok: false, message: `${cmd.lotId} is not in the fab.` };
        if (lot.prio === 1) return { ok: false, message: `${lot.id} is already expedited.` };
        if (this.expeditesLeft <= 0) return { ok: false, message: "No expedites left this shift." };
        lot.prio = 1;
        this.expeditesLeft--;
        this.ce(CEID.LOT_EXPEDITED, "LotExpedited", { lotId: lot.id });
        if (lot.status === "waiting") this.dispatchBay(this.stepBay(lot));
        return { ok: true, message: `${lot.id} expedited. ${this.expeditesLeft} left.` };
      }
      case "pmEarly": {
        const t = this.tools.get(cmd.toolId);
        if (!t) return { ok: false, message: `Unknown tool ${cmd.toolId}.` };
        if (t.state === "UNSCHEDULED_DOWN") return { ok: false, message: `${t.def.id} is down. Assign a crew instead.` };
        if (t.state === "ENGINEERING" || (t.state === "SCHEDULED_DOWN" && t.reason === "pm")) return { ok: false, message: `${t.def.id} is already in maintenance.` };
        if (t.pmPending) return { ok: false, message: `${t.def.id} already has PM queued.` };
        t.pmPending = true;
        this.clearAlarm(`PMD:${t.def.id}`, "operator", { toolId: t.def.id });
        if (t.state === "STANDBY" && t.current === null) {
          this.toolCycle(t);
          return { ok: true, message: `${t.def.id} PM started.` };
        }
        return { ok: true, message: `${t.def.id} PM queued. Starts when the current lot finishes.` };
      }
      case "assignCrew": {
        const t = this.tools.get(cmd.toolId);
        if (!t) return { ok: false, message: `Unknown tool ${cmd.toolId}.` };
        if (t.state !== "UNSCHEDULED_DOWN") return { ok: false, message: `${t.def.id} is not down.` };
        if (t.crew === "assigned") return { ok: false, message: `A crew is already repairing ${t.def.id}.` };
        const i = this.crewQueue.indexOf(t.def.id);
        if (i > 0) {
          this.crewQueue.splice(i, 1);
          this.crewQueue.unshift(t.def.id);
        }
        this.dispatchCrew();
        return (t.crew as string) === "assigned"
          ? { ok: true, message: `Crew on ${t.def.id}.` }
          : { ok: true, message: `${t.def.id} is first in the crew queue. All ${this.cfg.crewSize} crews are busy.` };
      }
      case "hold": {
        const lot = this.lots.get(cmd.lotId);
        if (!lot) return { ok: false, message: `${cmd.lotId} is not in the fab.` };
        if (lot.held) return { ok: false, message: `${lot.id} is already on hold.` };
        lot.held = true;
        lot.holdReason = "operator";
        lot.holdSince = this.now;
        this.ce(CEID.LOT_HELD, "LotHeld", { lotId: lot.id, reports: { reason: "operator" } });
        return { ok: true, message: `${lot.id} on hold. Its queue-time clock keeps running.` };
      }
      case "release": {
        const lot = this.lots.get(cmd.lotId);
        if (!lot) return { ok: false, message: `${cmd.lotId} is not in the fab.` };
        if (!lot.held) return { ok: false, message: `${lot.id} is not on hold.` };
        const msg = this.doRelease(lot, "operator");
        return { ok: true, message: msg };
      }
    }
  }

  private doRelease(lot: Lot, by: string): string {
    lot.held = false;
    const wasSpc = lot.holdReason === "spc";
    lot.holdReason = null;
    this.clearAlarm(`OOC:${lot.id}`, by, { lotId: lot.id });
    let msg = `${lot.id} released.`;
    if (wasSpc && lot.ooc) {
      const tool = this.tools.get(lot.ooc.toolId);
      if (tool && tool.lastPmAt >= lot.ooc.t) {
        lot.ooc = null;
        msg = `${lot.id} released. ${tool.def.id} was serviced since the excursion, so the lot is dispositioned clean.`;
      } else {
        msg = `${lot.id} released with the excursion flag. If it ships, it counts as a quality escape.`;
      }
    }
    this.ce(CEID.LOT_RELEASED_FROM_HOLD, "LotReleasedFromHold", { lotId: lot.id, reports: { by } });
    if (lot.status === "waiting") this.dispatchBay(this.stepBay(lot));
    return msg;
  }

  // ---------------------------------------------------------------- testing hooks

  /** Inject a lot at a given step into a stocker. Used by tests and by scenario scripts. */
  injectLot(routeId: string, step: number, opts: { hot?: boolean; stocker?: string } = {}): string {
    const route = this.cfg.routes.find((r) => r.id === routeId)!;
    const lot = this.makeLot(route, opts.hot ?? false, this.now, step);
    const st = opts.stocker ?? this.cfg.stockers[0].id;
    lot.loc = { k: "stocker", id: st };
    lot.readyAt = this.now;
    this.stockers.get(st)!.add(lot.id);
    this.lots.set(lot.id, lot);
    const q = route.steps[step].qtS;
    if (q) {
      lot.qt = { step, startT: this.now, limitS: q };
      this.scheduleQt(lot);
    }
    this.dispatchBay(this.stepBay(lot));
    return lot.id;
  }

  /** Force a failure now. Used by tests and scenario scripts. */
  forceFailure(toolId: string) {
    this.onFail(this.tools.get(toolId)!);
  }

  tool(id: string): ToolView {
    return this.toolView(this.tools.get(id)!);
  }

  lot(id: string): LotView | undefined {
    const l = this.lots.get(id);
    return l ? this.lotView(l) : undefined;
  }

  ruleOf(bay: BayId): DispatchRule {
    return this.rules.get(bay)!;
  }

  // ---------------------------------------------------------------- read models

  private toolView(t: Tool): ToolView {
    const st = { ...t.stateTime };
    st[t.state] += this.now - t.since;
    const total = Object.values(st).reduce((a, b) => a + b, 0);
    return {
      id: t.def.id,
      bay: t.def.bay,
      state: t.state,
      reason: t.reason,
      since: t.since,
      lotId: t.current,
      assignedLotId: t.assigned,
      recipe: t.recipe,
      endsIn: t.endsAt === null ? null : Math.max(0, t.endsAt - this.now),
      queue: this.bayQueue(t.def.bay),
      pmDueIn: t.pmDueAt - this.now,
      pmPending: t.pmPending,
      warn: t.warned,
      drift: Math.round(t.drift * 100) / 100,
      crew: t.crew,
      lotsDone: t.lotsDone,
      util: total > 0 ? st.PRODUCTIVE / total : 0,
      stateTime: st,
    };
  }

  private bayQueue(bay: BayId): number {
    let n = 0;
    for (const l of this.lots.values()) if ((l.status === "waiting" || l.status === "transit") && l.step < l.route.steps.length && this.stepBay(l) === bay && l.toolId === null) n++;
    return n;
  }

  private lotView(l: Lot): LotView {
    const rec = this.recipes[l.route.steps[l.step].recipe];
    return {
      id: l.id,
      route: l.route.id,
      hot: l.hot,
      prio: l.prio,
      step: l.step,
      steps: l.route.steps.length,
      recipe: rec.id,
      bay: rec.bay,
      status: l.status,
      loc: l.loc,
      toolId: l.toolId,
      held: l.held,
      holdReason: l.holdReason,
      due: l.due,
      releasedAt: l.releasedAt,
      readyAt: l.readyAt,
      qtLeft: l.qt && l.qt.step === l.step ? l.qt.limitS - (this.now - l.qt.startT) : null,
      qtViolations: l.qtViolations,
      ooc: l.ooc !== null,
    };
  }

  kpi(): Kpi {
    const d = this.done;
    const hot = d.filter((x) => x.hot);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const tv = [...this.tools.values()].map((t) => this.toolView(t));
    const avgCt = mean(d.map((x) => x.ctS));
    const xf = mean(d.map((x) => x.ctS / x.rawS));
    return {
      shipped: d.length,
      shippedHot: hot.length,
      wip: this.lots.size,
      throughputPerHr: this.now > 0 ? d.length / (this.now / 3600) : 0,
      avgCtS: avgCt,
      avgHotCtS: mean(hot.map((x) => x.ctS)),
      xFactor: xf,
      otd: d.length ? d.filter((x) => x.onTime).length / d.length : null,
      qtViolations: this.qtViolations,
      oocEscapes: this.oocEscapes,
      avgUtil: tv.reduce((a, t) => a + t.util, 0) / tv.length,
      downtimeS: tv.reduce((a, t) => a + t.stateTime.UNSCHEDULED_DOWN, 0),
    };
  }

  completed(): readonly Done[] {
    return this.done;
  }

  objectives(k: Kpi = this.kpi()): ObjectiveView[] {
    const o = this.cfg.objectives;
    return [
      { id: "ship", label: `Ship ${o.shipTarget} lots`, target: o.shipTarget, value: k.shipped, unit: "lots", dir: "min", met: k.shipped >= o.shipTarget, failed: false },
      {
        id: "hotCt",
        label: `Hot-lot cycle time under ${Math.round(o.hotCtMaxS / 60)} min`,
        target: o.hotCtMaxS,
        value: k.avgHotCtS,
        unit: "s",
        dir: "max",
        met: k.avgHotCtS !== null && k.avgHotCtS <= o.hotCtMaxS,
        failed: k.avgHotCtS !== null && k.avgHotCtS > o.hotCtMaxS && k.shippedHot >= 3,
      },
      { id: "qt", label: "Zero queue-time violations", target: 0, value: k.qtViolations, unit: "", dir: "max", met: k.qtViolations === 0, failed: k.qtViolations > 0 },
    ];
  }

  snapshot(): Snapshot {
    const tools = [...this.tools.values()].map((t) => this.toolView(t));
    const lots = [...this.lots.values()].map((l) => this.lotView(l));
    const kpi = this.kpi();
    const objectives = this.objectives(kpi);
    const bays: BayView[] = this.cfg.bays.map((b) => {
      const ts = tools.filter((t) => t.bay === b.id);
      const waits = lots.filter((l) => l.bay === b.id && l.status === "waiting" && !l.held).map((l) => this.now - l.readyAt);
      return {
        id: b.id,
        rule: this.rules.get(b.id)!,
        queue: this.bayQueue(b.id),
        toolsUp: ts.filter((t) => t.state !== "UNSCHEDULED_DOWN").length,
        toolCount: ts.length,
        util: ts.reduce((a, t) => a + t.util, 0) / ts.length,
        oldestWaitS: waits.length ? Math.max(...waits) : 0,
      };
    });
    const wipMap = new Map<string, WipRow>();
    for (const r of Object.values(this.recipes)) wipMap.set(r.id, { recipe: r.id, bay: r.bay, waiting: 0, transit: 0, processing: 0, held: 0 });
    for (const l of lots) {
      const row = wipMap.get(l.recipe)!;
      if (l.held) row.held++;
      else if (l.status === "processing" || l.status === "atTool") row.processing++;
      else if (l.status === "transit") row.transit++;
      else row.waiting++;
    }
    const spc: SpcSeries[] = this.cfg.spc.map((s) => ({
      param: s.param,
      label: s.label,
      unit: s.unit,
      target: s.target,
      sigma: s.sigma,
      points: this.spcPoints.get(s.param) ?? [],
    }));
    const vehicles: VehicleView[] = this.vehicles.map((v) => ({ id: v.id, s: v.s, lotId: v.lotId, jobLotId: v.jobLot, jobTo: v.jobTo, plan: v.plan }));
    return {
      t: this.now,
      shiftS: this.cfg.shiftS,
      seed: this.cfg.seed,
      ended: this.ended,
      tools,
      lots,
      vehicles,
      bays,
      wip: [...wipMap.values()],
      spc,
      kpi,
      objectives,
      score: scoreOf(kpi, objectives, this.ended).total,
      crew: { total: this.cfg.crewSize, busy: this.crewBusy, waiting: [...this.crewQueue] },
      expeditesLeft: this.expeditesLeft,
    };
  }
}

export function runShift(cfg: SimConfig, commands: Array<{ t: number; cmd: Command }> = []): FabEngine {
  const e = new FabEngine(cfg);
  for (const c of [...commands].sort((a, b) => a.t - b.t)) {
    e.advanceTo(c.t);
    e.apply(c.cmd);
  }
  e.advanceTo(cfg.shiftS);
  return e;
}
