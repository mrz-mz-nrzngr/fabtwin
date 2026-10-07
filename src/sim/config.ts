import { gamma, urand } from "./rng";
import type {
  BayDef,
  BayId,
  RecipeDef,
  RouteDef,
  SimConfig,
  SpcSpec,
  StockerDef,
  ToolDef,
} from "./types";

/** The shift is time-compressed: one shift of 4 simulated hours stands in for a day of fab flow. */
export const SHIFT_S = 4 * 3600;
export const EPOCH_MS = Date.UTC(2026, 0, 12, 6, 0, 0);

export const LOOP = { x0: -56, x1: 56, z0: -20, z1: 20 } as const;
export const LOOP_W = LOOP.x1 - LOOP.x0;
export const LOOP_D = LOOP.z1 - LOOP.z0;
export const LOOP_LENGTH = 2 * (LOOP_W + LOOP_D);

/** World position on the OHT loop for an arc length s, travelling clockwise seen from above. */
export function loopPos(s: number): { x: number; z: number; dx: number; dz: number } {
  const p = ((s % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH;
  if (p < LOOP_W) return { x: LOOP.x0 + p, z: LOOP.z0, dx: 1, dz: 0 };
  if (p < LOOP_W + LOOP_D) return { x: LOOP.x1, z: LOOP.z0 + (p - LOOP_W), dx: 0, dz: 1 };
  if (p < 2 * LOOP_W + LOOP_D) return { x: LOOP.x1 - (p - LOOP_W - LOOP_D), z: LOOP.z1, dx: -1, dz: 0 };
  return { x: LOOP.x0, z: LOOP.z1 - (p - 2 * LOOP_W - LOOP_D), dx: 0, dz: -1 };
}

export const BAYS: BayDef[] = [
  { id: "LITHO", name: "Lithography", defaultRule: "FIFO" },
  { id: "ETCH", name: "Etch", defaultRule: "FIFO" },
  { id: "DEP", name: "Deposition", defaultRule: "FIFO" },
  { id: "CMP", name: "CMP", defaultRule: "FIFO" },
  { id: "METRO", name: "Metrology", defaultRule: "FIFO" },
];

const R = (id: string, bay: BayId, name: string, processS: number, setupS: number, measures?: RecipeDef["measures"]): RecipeDef => ({
  id,
  bay,
  name,
  processS,
  setupS,
  measures,
});

export const RECIPES: Record<string, RecipeDef> = Object.fromEntries(
  [
    R("LITH-ACT", "LITHO", "Litho active area", 170, 45),
    R("LITH-POLY", "LITHO", "Litho poly gate", 190, 45),
    R("LITH-M1", "LITHO", "Litho metal 1", 200, 45),
    R("LITH-VIA", "LITHO", "Litho via", 180, 45),
    R("LITH-M2", "LITHO", "Litho metal 2", 200, 45),
    R("ETCH-ACT", "ETCH", "Etch shallow trench", 115, 20),
    R("ETCH-POLY", "ETCH", "Etch poly gate", 125, 20),
    R("ETCH-VIA", "ETCH", "Etch via", 135, 20),
    R("DEP-OX", "DEP", "Deposit oxide", 140, 25),
    R("DEP-NIT", "DEP", "Deposit nitride", 125, 25),
    R("DEP-W", "DEP", "Deposit tungsten", 155, 25),
    R("DEP-CU", "DEP", "Deposit copper seed", 165, 25),
    R("CMP-OX", "CMP", "Polish oxide", 170, 25),
    R("CMP-W", "CMP", "Polish tungsten", 180, 25),
    R("CMP-CU", "CMP", "Polish copper", 190, 25),
    R("MET-CD", "METRO", "CD-SEM", 120, 10, "CD"),
    R("MET-OVL", "METRO", "Overlay", 130, 10, "OVL"),
    R("MET-THK", "METRO", "Film thickness", 110, 10, "THK"),
  ].map((r) => [r.id, r]),
);

const S = (recipe: string, qtS?: number) => (qtS ? { recipe, qtS } : { recipe });

export const ROUTES: RouteDef[] = [
  {
    id: "PWR-12",
    name: "Power MOSFET, 12 steps",
    mix: 0.3,
    steps: [
      S("LITH-ACT"), S("ETCH-ACT", 360), S("MET-CD"), S("DEP-OX"),
      S("LITH-POLY"), S("ETCH-POLY", 360), S("MET-OVL"), S("DEP-NIT"),
      S("CMP-OX"), S("LITH-M1"), S("ETCH-VIA", 360), S("MET-CD"),
    ],
  },
  {
    id: "LOGIC-16",
    name: "Logic 28 nm, 16 steps",
    mix: 0.4,
    steps: [
      S("LITH-ACT"), S("ETCH-ACT", 360), S("MET-CD"), S("DEP-OX"),
      S("CMP-OX"), S("LITH-POLY"), S("ETCH-POLY", 360), S("MET-OVL"),
      S("DEP-NIT"), S("LITH-M1"), S("ETCH-VIA", 360), S("DEP-W", 480),
      S("CMP-W", 480), S("LITH-VIA"), S("ETCH-VIA", 360), S("MET-THK"),
    ],
  },
  {
    id: "SOC-20",
    name: "SoC 20 nm, 20 steps",
    mix: 0.3,
    steps: [
      S("LITH-ACT"), S("ETCH-ACT", 360), S("MET-CD"), S("DEP-OX"),
      S("CMP-OX"), S("LITH-POLY"), S("ETCH-POLY", 360), S("MET-OVL"),
      S("DEP-NIT"), S("LITH-M1"), S("ETCH-VIA", 360), S("DEP-W", 480),
      S("CMP-W", 480), S("MET-THK"), S("LITH-VIA"), S("ETCH-VIA", 360),
      S("DEP-CU"), S("CMP-CU"), S("LITH-M2"), S("MET-THK"),
    ],
  },
];

export const SPC_SPECS: SpcSpec[] = [
  { param: "CD", label: "Critical dimension", unit: "nm", target: 45, sigma: 0.8 },
  { param: "OVL", label: "Overlay error", unit: "nm", target: 3.2, sigma: 0.6 },
  { param: "THK", label: "Film thickness", unit: "nm", target: 120, sigma: 1.5 },
];

interface BayLayout {
  bay: BayId;
  count: number;
  prefix: string;
  mtbf: number;
  mttr: number;
  pmInterval: number;
  pmDur: number;
}

const BAY_PARAMS: Record<BayId, Omit<BayLayout, "bay" | "count" | "prefix">> = {
  LITHO: { mtbf: 6300, mttr: 900, pmInterval: 5400, pmDur: 420 },
  ETCH: { mtbf: 5600, mttr: 800, pmInterval: 5000, pmDur: 360 },
  DEP: { mtbf: 5250, mttr: 900, pmInterval: 4800, pmDur: 420 },
  CMP: { mtbf: 4900, mttr: 700, pmInterval: 4600, pmDur: 300 },
  METRO: { mtbf: 8400, mttr: 500, pmInterval: 7200, pmDur: 240 },
};

const PITCH = 6.4;
const BAY_GAP = 3.6;
const ROW_Z = 12.5;

/** Row plan: which bays sit in which row of the floor. METRO spans the right end of both rows. */
const TOP_ROW: Array<[BayId, number, string]> = [["LITHO", 5, "LTH"], ["ETCH", 5, "ETC"], ["METRO", 2, "MET"]];
const BOTTOM_ROW: Array<[BayId, number, string]> = [["DEP", 5, "DEP"], ["CMP", 4, "CMP"], ["METRO", 3, "MET"]];

export function buildTools(seed: number): ToolDef[] {
  const tools: ToolDef[] = [];
  const counters: Partial<Record<BayId, number>> = {};
  const place = (plan: Array<[BayId, number, string]>, top: boolean) => {
    const total = plan.reduce((a, [, n]) => a + n, 0) * PITCH + (plan.length - 1) * BAY_GAP;
    let x = -total / 2 + PITCH / 2;
    plan.forEach(([bay, n, prefix], gi) => {
      if (gi > 0) x += BAY_GAP;
      for (let i = 0; i < n; i++) {
        const idx = (counters[bay] = (counters[bay] ?? 0) + 1);
        const id = `${prefix}-${String(idx).padStart(2, "0")}`;
        const p = BAY_PARAMS[bay];
        const jitter = 0.65 + 0.7 * urand(seed, "toolvar", id);
        // One flaky tool per sizeable bay keeps failures interesting without being random noise.
        const flaky = idx === 3 && bay !== "METRO" ? 0.55 : 1;
        tools.push({
          id,
          bay,
          index: idx,
          x: Math.round(x * 100) / 100,
          z: top ? -ROW_Z : ROW_Z,
          loopS: top ? x - LOOP.x0 : LOOP_W + LOOP_D + (LOOP.x1 - x),
          mtbfS: Math.round(p.mtbf * jitter * flaky),
          mttrS: Math.round(p.mttr * (0.8 + 0.4 * urand(seed, "mttrvar", id))),
          pmIntervalS: Math.round(p.pmInterval * (0.9 + 0.2 * urand(seed, "pmvar", id))),
          pmDurS: p.pmDur,
          qualS: 90,
          speed: Math.round((0.94 + 0.12 * urand(seed, "speed", id)) * 100) / 100,
          bias: Math.round((urand(seed, "bias", id) - 0.5) * 0.8 * 100) / 100,
        });
        x += PITCH;
      }
    });
  };
  place(TOP_ROW, true);
  place(BOTTOM_ROW, false);
  return tools;
}

export const STOCKERS: StockerDef[] = [
  { id: "ST-A", x: 50, z: 0, loopS: LOOP_W + LOOP_D / 2 },
  { id: "ST-B", x: -50, z: 0, loopS: 2 * LOOP_W + LOOP_D + LOOP_D / 2 },
];

export function buildConfig(seed: number, overrides: Partial<SimConfig> = {}): SimConfig {
  return {
    seed,
    shiftS: SHIFT_S,
    epochMs: EPOCH_MS,
    bays: BAYS,
    recipes: RECIPES,
    routes: ROUTES,
    tools: buildTools(seed),
    stockers: STOCKERS,
    spc: SPC_SPECS,
    loopLength: LOOP_LENGTH,
    vehicleCount: 14,
    vehicleSpeed: 6,
    vehicleDwellS: 4,
    crewSize: 2,
    wipCap: 66,
    releaseIntervalS: 100,
    hotFraction: 0.12,
    warmLots: 48,
    dueFactor: { normal: 5, hot: 2.4 },
    expediteBudget: 4,
    prestageS: 45,
    waferPerLot: 25,
    failuresEnabled: true,
    excursionsEnabled: true,
    releasesEnabled: true,
    objectives: { shipTarget: 68, hotCtMaxS: 5400 },
    ...overrides,
  };
}

/** Weibull scale that gives the requested mean for a given shape. */
export function weibullScaleForMean(mean: number, shape: number): number {
  return mean / gamma(1 + 1 / shape);
}

export function routeRawS(route: RouteDef, recipes: Record<string, RecipeDef>): number {
  return route.steps.reduce((a, s) => a + recipes[s.recipe].processS, 0);
}
