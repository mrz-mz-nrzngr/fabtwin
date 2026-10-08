import { CEID } from "@/events/types";
import type { E10State, FabEvent } from "@/events/types";
import { buildConfig, routeRawS } from "@/sim/config";
import { emptyStateTime } from "@/sim/e10";
import { evaluateRules } from "@/sim/spc";
import type {
  BayId,
  BayView,
  Kpi,
  Loc,
  LotView,
  RouteDef,
  SimConfig,
  Snapshot,
  SpcParam,
  SpcPoint,
  SpcSeries,
  ToolDef,
  ToolView,
  VehicleView,
  WipRow,
} from "@/sim/types";

/**
 * The live twin turns an event stream (schema v1) into the same Snapshot the simulator produces,
 * so the 3D floor, KPI strip, WIP chart and tool panels need no live-specific code.
 *
 * What the stream cannot say, the twin derives or synthesises, and says so in the interface:
 *  - KPIs come from lot events: shipped, WIP, throughput, cycle time, X-factor, on-time delivery.
 *  - FOUP motion is synthesised. A completed step dispatches an OHT vehicle to the tool, which lifts
 *    the FOUP, carries it to the nearest stocker downstream and lowers it. A started step shows the
 *    FOUP lowered onto the tool port at the event time. Real vehicle positions are not in the stream.
 *  - The synthesised vehicles do not model blocking. Only the simulator does (src/sim/oht.ts).
 */

type Ref = { k: "tool" | "stocker"; id: string };

interface LiveTool {
  def: ToolDef;
  state: E10State;
  reason: string;
  since: number;
  stateTime: Record<E10State, number>;
  lotId: string | null;
  recipe: string | null;
  lotsDone: number;
  alarms: Map<string, "info" | "warning" | "critical">;
  seen: boolean;
}

interface Transfer {
  vehId: string;
  from: Ref;
  to: Ref;
  liftT0: number | null;
  liftT1: number | null;
  lowerT0: number;
  lowerT1: number;
  plan: Array<{ t0: number; t1: number; s0: number; s1: number }>;
  /** Arc position where the vehicle ends. */
  endS: number;
}

interface LiveLot {
  id: string;
  route: RouteDef | null;
  routeName: string;
  hot: boolean;
  step: number;
  steps: number;
  recipe: string;
  bay: BayId;
  releasedAt: number;
  readyAt: number;
  loc: Loc;
  toolId: string | null;
  inProcess: boolean;
  held: boolean;
  holdReason: "operator" | "spc" | null;
  qtViolations: number;
  ooc: boolean;
  xfer: Transfer | null;
  lastTool: string | null;
}

interface Done {
  hot: boolean;
  ctS: number;
  rawS: number | null;
  onTime: boolean | null;
  ooc: boolean;
}

interface Veh {
  id: string;
  s: number;
  freeAt: number;
}

const DWELL = 4;
const MAX_SPC = 120;

export interface TwinStats {
  events: number;
  ignoredTools: string[];
  lotsSeen: number;
}

export class LiveTwin {
  readonly cfg: SimConfig;
  baseMs = 0;
  private started = false;
  private lastT = 0;
  private anchorWall = 0;
  private tools = new Map<string, LiveTool>();
  private lots = new Map<string, LiveLot>();
  private done: Done[] = [];
  private qtViolations = 0;
  private vehs: Veh[] = [];
  private spc = new Map<SpcParam, SpcPoint[]>();
  private spcZ = new Map<SpcParam, number[]>();
  private ignored = new Set<string>();
  private eventCount = 0;
  private routes = new Map<string, RouteDef>();

