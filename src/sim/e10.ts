import type { E10State } from "@/events/types";

/**
 * SEMI E10 equipment states, reduced to the five the game uses.
 *
 * - PRODUCTIVE: processing product wafers.
 * - STANDBY: up and idle, no operator or WIP reason to run.
 * - ENGINEERING: qualification and test runs, here the requalification after maintenance.
 * - SCHEDULED_DOWN: planned downtime, here preventive maintenance and recipe setup.
 * - UNSCHEDULED_DOWN: failure and the wait for repair.
 */
export const E10_LABEL: Record<E10State, string> = {
  PRODUCTIVE: "Productive",
  STANDBY: "Standby",
  ENGINEERING: "Engineering",
  SCHEDULED_DOWN: "Scheduled down",
  UNSCHEDULED_DOWN: "Unscheduled down",
};

export const E10_SHORT: Record<E10State, string> = {
  PRODUCTIVE: "PRD",
  STANDBY: "SBY",
  ENGINEERING: "ENG",
  SCHEDULED_DOWN: "SDT",
  UNSCHEDULED_DOWN: "UDT",
};

/** Legal transitions. Anything else is a bug in the model, and the engine throws on it. */
const ALLOWED: Record<E10State, readonly E10State[]> = {
  PRODUCTIVE: ["STANDBY", "SCHEDULED_DOWN", "UNSCHEDULED_DOWN"],
  STANDBY: ["PRODUCTIVE", "SCHEDULED_DOWN", "UNSCHEDULED_DOWN"],
  ENGINEERING: ["STANDBY", "UNSCHEDULED_DOWN"],
  SCHEDULED_DOWN: ["PRODUCTIVE", "ENGINEERING", "STANDBY", "UNSCHEDULED_DOWN"],
  UNSCHEDULED_DOWN: ["ENGINEERING", "STANDBY"],
};

export function canTransition(from: E10State, to: E10State): boolean {
  return ALLOWED[from].includes(to);
}

export function emptyStateTime(): Record<E10State, number> {
  return { PRODUCTIVE: 0, STANDBY: 0, ENGINEERING: 0, SCHEDULED_DOWN: 0, UNSCHEDULED_DOWN: 0 };
}

export const isDown = (s: E10State) => s === "UNSCHEDULED_DOWN" || s === "SCHEDULED_DOWN" || s === "ENGINEERING";
