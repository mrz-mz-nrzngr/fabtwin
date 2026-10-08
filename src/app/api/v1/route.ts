import { json } from "@/server/http";

export const dynamic = "force-static";

export function GET() {
  return json({
    name: "FabTwin MES API",
    version: "1.0.0",
    openapi: "/api/v1/openapi.json",
    endpoints: ["/api/v1/lots", "/api/v1/lots/{id}", "/api/v1/wip", "/api/v1/tools", "/api/v1/tools/{id}", "/api/v1/alarms", "/api/v1/kpis", "/api/v1/exports/{lot-history|shift-report}.{csv|json}"],
    note: "Serves the deterministic simulation by seed and t. Responses carry meta.simulated.",
  });
}