  constructor(cfg: SimConfig = buildConfig(1)) {
    this.cfg = cfg;
    for (const r of cfg.routes) this.routes.set(r.id, r);
    for (const def of cfg.tools) {
      this.tools.set(def.id, {
        def,
        state: "STANDBY",
        reason: "no data yet",
        since: 0,
        stateTime: emptyStateTime(),
        lotId: null,
        recipe: null,
        lotsDone: 0,
        alarms: new Map(),
        seen: false,
      });
    }
    for (let i = 0; i < cfg.vehicleCount; i++) this.vehs.push({ id: `OHT-${String(i + 1).padStart(2, "0")}`, s: (i * cfg.loopLength) / cfg.vehicleCount, freeAt: 0 });
  }

  get stats(): TwinStats {
    return { events: this.eventCount, ignoredTools: [...this.ignored], lotsSeen: this.lots.size + this.done.length };
  }

  /** Seconds since the first event, for an event timestamp. */
  rel(ms: number): number {
    return (ms - this.baseMs) / 1000;
  }

  apply(events: FabEvent[], wallNow: number = Date.now()) {
    if (!events.length) return;
    if (!this.started) {
      this.started = true;
      this.baseMs = Math.min(...events.map((e) => e.t));
    }
    const sorted = [...events].sort((a, b) => a.t - b.t || a.seq - b.seq);
    for (const ev of sorted) {
      this.eventCount++;
      const t = Math.max(0, this.rel(ev.t));
      this.lastT = Math.max(this.lastT, t);
      this.one(ev, t);
    }
    this.anchorWall = wallNow;
  }

  /** The twin's clock: the newest event time plus the wall time since that batch arrived. */
  clock(wallNow: number = Date.now()): number {
    return this.started ? this.lastT + Math.max(0, wallNow - this.anchorWall) / 1000 : 0;
  }

  // ------------------------------------------------------------------ event handling

  private one(ev: FabEvent, t: number) {
    switch (ev.type) {
      case "equipment.state_changed": {
        const tool = this.tools.get(ev.data.toolId);
        if (!tool) return void this.ignored.add(ev.data.toolId);
        tool.stateTime[tool.state] += Math.max(0, t - tool.since);
        tool.state = ev.data.to;
        tool.since = t;
        tool.reason = ev.data.reason ?? "";
        tool.seen = true;
        if (ev.data.recipe !== undefined) tool.recipe = ev.data.recipe;
        if (ev.data.lotId !== undefined) tool.lotId = ev.data.lotId;
        if (ev.data.to !== "PRODUCTIVE" && ev.data.lotId == null) tool.lotId = null;
        return;
      }
      case "alarm.set": {
        const tool = ev.data.toolId ? this.tools.get(ev.data.toolId) : undefined;
        if (ev.data.toolId && !tool) this.ignored.add(ev.data.toolId);
        tool?.alarms.set(ev.data.alarmId, ev.data.severity);
        return;
      }
      case "alarm.cleared": {
        this.tools.get(ev.data.toolId ?? "")?.alarms.delete(ev.data.alarmId);
        return;
      }
      case "lot.started": {
        const tool = this.tools.get(ev.data.toolId);
        if (!tool) return void this.ignored.add(ev.data.toolId);
        const lot = this.lotFor(ev.data.lotId, t, ev.data.route, ev.data.hot, ev.data.stepIndex);
        lot.step = ev.data.stepIndex;
        lot.recipe = ev.data.recipe;
        lot.bay = this.cfg.recipes[ev.data.recipe]?.bay ?? tool.def.bay;
        lot.toolId = tool.def.id;
        lot.inProcess = true;
        lot.held = false;
        tool.lotId = lot.id;
        tool.recipe = ev.data.recipe;
        if (lot.loc.k === "tool" && lot.loc.id === tool.def.id) return;
        const from: Ref = lot.loc.k === "stocker" ? { k: "stocker", id: lot.loc.id } : { k: "stocker", id: this.nearestStocker(tool.def.loopS, true) };
        lot.xfer = this.inbound(lot, from, tool, t);
        lot.loc = { k: "vehicle", id: lot.xfer.vehId };
        return;
      }
      case "lot.completed": {
        const tool = this.tools.get(ev.data.toolId);
        if (!tool) return void this.ignored.add(ev.data.toolId);
        const lot = this.lotFor(ev.data.lotId, t, ev.data.route, ev.data.hot, ev.data.stepIndex);
        tool.lotsDone++;
        tool.lotId = null;
        if (ev.data.measurement) this.measure(ev.data.measurement.param, ev.data.measurement.value, t, lot.id, tool.def.id, lot.lastTool);
        lot.lastTool = tool.def.id;
        lot.inProcess = false;
        lot.toolId = null;
        const last = ev.data.final || (lot.route !== null && ev.data.stepIndex >= lot.route.steps.length - 1);
        if (last) return void this.ship(lot, t, false);
        lot.step = ev.data.stepIndex + 1;
        const next = lot.route?.steps[lot.step]?.recipe;
        if (next) {
          lot.recipe = next;
          lot.bay = this.cfg.recipes[next]?.bay ?? lot.bay;
        }
        lot.readyAt = t;
        lot.xfer = this.outbound(lot, tool, t);
        lot.loc = lot.loc.k === "tool" ? lot.loc : { k: "tool", id: tool.def.id };
        return;
      }
      case "collection_event": {
        const id = ev.data.lotId;
        const r = ev.data.reports ?? {};
        switch (ev.data.ceid) {
          case CEID.LOT_RELEASED:
            if (id) this.lotFor(id, t, typeof r.route === "string" ? r.route : undefined, Boolean(r.hot), 0);
            return;
          case CEID.LOT_HELD:
            if (id && this.lots.has(id)) Object.assign(this.lots.get(id)!, { held: true, holdReason: r.reason === "spc" ? "spc" : "operator" });
            return;
          case CEID.LOT_RELEASED_FROM_HOLD:
            if (id && this.lots.has(id)) Object.assign(this.lots.get(id)!, { held: false, holdReason: null });
            return;
          case CEID.QT_VIOLATION:
            this.qtViolations++;
            if (id && this.lots.has(id)) this.lots.get(id)!.qtViolations++;
            return;
          case CEID.LOT_SHIPPED:
            if (id && this.lots.has(id)) this.ship(this.lots.get(id)!, t, Boolean(r.oocEscape));
            return;
        }
      }
    }
  }

