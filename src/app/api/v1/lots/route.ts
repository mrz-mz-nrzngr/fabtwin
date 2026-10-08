import { lotDto, meta } from "@/server/dto";
import { ApiError, handler, intParam, json, resolve } from "@/server/http";

export const dynamic = "force-dynamic";

const STATUS = ["waiting", "transit", "atTool", "processing"];

export const GET = handler((req) => {
  const url = new URL(req.url);
  const v = resolve(url);
  const status = url.searchParams.get("status");
  const bay = url.searchParams.get("bay");
  const hot = url.searchParams.get("hot");
  const held = url.searchParams.get("held");
  const q = url.searchParams.get("q")?.toLowerCase();
  if (status && !STATUS.includes(status)) throw new ApiError(400, "bad_parameter", `status must be one of ${STATUS.join(", ")}`);
  const limit = intParam(url, "limit", 100, 1, 500);
  const offset = intParam(url, "offset", 0, 0, 100000);
  let lots = v.snapshot.lots;
  if (status) lots = lots.filter((l) => l.status === status);
  if (bay) lots = lots.filter((l) => l.bay === bay.toUpperCase());
  if (hot !== null) lots = lots.filter((l) => l.hot === (hot === "true"));
  if (held !== null) lots = lots.filter((l) => l.held === (held === "true"));
  if (q) lots = lots.filter((l) => l.id.toLowerCase().includes(q) || l.route.toLowerCase().includes(q) || l.recipe.toLowerCase().includes(q) || (l.toolId ?? "").toLowerCase().includes(q));
  const sorted = [...lots].sort((a, b) => (a.id < b.id ? -1 : 1));
  return json({ meta: meta(v), total: sorted.length, limit, offset, lots: sorted.slice(offset, offset + limit).map((l) => lotDto(l, v.baseMs)) });
});
