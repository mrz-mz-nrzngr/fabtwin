import { describe, expect, it } from "vitest";
import { buildLayout } from "./layout3d";
import { cycleTool, nextTool } from "./nav";

const tools = buildLayout().tools;

describe("keyboard navigation of the floor", () => {
  it("starts from the tool nearest the middle", () => {
    const id = nextTool(tools, null, "right")!;
    const t = tools.find((x) => x.id === id)!;
    expect(Math.hypot(t.x, t.z)).toBeLessThan(14);
  });

  it("moves along the row on left and right and across rows on up and down", () => {
    const start = tools.find((t) => t.id === "LTH-02")!;
    const right = tools.find((t) => t.id === nextTool(tools, "LTH-02", "right"))!;
    expect(right.z).toBe(start.z);
    expect(right.x).toBeGreaterThan(start.x);
    const left = tools.find((t) => t.id === nextTool(tools, "LTH-02", "left"))!;
    expect(left.x).toBeLessThan(start.x);
    const back = tools.find((t) => t.id === nextTool(tools, "DEP-02", "up"))!;
    expect(back.z).toBeLessThan(0);
    const front = tools.find((t) => t.id === nextTool(tools, "LTH-02", "down"))!;
    expect(front.z).toBeGreaterThan(0);
  });

  it("stays on the tool at the edge of the floor", () => {
    const first = [...tools].sort((a, b) => a.x - b.x)[0];
    expect(nextTool(tools, first.id, "left")).toBe(first.id);
  });

  it("can reach every tool with arrow keys alone", () => {
    const seen = new Set<string>();
    const dirs = ["right", "down", "left", "up"] as const;
    // A breadth-first walk over the four arrow keys from the starting tool.
    const queue = [nextTool(tools, null, "right")!];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const d of dirs) queue.push(nextTool(tools, id, d)!);
    }
    expect(seen.size).toBe(tools.length);
  });

  it("cycles through all tools in reading order and wraps", () => {
    let id: string | null = null;
    const seen: string[] = [];
    for (let i = 0; i < tools.length; i++) {
      id = cycleTool(tools, id, 1);
      seen.push(id!);
    }
    expect(new Set(seen).size).toBe(tools.length);
    expect(cycleTool(tools, id, 1)).toBe(seen[0]);
    expect(cycleTool(tools, seen[0], -1)).toBe(seen[seen.length - 1]);
  });
});
