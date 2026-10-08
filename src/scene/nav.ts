/** Keyboard navigation over the tools of the 3D floor. Pure, so it is tested without a canvas. */

export interface NavTool {
  id: string;
  x: number;
  z: number;
}

export type Dir = "left" | "right" | "up" | "down";

const VEC: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/**
 * Next tool when an arrow key is pressed: the tool closest in the pressed direction, with sideways drift
 * counted double so "right" follows the row instead of jumping to the other one. Nothing selected yet:
 * start from the tool nearest the middle of the floor. At the edge of the floor the selection stays put.
 * "up" means away from the viewer (negative z), matching the default camera.
 */
export function nextTool(tools: NavTool[], current: string | null, dir: Dir): string | null {
  if (!tools.length) return null;
  const from = tools.find((t) => t.id === current);
  if (!from) {
    return [...tools].sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z) || (a.id < b.id ? -1 : 1))[0].id;
  }
  const [dx, dz] = VEC[dir];
  let best: NavTool | null = null;
  let bestScore = Infinity;
  for (const t of tools) {
    if (t.id === from.id) continue;
    const vx = t.x - from.x;
    const vz = t.z - from.z;
    const along = vx * dx + vz * dz;
    if (along <= 0.5) continue;
    const across = Math.abs(vx * dz) + Math.abs(vz * dx);
    const score = along + across * 2;
    if (score < bestScore || (score === bestScore && best && t.id < best.id)) {
      bestScore = score;
      best = t;
    }
  }
  return best ? best.id : from.id;
}

/** Cycle through the tools in reading order (rows front to back, left to right). */
export function cycleTool(tools: NavTool[], current: string | null, step: 1 | -1): string | null {
  if (!tools.length) return null;
  const order = [...tools].sort((a, b) => a.z - b.z || a.x - b.x);
  const i = order.findIndex((t) => t.id === current);
  if (i < 0) return order[step === 1 ? 0 : order.length - 1].id;
  return order[(i + step + order.length) % order.length].id;
}
