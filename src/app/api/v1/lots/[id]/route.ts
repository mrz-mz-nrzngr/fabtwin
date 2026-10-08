import { historyRows, lotDto, meta } from "@/server/dto";
import { ApiError, handler, json, resolve } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx) => {
  const { id } = await ctx.params;
  const v = resolve(new URL(req.url));
  const lot = v.snapshot.lots.find((l) => l.id === id);
  const history = historyRows(v.models, v.baseMs, id);
  const idx = v.models.lotIndex[id];
  if (!lot && !history.length) throw new ApiError(404, "not_found", `No lot ${id} at this time`);
  return json({ meta: meta(v), lot: lot ? lotDto(lot, v.baseMs) : null, shippedAt: idx?.shippedAt === undefined ? null : new Date(v.baseMs + Math.round(idx.shippedAt * 1000)).toISOString(), history });
});
