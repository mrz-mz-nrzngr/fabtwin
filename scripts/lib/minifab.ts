/**
 * A small real-time fab flow used by the protocol demos (Sparkplug edge simulator, OPC UA sample
 * server, the GemBench fab-in-a-box host). It releases lots onto a FabTwin route, sends each lot to
 * an idle tool of the right bay, and tells the caller what happens. It is a stand-in for a plant, not
 * a model of one: the point is to give the integrations realistic traffic.
 *
 * Time is real seconds. A step lasts `stepS` seconds whatever the recipe, so a 12 step lot takes a few
 * minutes. Call tick() from a timer; tests call it with a fake clock.
 */
import { RECIPES, ROUTES } from "../../src/sim/config";
import type { BayId, RouteDef } from "../../src/sim/types";

export interface FabTool {
  id: string;
  bay: BayId;
}

export interface FabLot {
  id: string;
  route: RouteDef;
  hot: boolean;
  step: number;
  releasedAt: number;
}

export type ToolPhase = "STANDBY" | "PRODUCTIVE" | "UNSCHEDULED_DOWN" | "ENGINEERING";

export interface MiniFabHooks {
  /** A lot starts on a tool. Return the process time in seconds to let the flow time it, or undefined to call finish() yourself. */
  onStart(tool: FabTool, lot: FabLot, recipe: string): number | undefined;
  onFinish(tool: FabTool, lot: FabLot, recipe: string, final: boolean): void;
  onRelease?(lot: FabLot): void;
  onPhase?(tool: FabTool, phase: ToolPhase, reason: string): void;
  onAlarm?(tool: FabTool, code: string, active: boolean, text: string): void;
  onMeasure?(tool: FabTool, param: string, value: number, unit: string): void;
}

export interface MiniFabOptions {
  tools: FabTool[];
  seed?: number;
  releaseEveryS?: number;
  maxWip?: number;
  stepS?: number;
  /** Mean seconds between failures per tool, 0 for none. */
  mtbfS?: number;
  repairS?: number;
  routeIds?: string[];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DRIFT: Record<string, { target: number; sigma: number; unit: string }> = {
  CD: { target: 45, sigma: 0.8, unit: "nm" },
  OVL: { target: 3.2, sigma: 0.6, unit: "nm" },
  THK: { target: 120, sigma: 1.5, unit: "nm" },
};

export class MiniFab {
  private rand: () => number;
  private t = 0;
  private lotSeq = 0;
  private waiting: FabLot[] = [];
  private busy = new Map<string, { lot: FabLot; recipe: string; endsAt: number | null }>();
  private down = new Map<string, { until: number; phase: "UNSCHEDULED_DOWN" | "ENGINEERING" }>();
  private nextRelease = 0;
  private routes: RouteDef[];
  shipped = 0;

  constructor(
    private readonly o: MiniFabOptions,
    private readonly h: MiniFabHooks,
  ) {
    this.rand = rng(o.seed ?? 1);
    this.routes = ROUTES.filter((r) => !o.routeIds || o.routeIds.includes(r.id));
  }

  get now() {
    return this.t;
  }
  get wip() {
    return this.waiting.length + this.busy.size;
  }

  idle(tool: FabTool): boolean {
    return !this.busy.has(tool.id) && !this.down.has(tool.id);
  }

  /** Advance the clock by dt seconds. */
  tick(dt: number) {
    this.t += dt;
    for (const [id, d] of [...this.down]) {
      if (this.t < d.until) continue;
      const tool = this.o.tools.find((x) => x.id === id)!;
      if (d.phase === "UNSCHEDULED_DOWN") {
        this.h.onAlarm?.(tool, "TOOL_FAULT", false, `${id} repaired`);
        this.down.set(id, { until: this.t + 4, phase: "ENGINEERING" });
        this.h.onPhase?.(tool, "ENGINEERING", "post-repair qual");
      } else {
        this.down.delete(id);
        this.h.onPhase?.(tool, "STANDBY", "qualified");
      }
    }
    for (const [id, b] of [...this.busy]) {
      if (b.endsAt !== null && this.t >= b.endsAt) this.finish(id);
    }
    const every = this.o.releaseEveryS ?? 20;
    while (this.t >= this.nextRelease && this.wip < (this.o.maxWip ?? 14)) {
      this.release();
      this.nextRelease += every;
    }
    if (this.t >= this.nextRelease) this.nextRelease = this.t + every;
    this.maybeFail(dt);
    this.dispatch();
  }