  private lotFor(id: string, t: number, routeName: string | undefined, hot: boolean | undefined, step: number): LiveLot {
    const existing = this.lots.get(id);
    if (existing) {
      if (routeName && !existing.route) this.setRoute(existing, routeName);
      if (hot !== undefined) existing.hot = hot;
      return existing;
    }
    const lot: LiveLot = {
      id,
      route: null,
      routeName: "ad hoc",
      hot: Boolean(hot),
      step,
      steps: step + 1,
      recipe: "",
      bay: "LITHO",
      releasedAt: t,
      readyAt: t,
      loc: { k: "stocker", id: this.nearestStocker(0, true) },
      toolId: null,
      inProcess: false,
      held: false,
      holdReason: null,
      qtViolations: 0,
      ooc: false,
      xfer: null,
      lastTool: null,
    };
    if (routeName) this.setRoute(lot, routeName);
    this.lots.set(id, lot);
    return lot;
  }

  private setRoute(lot: LiveLot, name: string) {
    lot.routeName = name;
    const r = this.routes.get(name);
    if (r) {
      lot.route = r;
      lot.steps = r.steps.length;
    }
  }

  private ship(lot: LiveLot, t: number, ooc: boolean) {
    if (!this.lots.has(lot.id)) return;
    this.lots.delete(lot.id);
    const rawS = lot.route ? routeRawS(lot.route, this.cfg.recipes) : null;
    const due = rawS === null ? null : lot.releasedAt + rawS * (lot.hot ? this.cfg.dueFactor.hot : this.cfg.dueFactor.normal);
    this.done.push({ hot: lot.hot, ctS: t - lot.releasedAt, rawS, onTime: due === null ? null : t <= due, ooc: ooc || lot.ooc });
  }

