/**
 * OpenAPI 3.1 description of the MES API. A test checks every endpoint's response against these schemas
 * and checks that docs/openapi.json is this object, so the description cannot drift from the code.
 */
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const str = { type: "string" } as const;
const nstr = { type: ["string", "null"] } as const;
const num = { type: "number" } as const;
const nnum = { type: ["number", "null"] } as const;
const int = { type: "integer" } as const;
const bool = { type: "boolean" } as const;
const iso = { type: "string", format: "date-time" } as const;

const obj = (properties: Record<string, unknown>, required?: string[]) => ({ type: "object", properties, required: required ?? Object.keys(properties), additionalProperties: false });

const seedP = { name: "seed", in: "query", description: "Simulation seed. The same seed and t always give the same answer.", schema: { type: "integer", minimum: 1, maximum: 9999, default: 1 } };
const tP = { name: "t", in: "query", description: "Simulated seconds into the 4 hour shift.", schema: { type: "integer", minimum: 0, maximum: 14400, default: 7200 } };
const sourceP = { name: "source", in: "query", description: "simulation (default) or live. live needs FABTWIN_LIVE_URLS on a self-hosted server.", schema: { type: "string", enum: ["simulation", "live"], default: "simulation" } };
const common = [sourceP, seedP, tP];

const ok = (schema: unknown, description: string) => ({ description, content: { "application/json": { schema } } });
const errors = {
  "400": { description: "A parameter is invalid", content: { "application/json": { schema: ref("Error") } } },
  "503": { description: "The live source is not configured", content: { "application/json": { schema: ref("Error") } } },
};

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "FabTwin MES API",
    version: "1.0.0",
    description:
      "Read-only REST API over FabTwin's fab model: lots, WIP by step, tool states, alarms and KPIs, plus CSV and JSON exports. By default it serves the deterministic simulation as a function of seed and t, and every response says so in meta.simulated. With FABTWIN_LIVE_URLS set on a self-hosted server, source=live serves the state derived from a live FabTwin event feed.",
    license: { name: "MIT", identifier: "MIT" },
  },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/lots": {
      get: {
        operationId: "listLots",
        summary: "Lots in the fab",
        parameters: [
          ...common,
          { name: "status", in: "query", schema: { type: "string", enum: ["waiting", "transit", "atTool", "processing"] } },
          { name: "bay", in: "query", schema: { type: "string", enum: ["LITHO", "ETCH", "DEP", "CMP", "METRO"] } },
          { name: "hot", in: "query", schema: bool },
          { name: "held", in: "query", schema: bool },
          { name: "q", in: "query", description: "Matches lot id, route, recipe or tool id.", schema: str },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": ok(ref("LotList"), "Lots, sorted by id"), ...errors },
      },
    },
    "/lots/{id}": {
      get: {
        operationId: "getLot",
        summary: "One lot with its genealogy",
        parameters: [{ name: "id", in: "path", required: true, schema: str }, ...common],
        responses: { "200": ok(ref("LotDetail"), "The lot and its history"), "404": { description: "No such lot", content: { "application/json": { schema: ref("Error") } } }, ...errors },
      },
    },
    "/wip": { get: { operationId: "getWip", summary: "WIP by process step and by bay", parameters: common, responses: { "200": ok(ref("Wip"), "WIP"), ...errors } } },
    "/tools": {
      get: {
        operationId: "listTools",
        summary: "Tool states (SEMI E10 states)",
        parameters: [...common, { name: "state", in: "query", schema: ref("E10State") }, { name: "bay", in: "query", schema: { type: "string", enum: ["LITHO", "ETCH", "DEP", "CMP", "METRO"] } }],
        responses: { "200": ok(ref("ToolList"), "Tools"), ...errors },
      },
    },
    "/tools/{id}": {
      get: {
        operationId: "getTool",
        summary: "One tool with its recent alarms",
        parameters: [{ name: "id", in: "path", required: true, schema: str }, ...common],
        responses: { "200": ok(ref("ToolDetail"), "The tool"), "404": { description: "No such tool", content: { "application/json": { schema: ref("Error") } } }, ...errors },
      },
    },
    "/alarms": {
      get: {
        operationId: "listAlarms",
        summary: "Alarm log, newest first",
        parameters: [
          ...common,
          { name: "active", in: "query", schema: bool },
          { name: "severity", in: "query", schema: { type: "string", enum: ["info", "warning", "critical"] } },
          { name: "tool", in: "query", schema: str },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
        ],
        responses: { "200": ok(ref("AlarmList"), "Alarms"), ...errors },
      },
    },
    "/kpis": { get: { operationId: "getKpis", summary: "KPIs, shift objectives and transport", parameters: common, responses: { "200": ok(ref("Kpis"), "KPIs"), ...errors } } },
    "/exports/{file}": {
      get: {
        operationId: "export",
        summary: "CSV and JSON exports",
        description: "lot-history.(csv|json): every genealogy entry of every lot up to t, or one lot with ?lot=. shift-report.(csv|json): the full shift report for a seed, with the autopilot comparison.",
        parameters: [{ name: "file", in: "path", required: true, schema: { type: "string", enum: ["lot-history.csv", "lot-history.json", "shift-report.csv", "shift-report.json"] } }, { name: "lot", in: "query", description: "lot-history only", schema: str }, ...common],
        responses: {
          "200": { description: "The export", content: { "text/csv": { schema: str }, "application/json": { schema: { type: "object" } } } },
          "404": { description: "Unknown export or lot", content: { "application/json": { schema: ref("Error") } } },
          ...errors,
        },
      },
    },
  },
  components: {
    schemas: {
      Error: obj({ error: obj({ code: str, message: str }) }),
      E10State: { type: "string", enum: ["PRODUCTIVE", "STANDBY", "ENGINEERING", "SCHEDULED_DOWN", "UNSCHEDULED_DOWN"] },
      Meta: obj({ source: { type: "string", enum: ["simulation", "live"] }, simulated: bool, seed: { type: ["integer", "null"] }, atS: num, at: iso, shiftS: num }),
      Lot: obj({
        id: str,
        route: str,
        hot: bool,
        expedited: bool,
        held: bool,
        holdReason: { type: ["string", "null"], enum: ["operator", "spc", null] },
        step: int,
        steps: int,
        recipe: str,
        bay: str,
        status: { type: "string", enum: ["waiting", "transit", "atTool", "processing", "done"] },
        location: obj({ kind: { type: "string", enum: ["stocker", "tool", "vehicle", "gone"] }, id: nstr }),
        toolId: nstr,
        releasedAt: iso,
        due: iso,
        queueTimeLeftS: nnum,
        queueTimeViolations: int,
        excursionFlag: bool,
      }),
      LotList: obj({ meta: ref("Meta"), total: int, limit: int, offset: int, lots: { type: "array", items: ref("Lot") } }),
      HistoryRow: obj({ lotId: str, route: nstr, hot: { type: ["boolean", "null"] }, atS: num, at: iso, kind: str, toolId: nstr, stepIndex: { type: ["integer", "null"] }, text: str }),
      LotDetail: obj({ meta: ref("Meta"), lot: { oneOf: [ref("Lot"), { type: "null" }] }, shippedAt: { type: ["string", "null"] }, history: { type: "array", items: ref("HistoryRow") } }),
      Tool: obj({
        id: str,
        bay: str,
        state: ref("E10State"),
        reason: str,
        since: iso,
        lotId: nstr,
        recipe: nstr,
        utilization: num,
        lotsDone: int,
        degradationWarning: bool,
        pmDueInS: num,
        stateSeconds: obj(Object.fromEntries(["PRODUCTIVE", "STANDBY", "ENGINEERING", "SCHEDULED_DOWN", "UNSCHEDULED_DOWN"].map((k) => [k, num]))),
      }),
      ToolList: obj({ meta: ref("Meta"), tools: { type: "array", items: ref("Tool") } }),
      Alarm: obj({ id: str, code: str, severity: { type: "string", enum: ["info", "warning", "critical"] }, text: str, toolId: nstr, lotId: nstr, setAt: iso, clearedAt: { type: ["string", "null"] }, active: bool }),
      ToolDetail: obj({ meta: ref("Meta"), tool: ref("Tool"), recentAlarms: { type: "array", items: ref("Alarm") } }),
      AlarmList: obj({ meta: ref("Meta"), total: int, alarms: { type: "array", items: ref("Alarm") } }),
      Wip: obj({
        meta: ref("Meta"),
        totalLots: int,
        byBay: { type: "array", items: obj({ bay: str, lots: int }) },
        byStep: { type: "array", items: obj({ recipe: str, bay: str, waiting: int, inTransit: int, inTool: int, held: int, total: int }) },
      }),
      Kpis: obj({
        meta: ref("Meta"),
        kpis: obj({
          shipped: int,
          shippedHot: int,
          wip: int,
          throughputPerHour: num,
          meanCycleTimeS: nnum,
          meanHotCycleTimeS: nnum,
          xFactor: nnum,
          onTimeDelivery: nnum,
          queueTimeViolations: int,
          qualityEscapes: int,
          meanToolUtilization: num,
          unscheduledDowntimeS: num,
        }),
        objectives: { type: "array", items: obj({ id: str, label: str, target: num, value: nnum, met: bool, failed: bool }) },
        score: nnum,
        transport: obj({ cells: int, vehicleWaitS: num, blockedNow: int, ordersQueued: int }),
      }),
    },
  },
} as const;
