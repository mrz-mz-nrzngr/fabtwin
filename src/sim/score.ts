import type { Kpi, ObjectiveView } from "./types";

export interface ScoreLine {
  label: string;
  points: number;
  detail: string;
}

export interface Score {
  total: number;
  lines: ScoreLine[];
}

/**
 * Shift score. Every term is visible in the post-shift report, so the player can see
 * what the number is made of. Shipping lots is the base. Objectives are bonuses.
 * Queue-time violations and quality escapes cost more than a lot is worth.
 */
export function scoreOf(kpi: Kpi, objectives: ObjectiveView[], ended = true): Score {
  const lines: ScoreLine[] = [];
  lines.push({ label: "Lots shipped", points: kpi.shipped * 100, detail: `${kpi.shipped} lots at 100 each` });
  const ship = objectives.find((o) => o.id === "ship")!;
  const hot = objectives.find((o) => o.id === "hotCt")!;
  const qt = objectives.find((o) => o.id === "qt")!;
  lines.push({ label: "Shipment objective", points: ship.met ? 500 : 0, detail: ship.met ? "Target met" : "Target missed" });
  lines.push({ label: "Hot-lot objective", points: ended && hot.met ? 400 : 0, detail: hot.met ? (ended ? "Hot lots ran fast enough" : "Counted at the end of the shift") : "Hot lots too slow, or none shipped" });
  lines.push({ label: "Queue-time objective", points: ended && qt.met ? 500 : 0, detail: qt.met ? (ended ? "No violations" : "Counted at the end of the shift") : "At least one violation" });
  const otd = kpi.otd === null ? 0 : Math.round(kpi.otd * 300);
  lines.push({ label: "On-time delivery", points: otd, detail: kpi.otd === null ? "Nothing shipped" : `${Math.round(kpi.otd * 100)} percent on time, 3 points each` });
  lines.push({ label: "Queue-time violations", points: -kpi.qtViolations * 120, detail: `${kpi.qtViolations} at -120 each` });
  lines.push({ label: "Quality escapes", points: -kpi.oocEscapes * 150, detail: `${kpi.oocEscapes} flagged lots shipped at -150 each` });
  return { total: lines.reduce((a, l) => a + l.points, 0), lines };
}

export function gradeOf(met: number, total: number, score: number, autopilotScore: number): "S" | "A" | "B" | "C" | "D" {
  if (met === total && score >= autopilotScore * 1.1) return "S";
  if (met === total) return "A";
  if (met === 2) return "B";
  if (met === 1) return "C";
  return "D";
}
