import { kpiDto, meta } from "@/server/dto";
import { handler, json, resolve } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler((req) => {
  const v = resolve(new URL(req.url));
  const s = v.snapshot;
  return json({
    meta: meta(v),
    kpis: kpiDto(s.kpi),
    objectives: s.objectives.map((o) => ({ id: o.id, label: o.label, target: o.target, value: o.value, met: o.met, failed: o.failed })),
    score: v.source === "simulation" ? s.score : null,
    transport: { cells: s.oht.cells, vehicleWaitS: Math.round(s.oht.waitS), blockedNow: s.oht.blockedNow, ordersQueued: s.oht.jobsQueued },
  });
});
