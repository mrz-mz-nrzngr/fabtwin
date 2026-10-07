import { buildTools, LOOP, STOCKERS } from "@/sim/config";
import type { BayId } from "@/sim/types";

/** Pure description of the static scene. The renderer turns these into a handful of instanced meshes. */

export const TRACK_Y = 12;
export const PORT_Y = 3.25;

export interface Part {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: string;
  /** Tool id when clicking this part should select a tool. */
  owner?: string;
}

export const BAY_HUE: Record<BayId, string> = {
  LITHO: "#a08c3c",
  ETCH: "#3f8790",
  DEP: "#5d68b8",
  CMP: "#8a62a0",
  METRO: "#4f9170",
};

export const BAY_FLOOR: Record<BayId, string> = {
  LITHO: "#262313",
  ETCH: "#142428",
  DEP: "#181c2c",
  CMP: "#221a29",
  METRO: "#15241c",
};

export interface SceneLayout {
  boxes: Part[];
  cyls: Part[];
  tools: Array<{ id: string; bay: BayId; x: number; z: number; front: number; portX: number; portZ: number }>;
  stockers: Array<{ id: string; x: number; z: number; faceX: number; portX: number }>;
  bayPads: Array<{ bay: BayId; x: number; z: number; w: number; d: number }>;
  bayCenters: Record<BayId, { x: number; z: number }>;
}

const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, owner?: string): Part => ({ x, y, z, sx, sy, sz, color, owner });

