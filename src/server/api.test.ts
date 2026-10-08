import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET as lots } from "@/app/api/v1/lots/route";
import { GET as lot } from "@/app/api/v1/lots/[id]/route";
import { GET as wip } from "@/app/api/v1/wip/route";
import { GET as tools } from "@/app/api/v1/tools/route";
import { GET as tool } from "@/app/api/v1/tools/[id]/route";
import { GET as alarms } from "@/app/api/v1/alarms/route";
import { GET as kpis } from "@/app/api/v1/kpis/route";
import { GET as exportFile } from "@/app/api/v1/exports/[file]/route";
import { GET as spec } from "@/app/api/v1/openapi.json/route";
import { openapi } from "./openapi";
import { toCsv } from "./dto";

type Ctx = { params: Promise<Record<string, string>> };
const none: Ctx = { params: Promise.resolve({}) };
const req = (path: string) => new Request(`http://localhost/api/v1${path}`);

const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ $id: "api", components: openapi.components });
const check = (name: string, body: unknown) => {
  const v = ajv.getSchema(`api#/components/schemas/${name}`)!;
  const ok = v(body);
  expect(ok, JSON.stringify(v.errors?.slice(0, 3))).toBe(true);
};

describe("MES API", () => {
  it("lists lots and matches the OpenAPI schema", async () => {
    const r = await lots(req("/lots?seed=2&t=3600"), none);
    expect(r.status).toBe(200);
    const body = await r.json();
    check("LotList", body);
    expect(body.meta.simulated).toBe(true);
    expect(body.total).toBeGreaterThan(20);
    expect(body.lots.length).toBeLessThanOrEqual(100);
  });

  it("filters and paginates lots", async () => {
    const hot = await (await lots(req("/lots?seed=2&t=3600&hot=true&limit=3"), none)).json();
    expect(hot.lots.length).toBeLessThanOrEqual(3);
    expect(hot.lots.every((l: { hot: boolean }) => l.hot)).toBe(true);
    const page2 = await (await lots(req("/lots?seed=2&t=3600&limit=5&offset=5"), none)).json();
    const page1 = await (await lots(req("/lots?seed=2&t=3600&limit=5"), none)).json();
    expect(page2.lots[0].id).not.toBe(page1.lots[0].id);
  });

  it("returns one lot with its genealogy, and 404 for an unknown one", async () => {
    const list = await (await lots(req("/lots?seed=2&t=3600&limit=1"), none)).json();
    const id = list.lots[0].id as string;
    const r = await lot(req(`/lots/${id}?seed=2&t=3600`), { params: Promise.resolve({ id }) });
    expect(r.status).toBe(200);
    const body = await r.json();
    check("LotDetail", body);
    expect(body.history.length).toBeGreaterThan(0);
    const miss = await lot(req("/lots/NOPE?seed=2&t=3600"), { params: Promise.resolve({ id: "NOPE" }) });
    expect(miss.status).toBe(404);
    check("Error", await miss.json());
  });

  it("serves WIP by step, tools, one tool, alarms and KPIs", async () => {
    const w = await (await wip(req("/wip?seed=3&t=5400"), none)).json();
    check("Wip", w);
    expect(w.byStep.reduce((a: number, r: { total: number }) => a + r.total, 0)).toBe(w.totalLots);
    const t = await (await tools(req("/tools?seed=3&t=5400"), none)).json();
    check("ToolList", t);
    expect(t.tools).toHaveLength(24);
    const down = await (await tools(req("/tools?seed=3&t=5400&state=STANDBY"), none)).json();
    expect(down.tools.every((x: { state: string }) => x.state === "STANDBY")).toBe(true);
    const one = await tool(req("/tools/lth-01?seed=3&t=5400"), { params: Promise.resolve({ id: "lth-01" }) });
    check("ToolDetail", await one.json());
    const a = await (await alarms(req("/alarms?seed=3&t=5400&limit=10"), none)).json();
    check("AlarmList", a);
    const k = await (await kpis(req("/kpis?seed=3&t=5400"), none)).json();
    check("Kpis", k);
    expect(k.transport.cells).toBeGreaterThan(50);
  });

  it("is deterministic: the same query gives the same bytes", async () => {
    const a = await (await kpis(req("/kpis?seed=4&t=4000"), none)).text();
    const b = await (await kpis(req("/kpis?seed=4&t=4000"), none)).text();
    expect(a.replace(/"at":"[^"]+"/, "")).toBe(b.replace(/"at":"[^"]+"/, ""));
  });

  it("rejects bad parameters with a JSON error", async () => {
    for (const q of ["?seed=0", "?t=999999", "?seed=abc", "?source=nowhere"]) {
      const r = await kpis(req(`/kpis${q}`), none);
      expect(r.status, q).toBe(400);
      check("Error", await r.json());
    }
    const r = await lots(req("/lots?status=flying"), none);
    expect(r.status).toBe(400);
  });

  it("answers 503 for source=live when no feed is configured", async () => {
    delete process.env.FABTWIN_LIVE_URLS;
    const r = await kpis(req("/kpis?source=live"), none);
    expect(r.status).toBe(503);
  });

  it("exports lot history as JSON and RFC 4180 CSV", async () => {
    const j = await (await exportFile(req("/exports/lot-history.json?seed=2&t=3600"), { params: Promise.resolve({ file: "lot-history.json" }) })).json();
    expect(j.rows.length).toBeGreaterThan(50);
    const c = await exportFile(req("/exports/lot-history.csv?seed=2&t=3600"), { params: Promise.resolve({ file: "lot-history.csv" }) });
    expect(c.headers.get("content-type")).toContain("text/csv");
    const csv = await c.text();
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("lot_id,route,hot,t_s,timestamp,kind,tool_id,step_index,text");
    expect(lines.length).toBe(j.rows.length + 1);
    const one = await exportFile(req("/exports/lot-history.csv?seed=2&t=3600&lot=L0001"), { params: Promise.resolve({ file: "lot-history.csv" }) });
    expect((await one.text()).split("\r\n").slice(1).filter(Boolean).every((l) => l.startsWith("L0001,"))).toBe(true);
  });

  it("exports the shift report as JSON and CSV", async () => {
    const j = await (await exportFile(req("/exports/shift-report.json?seed=1"), { params: Promise.resolve({ file: "shift-report.json" }) })).json();
    expect(["S", "A", "B", "C", "D"]).toContain(j.grade);
    expect(j.autopilot.score).toBeTypeOf("number");
    const c = await (await exportFile(req("/exports/shift-report.csv?seed=1"), { params: Promise.resolve({ file: "shift-report.csv" }) })).text();
    expect(c.startsWith("section,key,value,comparison\r\n")).toBe(true);
    expect(c).toContain("kpi,shipped,");
    const bad = await exportFile(req("/exports/nope.csv"), { params: Promise.resolve({ file: "nope.csv" }) });
    expect(bad.status).toBe(404);
  });

  it("quotes CSV fields that need it", () => {
    expect(toCsv(["a", "b"], [['x,"y"', "line\nbreak"]])).toBe('a,b\r\n"x,""y""","line\nbreak"\r\n');
  });

  it("serves an OpenAPI document identical to docs/openapi.json", async () => {
    const served = await spec().json();
    expect(served.openapi).toBe("3.1.0");
    const file = JSON.parse(readFileSync("docs/openapi.json", "utf8"));
    expect(file).toEqual(JSON.parse(JSON.stringify(openapi)));
  });
});
