interface Props {
  size?: number;
  title?: string;
}

/** A 300 mm wafer lying flat in isometric view: flat notch, die grid, a lit edge. */
export function Wafer({ size = 96, title }: Props) {
  const cx = 50;
  const cy = 50;
  const rx = 40;
  const ry = 21;
  const dies: Array<[number, number]> = [];
  for (let gx = -6; gx <= 6; gx++) {
    for (let gy = -6; gy <= 6; gy++) {
      const x = gx * 5.6;
      const y = gy * 3.1;
      if ((x / (rx - 4)) ** 2 + (y / (ry - 2)) ** 2 < 0.96) dies.push([cx + x, cy + y]);
    }
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <ellipse cx={cx} cy={cy + 3.4} rx={rx} ry={ry} fill="#2a3540" />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#9fb2c1" />
      <ellipse cx={cx} cy={cy} rx={rx - 1.5} ry={ry - 0.8} fill="#6d869b" />
      {dies.map(([x, y], i) => (
        <rect key={i} x={x - 2.3} y={y - 1.2} width="4.6" height="2.4" fill={(i * 7) % 5 === 0 ? "#8fb0c9" : "#587489"} />
      ))}
      <path d={`M ${cx - 7} ${cy + ry - 0.4} Q ${cx} ${cy + ry - 2.6} ${cx + 7} ${cy + ry - 0.4}`} fill="#2a3540" opacity="0.9" />
    </svg>
  );
}
