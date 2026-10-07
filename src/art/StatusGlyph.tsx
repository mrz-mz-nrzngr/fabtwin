import type { E10State } from "@/events/types";

export const E10_COLOR: Record<E10State, string> = {
  PRODUCTIVE: "#3ecf8e",
  STANDBY: "#5aa9e6",
  ENGINEERING: "#a78bfa",
  SCHEDULED_DOWN: "#f0b429",
  UNSCHEDULED_DOWN: "#f0524f",
};

/** One glyph shape per state, so colour is never the only channel. */
export function StatusGlyph({ state, size = 12 }: { state: E10State; size?: number }) {
  const c = E10_COLOR[state];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      {state === "PRODUCTIVE" && <circle cx="6" cy="6" r="5" fill={c} />}
      {state === "STANDBY" && <circle cx="6" cy="6" r="4.2" fill="none" stroke={c} strokeWidth="2" />}
      {state === "ENGINEERING" && <polygon points="6,0.8 11.2,6 6,11.2 0.8,6" fill={c} />}
      {state === "SCHEDULED_DOWN" && <rect x="1.2" y="1.2" width="9.6" height="9.6" fill={c} />}
      {state === "UNSCHEDULED_DOWN" && <polygon points="6,0.6 11.6,11 0.4,11" fill={c} />}
    </svg>
  );
}
