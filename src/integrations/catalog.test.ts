import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INTEGRATIONS, TIER_LABEL } from "./catalog";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

describe("integrations catalog", () => {
  it("names only npm scripts that exist", () => {
    for (const i of INTEGRATIONS) for (const s of i.scripts) expect(pkg.scripts[s], `${i.id}: ${s}`).toBeTruthy();
  });

  it("gives every integration a tier, a scope statement and setup steps", () => {
    for (const i of INTEGRATIONS) {
      expect(Object.keys(TIER_LABEL)).toContain(i.tier);
      expect(i.scope.length).toBeGreaterThan(20);
      expect(i.steps.length).toBeGreaterThan(0);
    }
  });

  it("backs every claimed tier with a proof pointer, and keeps unproven ones honest", () => {
    for (const i of INTEGRATIONS) {
      if (i.tier === "not-proven") expect(i.proof).toBeUndefined();
      else expect(i.proof, i.id).toBeTruthy();
    }
  });

  it("proof sections exist in docs/integration-runs.md", () => {
    const doc = readFileSync("docs/integration-runs.md", "utf8");
    for (const i of INTEGRATIONS) {
      const m = i.proof?.match(/section (.+)$/);
      if (m) expect(doc, i.id).toContain(`## ${m[1]}`);
    }
  });

  it("links inside the app are absolute paths and the text has no em dashes", () => {
    for (const i of INTEGRATIONS) {
      for (const l of i.links ?? []) expect(l.href.startsWith("/")).toBe(true);
      const text = [i.name, i.summary, i.scope, ...i.steps.map((s) => s.text)].join(" ");
      expect(text).not.toContain("—");
    }
  });
});
