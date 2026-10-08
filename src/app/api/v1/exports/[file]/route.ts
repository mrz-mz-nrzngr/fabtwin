import { historyRows, kpiDto, toCsv } from "@/server/dto";
import { ApiError, handler, intParam, json, resolve, text } from "@/server/http";
import { shiftReport } from "@/server/mes";

export const dynamic = "force-dynamic";

const FILES = ["lot-history.json", "lot-history.csv", "shift-report.json", "shift-report.csv"];

export const GET = handler(async (req, ctx) => {
  const { file } = await ctx.params;
  if (!FILES.includes(file)) throw new ApiError(404, "not_found", `Unknown export ${file}. Available: ${FILES.join(", ")}`);
  const url = new URL(req.url);
  const csv = file.endsWith(".csv");

  if (file.startsWith("lot-history")) {
    const v = resolve(url);
    const lot = url.searchParams.get("lot") ?? undefined;
    const rows = historyRows(v.models, v.baseMs, lot);
    if (lot && !rows.length) throw new ApiError(404, "not_found", `No history for lot ${lot}`);
    if (!csv) return json({ simulated: v.source === "simulation", seed: v.seed, atS: v.t, rows }, { headers: { "Content-Disposition": `attachment; filename="${file}"` } });
    return text(
      toCsv(["lot_id", "route", "hot", "t_s", "timestamp", "kind", "tool_id", "step_index", "text"], rows.map((r) => [r.lotId, r.route, r.hot, r.atS, r.at, r.kind, r.toolId, r.stepIndex, r.text])),
      "text/csv; charset=utf-8",
      file,
    );
  }

  const seed = intParam(url, "seed", 1, 1, 9999);
  const r = shiftReport(seed);
  const k = kpiDto(r.kpi);
  const ap = kpiDto(r.autopilot.kpi);
  if (!csv) {
    return json(
      {
        simulated: true,
        seed,
        grade: r.grade,
        score: r.score,
        kpis: k,
        autopilot: { score: r.autopilot.score, kpis: ap, objectivesMet: r.autopilot.objectivesMet },
        objectives: r.objectives.map((o) => ({ id: o.id, label: o.label, target: o.target, value: o.value, met: o.met })),
        drivers: r.drivers,
        tools: r.tools.map((t) => ({ id: t.id, bay: t.bay, failures: t.failures, unscheduledDownS: Math.round(t.downS), utilization: Math.round(t.util * 1000) / 1000 })),
        queueTimeViolationsByRecipe: r.qtByRecipe,
      },
      { headers: { "Content-Disposition": `attachment; filename="${file}"` } },
    );
  }
  const rows: Array<Array<string | number | boolean | null>> = [["summary", "grade", r.grade, null], ["summary", "score", r.score.total, r.autopilot.score]];
  for (const key of Object.keys(k) as Array<keyof typeof k>) rows.push(["kpi", key, k[key], ap[key]]);
  for (const o of r.objectives) rows.push(["objective", o.label, o.value, o.met ? "met" : "missed"]);
  for (const d of r.drivers) rows.push(["driver", d.title, d.detail, d.tone]);
  for (const t of r.tools) rows.push(["tool", t.id, `${t.failures} failures, ${Math.round(t.downS)} s down`, Math.round(t.util * 1000) / 1000]);
  return text(toCsv(["section", "key", "value", "comparison"], rows), "text/csv; charset=utf-8", file);
});