export function buildLayout(): SceneLayout {
  const boxes: Part[] = [];
  const cyls: Part[] = [];
  const toolList: SceneLayout["tools"] = [];
  const defs = buildTools(1);

  for (const t of defs) {
    const f = t.z < 0 ? -1 : 1;
    const hue = BAY_HUE[t.bay];
    const B = (lx: number, ly: number, lf: number, sx: number, sy: number, sf: number, c: string) => boxes.push(box(t.x + lx, ly, t.z + f * lf, sx, sy, sf, c, t.id));
    const C = (lx: number, ly: number, lf: number, r: number, h: number, c: string) => cyls.push(box(t.x + lx, ly, t.z + f * lf, r, h, r, c, t.id));
    B(0, 1.1, 0, 5, 2.2, 6, "#3a4651");
    B(0, 1.25, 3.05, 3.2, 1.3, 0.16, "#12171c");
    B(0, 2.4, 3.55, 2.0, 0.2, 1.9, "#6a7a88");
    B(-2.1, 3.8, -2.4, 0.25, 3.2, 0.25, "#55626d");
    switch (t.bay) {
      case "LITHO":
        B(0, 4.7, -0.5, 3.4, 5, 3.4, hue);
        B(0, 7.5, -0.5, 2.0, 0.8, 2.0, "#cbb75a");
        C(0, 8.7, -0.5, 0.8, 1.6, "#2a323a");
        break;
      case "ETCH":
        B(0, 3.6, -0.3, 4.4, 2.8, 4.8, hue);
        C(-1.2, 5.7, -0.8, 1.1, 1.5, "#c3d6dc");
        C(1.2, 5.7, -0.8, 1.1, 1.5, "#c3d6dc");
        break;
      case "DEP":
        B(0, 3.3, -0.3, 4.2, 2.2, 4.6, hue);
        C(0, 5.6, -0.8, 1.7, 2.6, "#c9cdf0");
        C(1.6, 5.1, 1.2, 0.5, 1.4, "#8b93c9");
        break;
      case "CMP":
        B(0, 2.9, -0.2, 4.7, 1.4, 5.2, hue);
        C(0, 3.85, -0.6, 1.9, 0.5, "#2d363e");
        B(1.2, 4.5, -0.6, 2.2, 0.35, 0.5, "#cbb3d8");
        break;
      case "METRO":
        B(0, 3.2, -0.3, 3.4, 2.0, 3.6, hue);
        C(0, 4.6, -0.4, 0.9, 0.9, "#cfe6da");
        C(0, 5.5, -0.4, 0.4, 1.4, "#8bb8a1");
        break;
    }
    // Hoist branch from the track and the drop to the load port.
    const trackZ = f < 0 ? LOOP.z0 : LOOP.z1;
    const portZ = t.z + f * 3.55;
    boxes.push(box(t.x, TRACK_Y, (trackZ + portZ) / 2, 0.18, 0.18, Math.abs(trackZ - portZ), "#3b5063"));
    boxes.push(box(t.x, (TRACK_Y + PORT_Y + 0.6) / 2, portZ, 0.12, TRACK_Y - PORT_Y - 0.6, 0.12, "#3b5063"));
    toolList.push({ id: t.id, bay: t.bay, x: t.x, z: t.z, front: f, portX: t.x, portZ });
  }

  const stockers: SceneLayout["stockers"] = [];
  for (const s of STOCKERS) {
    const dir = s.x > 0 ? 1 : -1;
    boxes.push(box(s.x, 4.75, 0, 8, 9.5, 12, "#2e3b46"));
    for (let r = 0; r < 5; r++) boxes.push(box(s.x - dir * 4.02, 1.6 + r * 1.65, 0, 0.1, 0.12, 11.2, "#4b6173"));
    boxes.push(box(s.x + dir * 4.2, 6, 0, 0.5, 10, 0.5, "#55626d"));
    const portX = s.x + dir * 4.9;
    boxes.push(box(portX, 3.0, 0, 1.4, 0.2, 1.8, "#6a7a88"));
    boxes.push(box((LOOP.x1 * dir + portX) / 2, TRACK_Y, 0, Math.abs(LOOP.x1 * dir - portX), 0.18, 0.18, "#3b5063"));
    boxes.push(box(portX, (TRACK_Y + PORT_Y + 0.6) / 2, 0, 0.12, TRACK_Y - PORT_Y - 0.6, 0.12, "#3b5063"));
    stockers.push({ id: s.id, x: s.x, z: s.z, faceX: s.x - dir * 4.3, portX });
  }

  // Track rails and columns.
  const rail = "#7fa6c4";
  const w = LOOP.x1 - LOOP.x0;
  const d = LOOP.z1 - LOOP.z0;
  boxes.push(box(0, TRACK_Y + 0.3, LOOP.z0, w, 0.22, 0.4, rail));
  boxes.push(box(0, TRACK_Y + 0.3, LOOP.z1, w, 0.22, 0.4, rail));
  boxes.push(box(LOOP.x0, TRACK_Y + 0.3, 0, 0.4, 0.22, d, rail));
  boxes.push(box(LOOP.x1, TRACK_Y + 0.3, 0, 0.4, 0.22, d, rail));
  for (let x = LOOP.x0; x <= LOOP.x1 + 0.1; x += 28) for (const z of [LOOP.z0, LOOP.z1]) cyls.push(box(x, TRACK_Y / 2, z, 0.22, TRACK_Y, 0.22, "#2f3b45"));
  for (const x of [LOOP.x0, LOOP.x1]) cyls.push(box(x, TRACK_Y / 2, 0, 0.22, TRACK_Y, 0.22, "#2f3b45"));

  const byBay = new Map<BayId, typeof toolList>();
  for (const t of toolList) byBay.set(t.bay, [...(byBay.get(t.bay) ?? []), t]);
  const bayPads: SceneLayout["bayPads"] = [];
  const bayCenters = {} as SceneLayout["bayCenters"];
  for (const [bay, list] of byBay) {
    const rows = new Map<number, number[]>();
    for (const t of list) rows.set(t.z, [...(rows.get(t.z) ?? []), t.x]);
    for (const [z, xs] of rows) {
      const x0 = Math.min(...xs) - 3.4;
      const x1 = Math.max(...xs) + 3.4;
      bayPads.push({ bay, x: (x0 + x1) / 2, z, w: x1 - x0, d: 9.6 });
    }
    bayCenters[bay] = { x: list.reduce((a, t) => a + t.x, 0) / list.length, z: list.reduce((a, t) => a + t.z, 0) / list.length };
  }
  return { boxes, cyls, tools: toolList, stockers, bayPads, bayCenters };
}
