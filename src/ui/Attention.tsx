"use client";

import { useMemo } from "react";
import { useFab } from "@/store/useFab";
import { RULES } from "@/sim/types";
import type { BayId, DispatchRule } from "@/sim/types";
import { RULE_HINT, RULE_LABEL } from "@/sim/dispatch";
import { StatusGlyph } from "@/art/StatusGlyph";
import { Btn, HotTag, SEV_LABEL, SevGlyph, Section } from "./kit";
import { BAY_NAME, fmtMin, pct } from "./format";

const SEV_RANK = { critical: 0, warning: 1, info: 2 } as const;

export function Attention({ compact = false }: { compact?: boolean }) {
  const snap = useFab((s) => s.snap);
  const models = useFab((s) => s.models);
  const send = useFab((s) => s.send);
  const select = useFab((s) => s.select);
  const focusBay = useFab((s) => s.focusBay);
  const selection = useFab((s) => s.selection);
  const mode = useFab((s) => s.mode);

  const active = useMemo(
    () => models.alarms.filter((a) => a.clearedT === null).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.setT - a.setT),
    [models.alarms],
  );
  const risky = useMemo(
    () =>
      (snap?.lots ?? [])
        .filter((l) => l.qtLeft !== null && l.qtLeft < 200 && l.status !== "processing" && l.status !== "atTool")
        .sort((a, b) => a.qtLeft! - b.qtLeft!)
        .slice(0, 6),
    [snap],
  );

  if (!snap) return null;
  const toolBy = new Map(snap.tools.map((t) => [t.id, t]));

  return (
    <div className="flex min-h-0 flex-col">
      <Section title={`Needs attention (${active.length})`}>
        {active.length === 0 ? (
          <p className="text-[12px] text-muted">No active alarms. Alarms appear here when a tool goes down, a queue-time limit is close, or an SPC chart breaks a rule.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {active.slice(0, compact ? 30 : 8).map((a) => {
              const tool = a.toolId ? toolBy.get(a.toolId) : undefined;
              return (
                <li key={a.id} className="rounded-xs border border-line bg-panel p-1.5">
                  <button
                    type="button"
                    className="flex w-full items-start gap-1.5 text-left max-md:min-h-[44px]"
                    onClick={() => select(a.lotId && !a.toolId ? { kind: "lot", id: a.lotId } : a.toolId ? { kind: "tool", id: a.toolId } : a.lotId ? { kind: "lot", id: a.lotId } : null)}
                  >
                    <span className="mt-0.5">
                      <SevGlyph sev={a.severity} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="num block text-[11px] text-muted">
                        {SEV_LABEL[a.severity]} · {a.code}
                      </span>
                      <span className="block text-[12px] leading-snug text-ink">{a.text}</span>
                    </span>
                  </button>
                  {mode === "sim" && tool && a.code === "TOOL_DOWN" && tool.crew !== "assigned" && (
                    <Btn className="mt-1 w-full" variant="primary" onClick={() => send({ type: "assignCrew", toolId: tool.id })}>
                      Assign repair crew to {tool.id}
                    </Btn>
                  )}
                  {mode === "sim" && tool && (a.code === "TOOL_DEGRADED" || a.code === "PM_DUE" || a.code === "SPC_RULE") && tool.state !== "UNSCHEDULED_DOWN" && !tool.pmPending && tool.state !== "ENGINEERING" && !(tool.state === "SCHEDULED_DOWN" && tool.reason === "pm") && (
                    <Btn className="mt-1 w-full" onClick={() => send({ type: "pmEarly", toolId: tool.id })}>
                      Send {tool.id} to PM now
                    </Btn>
                  )}
                  {mode === "sim" && tool && a.code === "TOOL_DOWN" && tool.crew === "assigned" && <p className="mt-1 text-[11px] text-muted">Crew on site, repair ends in {fmtMin(tool.endsIn ?? 0)}.</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Lots about to break a queue-time limit">
        {risky.length === 0 ? (
          <p className="text-[12px] text-muted">None right now. A lot lands here when less than 3:20 is left on its queue-time clock.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {risky.map((l) => (
              <li key={l.id} className="flex items-center gap-2 rounded-xs border border-line bg-panel p-1.5">
                <button type="button" className="min-w-0 flex-1 text-left max-md:min-h-[44px]" onClick={() => select({ kind: "lot", id: l.id })}>
                  <span className="num text-[12px]">{l.id}</span> <span className="num text-[11px] text-muted">before {l.recipe}</span>
                  <span className={`num block text-[12px] ${l.qtLeft! < 0 ? "text-udt" : "text-sdt"}`}>
                    {l.qtLeft! < 0 ? `Over by ${fmtMin(-l.qtLeft!)}` : `${fmtMin(l.qtLeft!)} left`}
                  </span>
                </button>
                {l.hot && <HotTag />}
                {mode === "sim" && l.prio === 0 && (
                  <Btn onClick={() => send({ type: "expedite", lotId: l.id })} disabled={snap.expeditesLeft <= 0} title={`${snap.expeditesLeft} expedites left`}>
                    Expedite
                  </Btn>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Bays and dispatch rules" aside={mode === "sim" ? <span className="num text-[11px] text-muted">crew {snap.crew.busy}/{snap.crew.total}</span> : undefined}>
        {mode === "live" && <p className="mb-1.5 text-[12px] text-muted">Bay metrics are derived from the feed. Dispatch rules belong to the simulator and stay read-only while live.</p>}
        <ul className="flex flex-col gap-1.5">
          {snap.bays.map((b) => (
            <li key={b.id} className="rounded-xs border border-line bg-panel p-1.5">
              <div className="flex items-center justify-between gap-2">
                <button type="button" className="text-left text-[12px] font-medium text-steel hover:text-ink max-md:min-h-[44px] max-md:min-w-[44px]" onClick={() => focusBay(b.id as BayId)} title="Fly the camera to this bay">
                  {BAY_NAME[b.id]}
                </button>
                <span className="num text-[11px] text-muted">
                  {b.toolsUp}/{b.toolCount} up · util {pct(b.util)} · queue {b.queue}
                </span>
              </div>
              <label className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                Rule
                <select
                  aria-label={`Dispatch rule for ${BAY_NAME[b.id]}`}
                  name={`rule-${b.id}`}
                  className="min-h-7 max-md:min-h-[44px] flex-1 rounded-xs border border-line bg-raised px-1.5 text-[12px] text-ink"
                  value={b.rule}
                  disabled={mode !== "sim"}
                  onChange={(e) => send({ type: "setRule", bay: b.id, rule: e.target.value as DispatchRule })}
                >
                  {RULES.map((r) => (
                    <option key={r} value={r}>
                      {r}, {RULE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
              {mode === "sim" && <p className="mt-1 text-[11px] leading-snug text-muted">{RULE_HINT[b.rule]}</p>}
              {compact && (
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {snap.tools
                    .filter((t) => t.bay === b.id)
                    .map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => select({ kind: "tool", id: t.id })}
                          aria-pressed={selection?.kind === "tool" && selection.id === t.id}
                          className={`num flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-xs border px-2 text-[12px] ${selection?.kind === "tool" && selection.id === t.id ? "border-accent bg-raised" : "border-line bg-raised"}`}
                        >
                          <StatusGlyph state={t.state} />
                          {t.id.slice(-2)}
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
