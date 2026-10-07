"use client";

import { useMemo } from "react";
import { useFab } from "@/store/useFab";
import { E10_STATES } from "@/events/types";
import { E10_LABEL } from "@/sim/e10";
import { E10_COLOR, StatusGlyph } from "@/art/StatusGlyph";
import { Btn, HotTag, SEV_LABEL, SevGlyph, Section } from "./kit";
import { BAY_NAME, fmtClock, fmtMin, pct } from "./format";
import { RECIPES } from "@/sim/config";

export function ToolPanel({ id }: { id: string }) {
  const snap = useFab((s) => s.snap);
  const models = useFab((s) => s.models);
  const send = useFab((s) => s.send);
  const select = useFab((s) => s.select);
  const mode = useFab((s) => s.mode);
  const tool = snap?.tools.find((t) => t.id === id);
  const alarms = useMemo(() => models.alarms.filter((a) => a.toolId === id).slice(-5).reverse(), [models.alarms, id]);
  if (!snap || !tool) return null;

  const lot = tool.lotId ? snap.lots.find((l) => l.id === tool.lotId) : undefined;
  const incoming = tool.assignedLotId ? snap.lots.find((l) => l.id === tool.assignedLotId) : undefined;
  const queue = snap.lots.filter((l) => l.bay === tool.bay && l.status === "waiting" && !l.held).sort((a, b) => a.readyAt - b.readyAt);
  const bayRecipes = Object.values(RECIPES).filter((r) => r.bay === tool.bay);
  const total = Object.values(tool.stateTime).reduce((a, b) => a + b, 0) || 1;
  const maint = tool.state === "ENGINEERING" || (tool.state === "SCHEDULED_DOWN" && tool.reason === "pm");
  const pmDisabled = mode !== "sim" || tool.state === "UNSCHEDULED_DOWN" || maint || tool.pmPending;
  const pmWhy = tool.state === "UNSCHEDULED_DOWN" ? "Tool is down. Assign a crew." : maint ? "Already in maintenance." : tool.pmPending ? "PM is already queued." : "";

  return (
    <div className="enter flex min-h-0 flex-col" data-testid="tool-panel">
      <header className="border-b border-line px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="num text-[16px] font-medium">{tool.id}</h2>
          <button type="button" className="text-[12px] text-steel hover:text-ink" onClick={() => select(null)}>
            Close
          </button>
        </div>
        <p className="text-[12px] text-muted">{BAY_NAME[tool.bay]} tool</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px]">
          <StatusGlyph state={tool.state} />
          <span className="font-medium">{E10_LABEL[tool.state]}</span>
          <span className="text-muted">
            ({tool.reason || "idle"}
            {tool.endsIn !== null ? `, ${fmtMin(tool.endsIn)} left` : ""})
          </span>
        </p>
        {tool.warn && tool.state !== "UNSCHEDULED_DOWN" && (
          <p className="mt-1 text-[12px] text-sdt">Degradation warning: vibration and temperature trending high. A failure is likely soon. PM now defuses it.</p>
        )}
      </header>

      <Section title="Current lot">
        {lot ? (
          <button type="button" className="num flex w-full items-center gap-2 text-left text-[13px] hover:text-accent" onClick={() => select({ kind: "lot", id: lot.id })}>
            {lot.id} {lot.hot && <HotTag expedited={lot.prio === 1} />}
            <span className="text-muted">
              step {lot.step + 1}/{lot.steps}, {lot.recipe}
            </span>
          </button>
        ) : (
          <p className="text-[12px] text-muted">{tool.state === "UNSCHEDULED_DOWN" ? "Nothing inside. The tool is down." : "Empty. The tool is waiting for the dispatcher."}</p>
        )}
        {incoming && (
          <p className="mt-1 text-[12px] text-muted">
            Next: <span className="num text-ink">{incoming.id}</span> ({incoming.recipe}) on its way.
          </p>
        )}
      </Section>

      <Section title={`Bay queue (${queue.length})`} aside={<span className="text-[11px] text-muted">oldest first</span>}>
        {queue.length === 0 ? (
          <p className="text-[12px] text-muted">No lots are waiting for {BAY_NAME[tool.bay]}.</p>
        ) : (
          <ul className="flex flex-col">
            {queue.slice(0, 6).map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => select({ kind: "lot", id: l.id })} className="num flex w-full items-center justify-between gap-2 py-0.5 text-left text-[12px] hover:text-accent">
                  <span>
                    {l.id} <span className="text-muted">{l.recipe}</span>
                  </span>
                  <span className="text-muted">
                    {l.hot ? "hot " : ""}waited {fmtMin(snap.t - l.readyAt)}
                  </span>
                </button>
              </li>
            ))}
            {queue.length > 6 && <li className="text-[11px] text-muted">and {queue.length - 6} more</li>}
          </ul>
        )}
      </Section>

      <Section title="Recipe">
        <p className="num text-[13px]">{tool.recipe ?? "none loaded"}</p>
        <p className="mt-0.5 text-[11px] text-muted">Qualified: {bayRecipes.map((r) => r.id).join(", ")}. Changing recipe costs a setup of {bayRecipes[0].setupS} s.</p>
      </Section>

      <Section title="Time in state this shift" aside={<span className="num text-[11px] text-muted">util {pct(tool.util)}</span>}>
        <div className="flex h-2.5 w-full overflow-hidden rounded-xs bg-raised" role="img" aria-label={E10_STATES.map((s) => `${E10_LABEL[s]} ${pct(tool.stateTime[s] / total)}`).join(", ")}>
          {E10_STATES.map((s) => (
            <div key={s} style={{ width: `${(tool.stateTime[s] / total) * 100}%`, background: E10_COLOR[s] }} />
          ))}
        </div>
        <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted">
          {E10_STATES.map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <StatusGlyph state={s} size={9} />
              {E10_LABEL[s]} <span className="num ml-auto text-ink">{pct(tool.stateTime[s] / total)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[11px] text-muted">
          Lots processed {tool.lotsDone}. PM {tool.pmPending ? "queued, starts when idle" : `due in ${fmtMin(Math.max(0, tool.pmDueIn))}`}.
        </p>
      </Section>

      <Section title="Recent alarms">
        {alarms.length === 0 ? (
          <p className="text-[12px] text-muted">No alarms on this tool yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {alarms.map((a) => (
              <li key={a.id} className="flex items-start gap-1.5 text-[12px]">
                <SevGlyph sev={a.severity} />
                <span className="min-w-0">
                  <span className="num text-[11px] text-muted">
                    {fmtClock(a.setT)} · {SEV_LABEL[a.severity]} · {a.clearedT === null ? "active" : `cleared ${fmtClock(a.clearedT)}`}
                  </span>
                  <span className="block leading-snug">{a.text}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="flex flex-col gap-1.5 border-b border-line px-3 py-2.5">
        <Btn variant="primary" disabled={pmDisabled} title={pmWhy} onClick={() => send({ type: "pmEarly", toolId: tool.id })}>
          Send to PM now
        </Btn>
        <Btn disabled={mode !== "sim" || tool.state !== "UNSCHEDULED_DOWN" || tool.crew === "assigned"} title={tool.state !== "UNSCHEDULED_DOWN" ? "Only a down tool needs a crew." : tool.crew === "assigned" ? "Crew already working." : ""} onClick={() => send({ type: "assignCrew", toolId: tool.id })}>
          {tool.crew === "assigned" ? "Crew is repairing" : tool.crew === "waiting" ? "Move to front of the crew queue" : "Assign repair crew"}
        </Btn>
        {pmWhy && <p className="text-[11px] text-muted">{pmWhy}</p>}
      </div>
    </div>
  );
}
