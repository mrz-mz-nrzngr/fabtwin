"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function Modal({ title, onClose, children, wide = false, closeLabel = "Close" }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; closeLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>("button, input, select, a[href], [tabindex]:not([tabindex='-1'])");
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex overflow-y-auto bg-[#05080b]/80 p-3">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`enter m-auto w-full outline-none ${wide ? "max-w-4xl" : "max-w-xl"} rounded-md border border-line bg-panel shadow-[0_18px_50px_rgba(0,0,0,0.55)]`}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="min-h-8 max-md:min-h-[44px] px-1 text-[12px] text-steel hover:text-ink">
            {closeLabel}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
