import { facePanelX, isoBox, proj } from "./iso";

interface Props {
  size?: number;
  /** Tint of the pod shell. Hot lots use the accent. */
  shell?: string;
  title?: string;
}

/** Isometric 300 mm FOUP: shell, front-opening door with latch slots, robotic flange on top. */
export function Foup({ size = 96, shell = "#cfd8df", title }: Props) {
  const s = 3.1;
  const ox = 50;
  const oy = 44;
  const body = isoBox(0, 0, 0, 14, 12, 15, s, ox, oy);
  const flange = isoBox(4.5, 3.5, 15, 5, 5, 1.6, s, ox, oy);
  const stem = isoBox(5.8, 4.8, 16.6, 2.4, 2.4, 1.4, s, ox, oy);
  const door = facePanelX(14, 0, 0, 12, 15, 0.1, 0.1, 0.9, 0.82, s, ox, oy);
  const latchA = facePanelX(14, 0, 0, 12, 15, 0.22, 0.58, 0.34, 0.66, s, ox, oy);
  const latchB = facePanelX(14, 0, 0, 12, 15, 0.66, 0.58, 0.78, 0.66, s, ox, oy);
  const slots = [0.2, 0.28, 0.36, 0.44].map((v) => {
    const a = proj(14, 12 * 0.18, 15 * (0.1 + v * 0.5), s, ox, oy);
    const b = proj(14, 12 * 0.82, 15 * (0.1 + v * 0.5), s, ox, oy);
    return `${a[0]},${a[1]} ${b[0]},${b[1]}`;
  });
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <polygon points={body.left} fill={shell} opacity="0.78" />
      <polygon points={body.right} fill={shell} opacity="0.55" />
      <polygon points={body.top} fill={shell} />
      <polygon points={door} fill="#1a2128" opacity="0.88" />
      {slots.map((l, i) => (
        <polyline key={i} points={l} stroke="#4c5b68" strokeWidth="0.8" fill="none" />
      ))}
      <polygon points={latchA} fill="#7fa6c4" />
      <polygon points={latchB} fill="#7fa6c4" />
      <polygon points={flange.left} fill="#8a9aa7" />
      <polygon points={flange.right} fill="#6b7a87" />
      <polygon points={flange.top} fill="#b4c2cd" />
      <polygon points={stem.left} fill="#8a9aa7" />
      <polygon points={stem.right} fill="#6b7a87" />
      <polygon points={stem.top} fill="#b4c2cd" />
    </svg>
  );
}