  private measure(param: string, value: number, t: number, lotId: string, toolId: string, upstream: string | null) {
    const spec = this.cfg.spc.find((s) => s.param === param);
    if (!spec) return;
    const zs = this.spcZ.get(spec.param) ?? [];
    zs.push((value - spec.target) / spec.sigma);
    const pts = this.spc.get(spec.param) ?? [];
    pts.push({ t, lotId, toolId, upstream: upstream ?? toolId, value, rules: evaluateRules(zs) });
    if (pts.length > MAX_SPC) {
      pts.shift();
      zs.shift();
    }
    this.spc.set(spec.param, pts);
    this.spcZ.set(spec.param, zs);
  }

  // ------------------------------------------------------------------ synthesised OHT motion

  private fwd(a: number, b: number) {
    const L = this.cfg.loopLength;
    return (((b - a) % L) + L) % L;
  }

  private nearestStocker(fromS: number, ahead: boolean): string {
    let best = this.cfg.stockers[0];
    let bd = Infinity;
    for (const s of this.cfg.stockers) {
      const d = ahead ? this.fwd(fromS, s.loopS) : this.fwd(s.loopS, fromS);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best.id;
  }

  private refS(r: Ref): number {
    return r.k === "tool" ? this.tools.get(r.id)!.def.loopS : this.cfg.stockers.find((s) => s.id === r.id)!.loopS;
  }

  private pick(fromS: number, t: number): Veh {
    let best = this.vehs[0];
    let bd = Infinity;
    for (const v of this.vehs) {
      const wait = Math.max(0, v.freeAt - t);
      const cost = this.fwd(v.s, fromS) / this.cfg.vehicleSpeed + wait * 2;
      if (cost < bd) {
        bd = cost;
        best = v;
      }
    }
    return best;
  }

  /** Tool to stocker, dispatched at the track-out event. */
  private outbound(lot: LiveLot, tool: LiveTool, t: number): Transfer {
    const to: Ref = { k: "stocker", id: this.nearestStocker(tool.def.loopS, true) };
    const from: Ref = { k: "tool", id: tool.def.id };
    const sp = this.cfg.vehicleSpeed;
    const v = this.pick(tool.def.loopS, t);
    const t0 = Math.max(t, v.freeAt);
    const bd = this.fwd(v.s, tool.def.loopS);
    const carry = this.fwd(tool.def.loopS, this.refS(to));
    const tArr = t0 + bd / sp;
    const liftT1 = tArr + DWELL;
    const tDrop = liftT1 + carry / sp;
    const lowerT1 = tDrop + DWELL;
    const s0 = v.s;
    const plan = [
      { t0, t1: tArr, s0, s1: s0 + bd },
      { t0: tArr, t1: liftT1, s0: s0 + bd, s1: s0 + bd },
      { t0: liftT1, t1: tDrop, s0: s0 + bd, s1: s0 + bd + carry },
      { t0: tDrop, t1: lowerT1, s0: s0 + bd + carry, s1: s0 + bd + carry },
    ];
    v.s = (s0 + bd + carry) % this.cfg.loopLength;
    v.freeAt = lowerT1;
    return { vehId: v.id, from, to, liftT0: tArr, liftT1, lowerT0: tDrop, lowerT1, plan, endS: v.s };
  }

  /** Stocker to tool, shown arriving at the track-in event. */
  private inbound(lot: LiveLot, from: Ref, tool: LiveTool, t: number): Transfer {
    const to: Ref = { k: "tool", id: tool.def.id };
    const sp = this.cfg.vehicleSpeed;
    const fromS = this.refS(from);
    const carry = this.fwd(fromS, tool.def.loopS);
    const v = this.pick(fromS, t);
    const tDrop = t;
    const liftT1 = tDrop - carry / sp;
    const tArr = liftT1 - DWELL;
    const lowerT1 = tDrop + DWELL;
    const plan = [
      { t0: tArr, t1: liftT1, s0: fromS, s1: fromS },
      { t0: liftT1, t1: tDrop, s0: fromS, s1: fromS + carry },
      { t0: tDrop, t1: lowerT1, s0: fromS + carry, s1: fromS + carry },
    ];
    v.s = tool.def.loopS;
    v.freeAt = lowerT1;
    return { vehId: v.id, from, to, liftT0: tArr, liftT1, lowerT0: tDrop, lowerT1, plan, endS: v.s };
  }

  // ------------------------------------------------------------------ snapshot

  snapshot(wallNow: number = Date.now()): Snapshot {
    const now = this.clock(wallNow);

    // Resolve transfers whose time has come, so lot locations follow the clock.
    for (const lot of this.lots.values()) {
      const x = lot.xfer;
      if (!x) continue;
      if (now >= x.lowerT1) {
        lot.loc = { k: x.to.k, id: x.to.id };
        lot.xfer = null;
        if (x.to.k === "stocker") lot.readyAt = Math.max(lot.readyAt, x.lowerT1);
      } else if (x.liftT1 !== null && now >= x.liftT1) {
        lot.loc = { k: "vehicle", id: x.vehId };
      } else if (x.from.k === "tool") {
        lot.loc = { k: "tool", id: x.from.id };
      } else {
        lot.loc = { k: "stocker", id: x.from.id };
      }
    }

    const tools: ToolView[] = [...this.tools.values()].map((tl) => {
      const st = { ...tl.stateTime };
      st[tl.state] += Math.max(0, now - tl.since);
      const total = Object.values(st).reduce((a, b) => a + b, 0);
      let warn = false;
      for (const sev of tl.alarms.values()) if (sev === "warning") warn = true;
      return {
        id: tl.def.id,
        bay: tl.def.bay,
        state: tl.state,
        reason: tl.reason,
        since: tl.since,
        lotId: tl.lotId,
        assignedLotId: null,
        recipe: tl.recipe,
        endsIn: null,
        queue: 0,
        pmDueIn: 0,
        pmPending: false,
        warn,
        drift: 0,
        crew: "none",
        lotsDone: tl.lotsDone,
        util: total > 0 ? st.PRODUCTIVE / total : 0,
        stateTime: st,
      };
    });

    const lotViews: LotView[] = [...this.lots.values()].map((l) => {
      const status = l.inProcess && l.loc.k === "tool" ? "processing" : l.loc.k === "vehicle" ? "transit" : l.loc.k === "tool" ? "atTool" : "waiting";
      const raw = l.route ? routeRawS(l.route, this.cfg.recipes) : this.cfg.shiftS / 5;
      return {
        id: l.id,
        route: l.routeName,
        hot: l.hot,
        prio: 0,
        step: Math.min(l.step, Math.max(0, l.steps - 1)),
        steps: Math.max(l.steps, l.step + 1),
        recipe: l.recipe || "unknown",
        bay: l.bay,
        status,
        loc: l.loc,
        toolId: l.toolId,
        held: l.held,
        holdReason: l.holdReason,
        due: l.releasedAt + raw * (l.hot ? this.cfg.dueFactor.hot : this.cfg.dueFactor.normal),
        releasedAt: l.releasedAt,
        readyAt: l.readyAt,
        qtLeft: null,
        qtViolations: l.qtViolations,
        ooc: l.ooc,
      };
    });

    const vehicles: VehicleView[] = this.vehs.map((v) => {
      const lotX = [...this.lots.values()].find((l) => l.xfer?.vehId === v.id && now < l.xfer.lowerT1);
      const x = lotX?.xfer ?? null;
      const phase = !x ? "idle" : now < (x.liftT0 ?? 0) ? "toPick" : x.liftT1 !== null && now < x.liftT1 ? "lift" : now < x.lowerT0 ? "toDrop" : "lower";
      return {
        id: v.id,
        s: v.s,
        lotId: phase === "toDrop" || phase === "lower" ? (lotX?.id ?? null) : null,
        jobLotId: lotX?.id ?? null,
        jobTo: x ? { k: x.to.k, id: x.to.id } : null,
        phase,
        liftT0: x?.liftT0 ?? null,
        liftT1: x?.liftT1 ?? null,
        lowerT0: x?.lowerT0 ?? null,
        lowerT1: x?.lowerT1 ?? null,
        blocked: false,
        entryT: x ? x.plan[0].t0 : null,
        plan: x ? x.plan : [],
      };
    });

    const bays: BayView[] = this.cfg.bays.map((b) => {
      const ts = tools.filter((t) => t.bay === b.id);
      const waits = lotViews.filter((l) => l.bay === b.id && l.status === "waiting" && !l.held).map((l) => now - l.readyAt);
      return {
        id: b.id,
        rule: b.defaultRule,
        queue: lotViews.filter((l) => l.bay === b.id && (l.status === "waiting" || l.status === "transit") && l.toolId === null).length,
        toolsUp: ts.filter((t) => t.state !== "UNSCHEDULED_DOWN").length,
        toolCount: ts.length,
        util: ts.reduce((a, t) => a + t.util, 0) / Math.max(ts.length, 1),
        oldestWaitS: waits.length ? Math.max(...waits) : 0,
      };
    });

    const wipMap = new Map<string, WipRow>();
    for (const r of Object.values(this.cfg.recipes)) wipMap.set(r.id, { recipe: r.id, bay: r.bay, waiting: 0, transit: 0, processing: 0, held: 0 });
    for (const l of lotViews) {
      const row = wipMap.get(l.recipe);
      if (!row) continue;
      if (l.held) row.held++;
      else if (l.status === "processing" || l.status === "atTool") row.processing++;
      else if (l.status === "transit") row.transit++;
      else row.waiting++;
    }

    const spc: SpcSeries[] = this.cfg.spc.map((s) => ({ param: s.param, label: s.label, unit: s.unit, target: s.target, sigma: s.sigma, points: this.spc.get(s.param) ?? [] }));

    return {
      t: now,
      shiftS: Math.max(600, Math.ceil(now / 300) * 300),
      seed: 0,
      ended: false,
      tools,
      lots: lotViews,
      vehicles,
      oht: { cells: 0, waitS: 0, blockedNow: 0, jobsQueued: 0 },
      bays,
      wip: [...wipMap.values()],
      spc,
      kpi: this.kpi(now, tools, lotViews.length),
      objectives: [],
      score: 0,
      crew: { total: 0, busy: 0, waiting: [] },
      expeditesLeft: 0,
    };
  }

  private kpi(now: number, tools: ToolView[], wip: number): Kpi {
    const d = this.done;
    const hot = d.filter((x) => x.hot);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const withRoute = d.filter((x) => x.rawS !== null);
    const timed = d.filter((x) => x.onTime !== null);
    return {
      shipped: d.length,
      shippedHot: hot.length,
      wip,
      throughputPerHr: now > 60 ? d.length / (now / 3600) : 0,
      avgCtS: mean(d.map((x) => x.ctS)),
      avgHotCtS: mean(hot.map((x) => x.ctS)),
      xFactor: mean(withRoute.map((x) => x.ctS / (x.rawS as number))),
      otd: timed.length ? timed.filter((x) => x.onTime).length / timed.length : null,
      qtViolations: this.qtViolations,
      oocEscapes: d.filter((x) => x.ooc).length,
      avgUtil: tools.reduce((a, t) => a + t.util, 0) / Math.max(tools.length, 1),
      downtimeS: tools.reduce((a, t) => a + t.stateTime.UNSCHEDULED_DOWN, 0),
    };
  }
}
