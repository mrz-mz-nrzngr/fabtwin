import { meta, wipDto } from "@/server/dto";
import { handler, json, resolve } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler((req) => {
  const v = resolve(new URL(req.url));
  return json({ meta: meta(v), ...wipDto(v.snapshot.wip, v.snapshot.lots) });
});
