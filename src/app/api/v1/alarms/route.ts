import { alarmDto, meta } from "@/server/dto";
import { ApiError, handler, intParam, json, resolve } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler((req) => {
  const url = new URL(req.url);
  const v = resolve(url);
  const active = url.searchParams.get("active");
  const severity = url.searchParams.get("severity");
  const toolId = url.searchParams.get("tool");
  if (severity && !["info", "warning", "critical"].includes(severity)) throw new ApiError(400, "bad_parameter", "severity must be info, warning or critical");
  const limit = intParam(url, "limit", 100, 1, 500);
  let list = [...v.models.alarms].reverse();
  if (active !== null) list = list.filter((a) => (a.clearedT === null) === (active === "true"));
  if (severity) list = list.filter((a) => a.severity === severity);
  if (toolId) list = list.filter((a) => a.toolId === toolId.toUpperCase());
  return json({ meta: meta(v), total: list.length, alarms: list.slice(0, limit).map((a) => alarmDto(a, v.baseMs)) });
});
