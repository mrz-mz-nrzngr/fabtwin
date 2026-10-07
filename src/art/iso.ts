/** Tiny isometric helper (2:1 dimetric). Units are arbitrary, scale s maps them to SVG pixels. */
export type P = [number, number];

export function proj(x: number, y: number, z: number, s = 1, ox = 0, oy = 0): P {
  return [ox + (x - y) * s, oy + (x + y) * 0.5 * s - z * s];
}

const pts = (ps: P[]) => ps.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");

export interface BoxFaces {
  top: string;
  left: string;
  right: string;
}

/** Polygon point strings for the three visible faces of an axis-aligned box. */
export function isoBox(x: number, y: number, z: number, w: number, d: number, h: number, s = 1, ox = 0, oy = 0): BoxFaces {
  const p = (a: number, b: number, c: number) => proj(a, b, c, s, ox, oy);
  return {
    top: pts([p(x, y, z + h), p(x + w, y, z + h), p(x + w, y + d, z + h), p(x, y + d, z + h)]),
    // the face toward +y, seen on the left
    left: pts([p(x, y + d, z + h), p(x + w, y + d, z + h), p(x + w, y + d, z), p(x, y + d, z)]),
    // the face toward +x, seen on the right
    right: pts([p(x + w, y, z + h), p(x + w, y + d, z + h), p(x + w, y + d, z), p(x + w, y, z)]),
  };
}

/** A quad lying on the +x face of a box, for doors and panels. u,v are 0..1 across (y) and up (z). */
export function facePanelX(x: number, y: number, z: number, d: number, h: number, u0: number, v0: number, u1: number, v1: number, s = 1, ox = 0, oy = 0): string {
  const p = (yy: number, zz: number) => proj(x, yy, zz, s, ox, oy);
  return pts([p(y + d * u0, z + h * v1), p(y + d * u1, z + h * v1), p(y + d * u1, z + h * v0), p(y + d * u0, z + h * v0)]);
}
