/**
 * Runs the autopilot shift (default rules, no interventions) for a few seeds and prints
 * the numbers used to set the shift objectives. Run with `npm run calibrate`.
 */
import { buildConfig } from "../src/sim/config";
import { FabEngine } from "../src/sim/engine";

const seeds = process.argv.slice(2).map(Number);
if (!seeds.length) seeds.push(1, 2, 3, 4, 5, 6);
const fmt = (x: number | null, d = 1) => (x === null ? "-" : x.toFixed(d));

for (const seed of seeds) {
  const t0 = performance.now();
  const e = new FabEngine(buildConfig(seed));
  let events = 0;
  for (let t = 0; t <= e.cfg.shiftS; t += 100) {
    e.advanceTo(t);
    events += e.drainEvents().length;
  }
  const s = e.snapshot();
  const k = s.kpi;
  const bayUtil = s.bays.map((b) => `${b.id}:${Math.round(b.util * 100)}`).join(" ");
  const downs = s.tools.filter((t) => t.stateTime.UNSCHEDULED_DOWN > 0).length;
  console.log(
    `seed ${seed}: shipped ${k.shipped} (hot ${k.shippedHot}) wip ${k.wip} ct ${fmt(k.avgCtS! / 60)}m hotCT ${fmt(k.avgHotCtS === null ? null : k.avgHotCtS / 60)}m ` +
      `xf ${fmt(k.xFactor)} otd ${fmt(k.otd === null ? null : k.otd * 100, 0)}% qt ${k.qtViolations} ooc ${k.oocEscapes} downtools ${downs} ` +
      `util[${bayUtil}] score ${s.score} events ${events} ${(performance.now() - t0).toFixed(0)}ms`,
  );
}
