import type { DispatchRule } from "./types";

export interface RankInput {
  id: string;
  /** 0 normal, 1 expedited by the shift lead. */
  prio: 0 | 1;
  /** True once 75 percent of the lot's queue-time allowance is used. Every rule serves these first. */
  urgent: boolean;
  /** When the lot became ready for this step. */
  readyAt: number;
  due: number;
  recipe: string;
  /** Raw process time still to go, current step included. */
  remainingRawS: number;
  remainingSteps: number;
}

export interface DispatchContext {
  rule: DispatchRule;
  now: number;
  /** Recipe currently loaded on the tool that is asking for work. */
  toolRecipe: string | null;
}

/** Allowance per remaining step for transport and queueing, in the critical-ratio denominator. */
const STEP_ALLOWANCE_S = 60;

/**
 * Critical ratio = time left until due date / work left.
 * Below 1 the lot is behind schedule. Lower is more urgent.
 */
export function criticalRatio(lot: RankInput, now: number): number {
  const work = lot.remainingRawS + STEP_ALLOWANCE_S * lot.remainingSteps;
  return (lot.due - now) / Math.max(work, 1);
}

function byId(a: RankInput, b: RankInput): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Orders lots for a tool. An expedited lot always wins, then lots whose queue-time clock is nearly spent,
 * then the bay's rule orders the rest. Ties break on lot id so the order is total.
 */
export function rankLots(lots: readonly RankInput[], ctx: DispatchContext): RankInput[] {
  const within = (a: RankInput, b: RankInput): number => {
    switch (ctx.rule) {
      case "FIFO":
        return a.readyAt - b.readyAt;
      case "EDD":
        return a.due - b.due;
      case "CR":
        return criticalRatio(a, ctx.now) - criticalRatio(b, ctx.now);
      case "SETUP": {
        const am = a.recipe === ctx.toolRecipe ? 0 : 1;
        const bm = b.recipe === ctx.toolRecipe ? 0 : 1;
        return am - bm || a.readyAt - b.readyAt;
      }
    }
  };
  return [...lots].sort((a, b) => b.prio - a.prio || Number(b.urgent) - Number(a.urgent) || within(a, b) || byId(a, b));
}

export const RULE_LABEL: Record<DispatchRule, string> = {
  FIFO: "First in, first out",
  EDD: "Earliest due date",
  CR: "Critical ratio",
  SETUP: "Setup avoidance",
};

export const RULE_HINT: Record<DispatchRule, string> = {
  FIFO: "Fair and predictable. Ignores due dates and setups.",
  EDD: "Serves the nearest due date first. Good when lots are late.",
  CR: "Time left divided by work left. Rescues lots that are falling behind.",
  SETUP: "Keeps the loaded recipe running. Cuts setup time, can starve other recipes.",
};
