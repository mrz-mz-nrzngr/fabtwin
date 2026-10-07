import { buildConfig } from "./config";
import { FabEngine } from "./engine";
import { gradeOf, scoreOf } from "./score";
import type { Score } from "./score";
import type { Command, Kpi, LoggedCommand, ObjectiveView } from "./types";

export interface Driver {
  title: string;
  detail: string;
  tone: "good" | "bad" | "neutral";
}

export interface ReportToolRow {
  id: string;
  bay: string;
  failures: number;
  downS: number;
  util: number;
}

export interface AutopilotSummary {
  score: number;
  kpi: Kpi;
  objectivesMet: number;
}

export interface ShiftReport {
  seed: number;
  grade: "S" | "A" | "B" | "C" | "D";
  score: Score;
  kpi: Kpi;
  objectives: ObjectiveView[];
  autopilot: AutopilotSummary;
  drivers: Driver[];
  tools: ReportToolRow[];
  qtByRecipe: Array<{ recipe: string; count: number }>;
  commands: LoggedCommand[];
  replay: { seed: number; commands: Array<{ t: number; cmd: Command }> };
}

const mins = (s: number) => `${Math.round(s / 60)} min`;
const pct = (x: number) => `${Math.round(x * 100)} percent`;

export function clock(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Same seed, default rules, no interventions. The yardstick for "what did your decisions change". */
export function runAutopilot(seed: number): FabEngine {
  const e = new FabEngine(buildConfig(seed));
  e.advanceTo(e.cfg.shiftS);
  return e;
}

export function buildReport(engine: FabEngine, autopilot: FabEngine = runAutopilot(engine.cfg.seed)): ShiftReport {
  const snap = engine.snapshot();
  const kpi = snap.kpi;
  const objectives = snap.objectives;
  const score = scoreOf(kpi, objectives);
  const apSnap = autopilot.snapshot();
  const apScore = apSnap.score;
  const apMet = apSnap.objectives.filter((o) => o.met).length;
  const met = objectives.filter((o) => o.met).length;
  const grade = gradeOf(met, objectives.length, score.total, apScore);
  const o = engine.cfg.objectives;

  const failures = new Map<string, number>();
  for (const f of engine.failureLog) failures.set(f.toolId, (failures.get(f.toolId) ?? 0) + 1);
  const tools: ReportToolRow[] = snap.tools
    .map((t) => ({ id: t.id, bay: t.bay, failures: failures.get(t.id) ?? 0, downS: t.stateTime.UNSCHEDULED_DOWN, util: t.util }))
    .sort((a, b) => b.downS - a.downS);

  const qtMap = new Map<string, number>();
  for (const q of engine.qtLog) qtMap.set(q.recipe, (qtMap.get(q.recipe) ?? 0) + 1);
  const qtByRecipe = [...qtMap.entries()].map(([recipe, count]) => ({ recipe, count })).sort((a, b) => b.count - a.count);

  const drivers: Driver[] = [];

  const constraint = [...snap.bays].sort((a, b) => b.util - a.util)[0];
  const constraintDown = tools.filter((t) => t.bay === constraint.id).reduce((a, t) => a + t.downS, 0);
  const bayName = engine.cfg.bays.find((b) => b.id === constraint.id)!.name;
  drivers.push({
    tone: "neutral",
    title: `${bayName} set the pace`,
    detail: `${bayName} ran at ${pct(constraint.util)} utilization, the highest of any bay, and lost ${mins(constraintDown)} of tool time to failures. Output cannot beat the constraint, so every minute it stood still was lost shipments.`,
  });

  const worst = tools[0];
  if (worst && worst.downS > 0) {
    drivers.push({
      tone: worst.downS > 1800 ? "bad" : "neutral",
      title: `${worst.id} cost the most downtime`,
      detail: `${worst.id} failed ${worst.failures} time${worst.failures === 1 ? "" : "s"} and was down ${mins(worst.downS)}. Fleet-wide unscheduled downtime was ${mins(kpi.downtimeS)} across ${tools.filter((t) => t.failures > 0).length} tools.`,
    });
  }

  if (kpi.qtViolations > 0) {
    const top = qtByRecipe[0];
    drivers.push({
      tone: "bad",
      title: `${kpi.qtViolations} queue-time violation${kpi.qtViolations === 1 ? "" : "s"}`,
      detail: `Most at ${top.recipe} (${top.count}). Each one forced a re-clean that stretched the step by 20 percent and cost 120 points. Autopilot had ${apSnap.kpi.qtViolations}.`,
    });
  } else {
    drivers.push({ tone: "good", title: "No queue-time violations", detail: `Every limited step started inside its window. Autopilot had ${apSnap.kpi.qtViolations}.` });
  }

  if (kpi.avgHotCtS !== null) {
    const ap = apSnap.kpi.avgHotCtS;
    drivers.push({
      tone: kpi.avgHotCtS <= o.hotCtMaxS ? "good" : "bad",
      title: `Hot lots averaged ${mins(kpi.avgHotCtS)}`,
      detail: `Target was ${mins(o.hotCtMaxS)}${ap !== null ? `, autopilot managed ${mins(ap)}` : ""}. FIFO ignores due dates, so hot lots only run ahead of the pack when a due-date rule (EDD, critical ratio) or an expedite says so.`,
    });
  }

  const ruleCmds = engine.commandLog.filter((c) => c.result.ok && c.cmd.type === "setRule");
  const otherCmds = engine.commandLog.filter((c) => c.result.ok && c.cmd.type !== "setRule");
  const ds = kpi.shipped - apSnap.kpi.shipped;
  drivers.push({
    tone: ds > 0 ? "good" : ds < 0 ? "bad" : "neutral",
    title: ds === 0 ? "Your shift matched autopilot on output" : `You shipped ${Math.abs(ds)} ${ds > 0 ? "more" : "fewer"} lots than autopilot`,
    detail: `${kpi.shipped} shipped against ${apSnap.kpi.shipped} for the same seed with FIFO everywhere and no interventions. You made ${ruleCmds.length} rule change${ruleCmds.length === 1 ? "" : "s"} and ${otherCmds.length} other action${otherCmds.length === 1 ? "" : "s"}.`,
  });

  if (kpi.oocEscapes > 0) {
    drivers.push({
      tone: "bad",
      title: `${kpi.oocEscapes} quality escape${kpi.oocEscapes === 1 ? "" : "s"}`,
      detail: `${kpi.oocEscapes} lot${kpi.oocEscapes === 1 ? "" : "s"} flagged by an SPC excursion shipped without a clean disposition, at 150 points each. Service the suspect tool, then release the held lot, and the flag clears.`,
    });
  }

  return {
    seed: engine.cfg.seed,
    grade,
    score,
    kpi,
    objectives,
    autopilot: { score: apScore, kpi: apSnap.kpi, objectivesMet: apMet },
    drivers,
    tools: tools.slice(0, 8),
    qtByRecipe,
    commands: engine.commandLog.map(({ t, cmd, result }) => ({ t, cmd, result })),
    replay: { seed: engine.cfg.seed, commands: engine.commandLog.filter((c) => c.result.ok).map(({ t, cmd }) => ({ t, cmd })) },
  };
}
