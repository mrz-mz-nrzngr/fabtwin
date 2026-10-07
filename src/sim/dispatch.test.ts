import { describe, expect, it } from "vitest";
import { criticalRatio, rankLots } from "./dispatch";
import type { RankInput } from "./dispatch";

const lot = (id: string, o: Partial<RankInput> = {}): RankInput => ({
  id,
  prio: 0,
  urgent: false,
  readyAt: 0,
  due: 10000,
  recipe: "LITH-M1",
  remainingRawS: 1000,
  remainingSteps: 5,
  ...o,
});
const ids = (xs: RankInput[]) => xs.map((x) => x.id);

describe("dispatch rules", () => {
  const lots = [
    lot("A", { readyAt: 300, due: 9000, recipe: "LITH-POLY" }),
    lot("B", { readyAt: 100, due: 12000, recipe: "LITH-M1" }),
    lot("C", { readyAt: 200, due: 6000, recipe: "LITH-POLY" }),
  ];

  it("FIFO orders by the time a lot became ready", () => {
    expect(ids(rankLots(lots, { rule: "FIFO", now: 400, toolRecipe: null }))).toEqual(["B", "C", "A"]);
  });

  it("EDD orders by due date", () => {
    expect(ids(rankLots(lots, { rule: "EDD", now: 400, toolRecipe: null }))).toEqual(["C", "A", "B"]);
  });

  it("critical ratio orders by time left over work left", () => {
    const set = [
      lot("long", { due: 9000, remainingRawS: 4000, remainingSteps: 10 }),
      lot("short", { due: 9000, remainingRawS: 500, remainingSteps: 2 }),
      lot("late", { due: 1000, remainingRawS: 2000, remainingSteps: 6 }),
    ];
    expect(criticalRatio(set[2], 2000)).toBeLessThan(0);
    expect(ids(rankLots(set, { rule: "CR", now: 2000, toolRecipe: null }))).toEqual(["late", "long", "short"]);
  });

  it("setup avoidance prefers the loaded recipe, then FIFO", () => {
    expect(ids(rankLots(lots, { rule: "SETUP", now: 400, toolRecipe: "LITH-POLY" }))).toEqual(["C", "A", "B"]);
    expect(ids(rankLots(lots, { rule: "SETUP", now: 400, toolRecipe: "LITH-M1" }))).toEqual(["B", "C", "A"]);
    expect(ids(rankLots(lots, { rule: "SETUP", now: 400, toolRecipe: null }))).toEqual(["B", "C", "A"]);
  });

  it("an expedited lot beats the rule, and a queue-time urgent lot beats the rule but not an expedited one", () => {
    const set = [lot("first", { readyAt: 0 }), lot("urgent", { readyAt: 500, urgent: true }), lot("exp", { readyAt: 900, prio: 1 })];
    expect(ids(rankLots(set, { rule: "FIFO", now: 1000, toolRecipe: null }))).toEqual(["exp", "urgent", "first"]);
    expect(ids(rankLots(set, { rule: "EDD", now: 1000, toolRecipe: null }))).toEqual(["exp", "urgent", "first"]);
  });

  it("breaks ties on lot id so the order is total and input order does not matter", () => {
    const set = [lot("L3"), lot("L1"), lot("L2")];
    const a = ids(rankLots(set, { rule: "FIFO", now: 0, toolRecipe: null }));
    const b = ids(rankLots([...set].reverse(), { rule: "FIFO", now: 0, toolRecipe: null }));
    expect(a).toEqual(["L1", "L2", "L3"]);
    expect(b).toEqual(a);
  });

  it("does not mutate its input", () => {
    const set = [lot("B", { readyAt: 5 }), lot("A", { readyAt: 1 })];
    rankLots(set, { rule: "FIFO", now: 0, toolRecipe: null });
    expect(ids(set)).toEqual(["B", "A"]);
  });
});
