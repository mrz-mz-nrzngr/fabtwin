import { facePanelX, isoBox, proj } from "./iso";

interface Props {
  size?: number;
  kind?: "litho" | "etch" | "dep" | "cmp" | "metro";
  /** Colour of the signal lamp on the tool's light tower. */
  lamp?: string;
  title?: string;
}

/** Isometric process tool drawn from the same boxes the 3D scene uses. */
export function ToolIso({ size = 120, kind = "etch", lamp = "#3ecf8e", title }: Props) {
  const s = 2.6;
  const ox = 60;
  const oy = 56;
  const base = isoBox(0, 0, 0, 22, 18, 9, s, ox, oy);
  const head = {
    litho: isoBox(3, 2, 9, 9, 9, 16, s, ox, oy),
    etch: isoBox(2, 2, 9, 16, 14, 7, s, ox, oy),
    dep: isoBox(3, 3, 9, 14, 12, 6, s, ox, oy),
    cmp: isoBox(1, 1, 9, 20, 16, 3, s, ox, oy),
    metro: isoBox(4, 3, 9, 10, 10, 6, s, ox, oy),
  }[kind];
  const tower = isoBox(18.5, 14.5, 9, 2, 2, 8, s, ox, oy);
  const lampPos = proj(19.5, 15.5, 18.4, s, ox, oy);
  const panel = facePanelX(22, 0, 0, 18, 9, 0.1, 0.2, 0.9, 0.8, s, ox, oy);
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <polygon points={base.left} fill="#46535f" />
      <polygon points={base.right} fill="#35414b" />
      <polygon points={base.top} fill="#5b6a77" />
      <polygon points={panel} fill="#1a2128" opacity="0.75" />
      <polygon points={head.left} fill="#7e8d99" />
      <polygon points={head.right} fill="#5f6d79" />
      <polygon points={head.top} fill="#a5b3be" />
      {kind === "dep" && <ellipse cx={proj(10, 9, 15, s, ox, oy)[0]} cy={proj(10, 9, 15, s, ox, oy)[1]} rx="9" ry="4.6" fill="#7fa6c4" opacity="0.85" />}
      {kind === "cmp" && <ellipse cx={proj(11, 9, 12, s, ox, oy)[0]} cy={proj(11, 9, 12, s, ox, oy)[1]} rx="14" ry="7" fill="#2a3540" />}
      <polygon points={tower.left} fill="#46535f" />
      <polygon points={tower.right} fill="#35414b" />
      <polygon points={tower.top} fill="#5b6a77" />
      <circle cx={lampPos[0]} cy={lampPos[1]} r="3.4" fill={lamp} />
    </svg>
  );
}
