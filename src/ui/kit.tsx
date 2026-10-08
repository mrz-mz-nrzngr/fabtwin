"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { AlarmSeverity } from "@/events/types";

type Variant = "default" | "primary" | "danger" | "ghost";

const VARIANT: Record<Variant, string> = {
  default: "bg-raised border-line text-ink hover:border-steel disabled:text-muted disabled:hover:border-line",
  primary: "bg-accent border-accent text-accent-ink font-medium hover:brightness-110 disabled:bg-raised disabled:border-line disabled:text-muted",
  danger: "bg-raised border-udt text-ink hover:bg-[#2a1a1c] disabled:border-line disabled:text-muted",
  ghost: "bg-transparent border-transparent text-steel hover:text-ink disabled:text-muted",
};

export function Btn({ variant = "default", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...p}
      className={`min-h-7 max-md:min-h-[44px] rounded-xs border px-2.5 py-1 text-[12px] leading-tight transition-colors duration-150 ${VARIANT[variant]} ${className}`}
    />
  );
}

export function Section({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`border-b border-line px-3 py-2.5 ${className}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium text-muted">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function SevGlyph({ sev }: { sev: AlarmSeverity }) {
  const c = sev === "critical" ? "#f0524f" : sev === "warning" ? "#f0b429" : "#5aa9e6";
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      {sev === "critical" && <polygon points="6,0.6 11.6,11 0.4,11" fill={c} />}
      {sev === "warning" && <rect x="1.2" y="1.2" width="9.6" height="9.6" fill={c} />}
      {sev === "info" && <circle cx="6" cy="6" r="4.2" fill="none" stroke={c} strokeWidth="2" />}
    </svg>
  );
}

export const SEV_LABEL: Record<AlarmSeverity, string> = { critical: "Critical", warning: "Warning", info: "Info" };

export function HotTag({ expedited }: { expedited?: boolean }) {
  return (
    <span className="rounded-xs border border-accent px-1 text-[11px] leading-4 text-accent" title={expedited ? "Expedited by the shift lead" : "Hot lot: tight due date"}>
      {expedited ? "Expedited" : "Hot"}
    </span>
  );
}

export function Empty({ art, title, children }: { art?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
      {art}
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {children && <p className="max-w-[44ch] text-[12px] text-muted">{children}</p>}
    </div>
  );
}
