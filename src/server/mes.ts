import { EPOCH_MS, buildConfig } from "@/sim/config";
import { FabEngine } from "@/sim/engine";
import { buildReport } from "@/sim/report";
import type { ShiftReport } from "@/sim/report";
import type { Snapshot } from "@/sim/types";
import { applyEvents, emptyModels } from "@/store/readmodels";
import type { ReadModels } from "@/store/readmodels";
import { getLiveView } from "./live";

/**
 * The data behind the MES API. The simulated fab is a pure function of (seed, t): the same query always
 * returns the same answer, which is what makes the API stateless and safe to run on serverless hosts.
 * A live source (a FabTwin event feed the server follows) is available when FABTWIN_LIVE_URLS is set.
 */
export interface MesView {
  source: "simulation" | "live";
  seed: number | null;
  t: number;
  shiftS: number;
  baseMs: number;
  snapshot: Snapshot;
  models: ReadModels;
}

const cache = new Map<string, MesView>();
const MAX_CACHE = 12;

export function simulate(seed: number, t: number): MesView {
  const key = `${seed}:${Math.round(t)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const e = new FabEngine(buildConfig(seed));
  let models = emptyModels(EPOCH_MS);
  const target = Math.min(Math.max(0, Math.round(t)), e.cfg.shiftS);
  for (let at = 0; at < target; at += 600) {
    e.advanceTo(at);
    models = applyEvents(models, e.drainEvents());
  }
  e.advanceTo(target);
  models = applyEvents(models, e.drainEvents());
  const view: MesView = { source: "simulation", seed, t: target, shiftS: e.cfg.shiftS, baseMs: EPOCH_MS, snapshot: e.snapshot(), models };
  cache.set(key, view);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return view;
}

export function shiftReport(seed: number): ShiftReport {
  const e = new FabEngine(buildConfig(seed));
  e.advanceTo(e.cfg.shiftS);
  return buildReport(e);
}

export function view(source: string | null, seed: number, t: number): MesView | { error: string } {
  if (source === "live") {
    const v = getLiveView();
    return v ?? { error: "No live source is configured. Set FABTWIN_LIVE_URLS to one or more FabTwin event WebSocket URLs, comma separated." };
  }
  return simulate(seed, t);
}