  /** Finish whatever a tool is running. For callers that time the process themselves. */
  finish(toolId: string) {
    const b = this.busy.get(toolId);
    if (!b) return;
    this.busy.delete(toolId);
    const tool = this.o.tools.find((x) => x.id === toolId)!;
    const final = b.lot.step >= b.lot.route.steps.length - 1;
    const meas = RECIPES[b.recipe]?.measures;
    if (meas) {
      const d = DRIFT[meas];
      const z = (this.rand() + this.rand() + this.rand() - 1.5) * 1.6;
      this.h.onMeasure?.(tool, meas, Math.round((d.target + z * d.sigma) * 1000) / 1000, d.unit);
    }
    this.h.onFinish(tool, b.lot, b.recipe, final);
    if (final) this.shipped++;
    else {
      b.lot.step++;
      this.waiting.push(b.lot);
    }
  }

  private release() {
    const route = this.routes[Math.floor(this.rand() * this.routes.length)];
    const lot: FabLot = { id: `L${String(++this.lotSeq).padStart(4, "0")}`, route, hot: this.rand() < 0.12, step: 0, releasedAt: this.t };
    this.waiting.push(lot);
    this.h.onRelease?.(lot);
  }

  private dispatch() {
    for (const lot of [...this.waiting]) {
      const recipe = lot.route.steps[lot.step].recipe;
      const bay = RECIPES[recipe].bay;
      const tool = this.o.tools.find((x) => x.bay === bay && this.idle(x));
      if (!tool) continue;
      this.waiting.splice(this.waiting.indexOf(lot), 1);
      const dur = this.h.onStart(tool, lot, recipe);
      this.busy.set(tool.id, { lot, recipe, endsAt: dur === undefined ? null : this.t + dur });
    }
  }

  private maybeFail(dt: number) {
    const mtbf = this.o.mtbfS ?? 0;
    if (!mtbf) return;
    for (const tool of this.o.tools) {
      if (!this.idle(tool)) continue;
      if (this.rand() < dt / mtbf) {
        this.down.set(tool.id, { until: this.t + (this.o.repairS ?? 25), phase: "UNSCHEDULED_DOWN" });
        this.h.onAlarm?.(tool, "TOOL_FAULT", true, `${tool.id} chamber fault`);
        this.h.onPhase?.(tool, "UNSCHEDULED_DOWN", "failure");
      }
    }
  }

  /** Seconds a step takes in this flow. */
  get stepS() {
    return this.o.stepS ?? 12;
  }

  run(intervalMs = 500): () => void {
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      this.tick((now - last) / 1000);
      last = now;
    }, intervalMs);
    return () => clearInterval(timer);
  }
}

export const DEMO_TOOLS: FabTool[] = [
  { id: "LTH-01", bay: "LITHO" },
  { id: "LTH-02", bay: "LITHO" },
  { id: "LTH-03", bay: "LITHO" },
  { id: "ETC-01", bay: "ETCH" },
  { id: "ETC-02", bay: "ETCH" },
  { id: "ETC-03", bay: "ETCH" },
  { id: "DEP-01", bay: "DEP" },
  { id: "DEP-02", bay: "DEP" },
  { id: "CMP-01", bay: "CMP" },
  { id: "CMP-02", bay: "CMP" },
  { id: "MET-01", bay: "METRO" },
  { id: "MET-02", bay: "METRO" },
];
