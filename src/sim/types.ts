import type { E10State } from "@/events/types";

export type BayId = "LITHO" | "ETCH" | "DEP" | "CMP" | "METRO";
export type DispatchRule = "FIFO" | "EDD" | "CR" | "SETUP";
export type SpcParam = "CD" | "OVL" | "THK";

export const BAY_ORDER: readonly BayId[] = ["LITHO", "ETCH", "DEP", "CMP", "METRO"];
export const RULES: readonly DispatchRule[] = ["FIFO", "EDD", "CR", "SETUP"];

export interface RecipeDef {
  id: string;
  bay: BayId;
  name: string;
  processS: number;
  /** Seconds of scheduled downtime when the tool changes to this recipe from another. */
  setupS: number;
  /** Set on metrology recipes. */
  measures?: SpcParam;
}

export interface RouteStepDef {
  recipe: string;
  /** Queue-time limit: max seconds from the previous step completing to this step's track-in. */
  qtS?: number;
}

export interface RouteDef {
  id: string;
  name: string;
  steps: RouteStepDef[];
  /** Share of releases that use this route. */
  mix: number;
}

export interface ToolDef {
  id: string;
  bay: BayId;
  index: number;
  x: number;
  z: number;
  /** Arc position of the tool's load port on the OHT loop. */
  loopS: number;
  mtbfS: number;
  mttrS: number;
  pmIntervalS: number;
  pmDurS: number;
  qualS: number;
  /** Multiplier on process time. Below 1 is faster. */
  speed: number;
  /** Static measurement bias in sigma units. */
  bias: number;
}

export interface StockerDef {
  id: string;
  x: number;
  z: number;
  loopS: number;
}

export interface BayDef {
  id: BayId;
  name: string;
  defaultRule: DispatchRule;
}

export interface SpcSpec {
  param: SpcParam;
  label: string;
  unit: string;
  target: number;
  sigma: number;
}

export interface SimConfig {
  seed: number;
  shiftS: number;
  epochMs: number;
  bays: BayDef[];
  recipes: Record<string, RecipeDef>;
  routes: RouteDef[];
  tools: ToolDef[];
  stockers: StockerDef[];
  spc: SpcSpec[];
  loopLength: number;
  vehicleCount: number;
  vehicleSpeed: number;
  vehicleDwellS: number;
  crewSize: number;
  wipCap: number;
  releaseIntervalS: number;
  hotFraction: number;
  warmLots: number;
  dueFactor: { normal: number; hot: number };
  expediteBudget: number;
  prestageS: number;
  waferPerLot: number;
  failuresEnabled: boolean;
  excursionsEnabled: boolean;
  releasesEnabled: boolean;
  objectives: { shipTarget: number; hotCtMaxS: number };
}

export type LotStatus = "waiting" | "transit" | "atTool" | "processing" | "done";

export type Loc =
  | { k: "stocker"; id: string }
  | { k: "tool"; id: string }
  | { k: "vehicle"; id: string }
  | { k: "gone" };

export interface LotView {
  id: string;
  route: string;
  hot: boolean;
  prio: 0 | 1;
  step: number;
  steps: number;
  recipe: string;
  bay: BayId;
  status: LotStatus;
  loc: Loc;
  toolId: string | null;
  held: boolean;
  holdReason: "operator" | "spc" | null;
  due: number;
  releasedAt: number;
  readyAt: number;
  /** Seconds left on the active queue-time clock, or null when none runs. */
  qtLeft: number | null;
  qtViolations: number;
  ooc: boolean;
}

export interface ToolView {
  id: string;
  bay: BayId;
  state: E10State;
  reason: string;
  since: number;
  lotId: string | null;
  assignedLotId: string | null;
  recipe: string | null;
  /** Seconds until the current process or maintenance step ends, when known. */
  endsIn: number | null;
  queue: number;
  pmDueIn: number;
  pmPending: boolean;
  /** 0..1, higher is riskier. Derived from the hidden failure schedule only as a degradation hint. */
  warn: boolean;
  drift: number;
  crew: "none" | "waiting" | "assigned";
  lotsDone: number;
  util: number;
  stateTime: Record<E10State, number>;
}

export interface VehicleSeg {
  t0: number;
  t1: number;
  s0: number;
  s1: number;
}

export interface VehicleView {
  id: string;
  s: number;
  lotId: string | null;
  /** Lot of the job in progress, set from assignment until the drop. */
  jobLotId: string | null;
  jobTo: { k: "tool" | "stocker"; id: string } | null;
  plan: VehicleSeg[];
}

export interface BayView {
  id: BayId;
  rule: DispatchRule;
  queue: number;
  toolsUp: number;
  toolCount: number;
  util: number;
  oldestWaitS: number;
}

export interface WipRow {
  recipe: string;
  bay: BayId;
  waiting: number;
  transit: number;
  processing: number;
  held: number;
}

export interface SpcPoint {
  t: number;
  lotId: string;
  toolId: string;
  upstream: string;
  value: number;
  rules: number[];
}

export interface SpcSeries {
  param: SpcParam;
  label: string;
  unit: string;
  target: number;
  sigma: number;
  points: SpcPoint[];
}

export interface Kpi {
  shipped: number;
  shippedHot: number;
  wip: number;
  throughputPerHr: number;
  avgCtS: number | null;
  avgHotCtS: number | null;
  xFactor: number | null;
  otd: number | null;
  qtViolations: number;
  oocEscapes: number;
  avgUtil: number;
  downtimeS: number;
}

export interface ObjectiveView {
  id: "ship" | "hotCt" | "qt";
  label: string;
  target: number;
  value: number | null;
  /** Unit label for display. */
  unit: string;
  dir: "min" | "max";
  met: boolean;
  /** For max objectives, true once the target is already broken and cannot be recovered. */
  failed: boolean;
}

export interface Snapshot {
  t: number;
  shiftS: number;
  seed: number;
  ended: boolean;
  tools: ToolView[];
  lots: LotView[];
  vehicles: VehicleView[];
  bays: BayView[];
  wip: WipRow[];
  spc: SpcSeries[];
  kpi: Kpi;
  objectives: ObjectiveView[];
  score: number;
  crew: { total: number; busy: number; waiting: string[] };
  expeditesLeft: number;
}

export type Command =
  | { type: "setRule"; bay: BayId; rule: DispatchRule }
  | { type: "expedite"; lotId: string }
  | { type: "pmEarly"; toolId: string }
  | { type: "assignCrew"; toolId: string }
  | { type: "hold"; lotId: string }
  | { type: "release"; lotId: string };

export interface CommandResult {
  ok: boolean;
  message: string;
}

export interface LoggedCommand {
  t: number;
  cmd: Command;
  result: CommandResult;
}
