import { alarmDto, meta, toolDto } from "@/server/dto";
import { ApiError, handler, json, resolve } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx) => {
  const { id } = await ctx.params;
  const v = resolve(new URL(req.url));
  const tool = v.snapshot.tools.find((t) => t.id === id.toUpperCase());
  if (!tool) throw new ApiError(404, "not_found", `No tool ${id}`);
  const alarms = v.models.alarms.filter((a) => a.toolId === tool.id).slice(-20).reverse();
  return json({ meta: meta(v), tool: toolDto(tool, v.baseMs), recentAlarms: alarms.map((a) => alarmDto(a, v.baseMs)) });
});
