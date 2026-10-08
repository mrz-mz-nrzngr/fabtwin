import { meta, toolDto } from "@/server/dto";
import { ApiError, handler, json, resolve } from "@/server/http";

export const dynamic = "force-dynamic";

const STATES = ["PRODUCTIVE", "STANDBY", "ENGINEERING", "SCHEDULED_DOWN", "UNSCHEDULED_DOWN"];

export const GET = handler((req) => {
  const url = new URL(req.url);
  const v = resolve(url);
  const state = url.searchParams.get("state");
  const bay = url.searchParams.get("bay");
  if (state && !STATES.includes(state)) throw new ApiError(400, "bad_parameter", `state must be one of ${STATES.join(", ")}`);
  let tools = v.snapshot.tools;
  if (state) tools = tools.filter((t) => t.state === state);
  if (bay) tools = tools.filter((t) => t.bay === bay.toUpperCase());
  return json({ meta: meta(v), tools: tools.map((t) => toolDto(t, v.baseMs)) });
});
