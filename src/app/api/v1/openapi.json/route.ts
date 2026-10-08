import { openapi } from "@/server/openapi";
import { json } from "@/server/http";

export const dynamic = "force-static";

export function GET() {
  return json(openapi);
}
