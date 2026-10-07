"use client";

import { useFab } from "@/store/useFab";
import { RECIPES, ROUTES } from "@/sim/config";
import { Btn, HotTag, Section } from "./kit";
import { BAY_NAME, fmtClock, fmtMin } from "./format";
import { Empty } from "./kit";
import { Foup } from "@/art/Foup";
import type { HistoryEntry } from "@/store/readmodels";

const BAY_INITIAL: Record<string, string> = { LITHO: "L", ETCH: "E", DEP: "D", CMP: "C", METRO: "M" };

export function LotPanel({ id }: { id: string }) {
  const snap = useFab((s) => s.snap);
  const models = useFab((s) => s.models);
  const send = useFab((s) => s.send);
  const select = useFab((s) => s.select);
  const mode = useFab((s) => s.mode);
  if (!snap) return null;
  const lot = snap.lots.find((l) => l.id === id);
  const hist = models.lotHistory[id] ?? [];
  const idx = models.lotIndex[id];
  const route = ROUTES.find((r) => r.id === (lot?.route ?? idx?.route));

  if (!lot) {
    return (
      <div className="enter flex flex-col">
        <header className="flex items-baseline justify-between border-b border-line px-3 py-2.5">
          <h2 className="num text-[16px] font-medium">{id}</h2>
          <button type="button" className="text-[12px] text-steel hover:text-ink" onClick={() => select(null)}>
            Close
          </button>
        </header>
        {idx?.shippedAt !== undefined ? (
          <p className="px-3 py-2 text-[12px] text-muted">Shipped at {fmtClock(idx.shippedAt)}. Its genealogy is below.</p>
        ) : (
          <Empty art={<Foup size={64} />} title="No such lot in the fab">
            It may have been released after the last snapshot, or the id is wrong.
          </Empty>
        )}
        <Genealogy hist={hist} />
      </div>
    );
  }

  const dueIn = lot.due - snap.t;
  const where =
    lot.loc.k === "tool" ? `On ${lot.loc.id}` : lot.loc.k === "stocker" ? `In stocker ${lot.loc.id}` : lot.loc.k === "vehicle" ? `On vehicle ${lot.loc.id}` : "Shipped";

  return (
    <div className="enter flex min-h-0 flex-col" data-testid="lot-panel">
      <header className="border-b border-line px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="num flex items-center gap-2 text-[16px] font-medium">
            {lot.id} {lot.hot && <HotTag expedited={lot.prio === 1} />}
            {!lot.hot && lot.prio === 1 && <HotTag expedited />}
          </h2>
          <button type="button" className="text-[12px] text-steel hover:text-ink" onClick={() => select(null)}>
            Close
          </button>
        </div>
        <p className="text-[12px] text-muted">
          {route?.name ?? lot.route}, 25 wafers
        </p>
        <p className="mt-1 text-[13px]">
          Step <span className="num">{lot.step + 1}</span> of <span className="num">{lot.steps}</span>: <span className="num">{lot.recipe}</span> ({BAY_NAME[lot.bay]})
        </p>
        <p className="text-[12px] text-muted">
          {where}, {lot.held ? `on hold (${lot.holdReason === "spc" ? "SPC excursion" : "operator"})` : lot.status === "waiting" ? "waiting for a tool" : lot.status === "transit" ? "in transit" : "processing"}
        </p>
        <p className={`num mt-1 text-[12px] ${dueIn < 0 ? "text-udt" : "text-muted"}`}>{dueIn < 0 ? `Late by ${fmtMin(-dueIn)}` : `Due in ${fmtMin(dueIn)}`}</p>
        {lot.qtLeft !== null && (
          <p className={`num text-[12px] ${lot.qtLeft < 0 ? "text-udt" : lot.qtLeft < 200 ? "text-sdt" : "text-muted"}`}>
            Queue-time clock: {lot.qtLeft < 0 ? `over by ${fmtMin(-lot.qtLeft)}` : `${fmtMin(lot.qtLeft)} left`}
          </p>
        )}
        {lot.ooc && <p className="mt-1 text-[12px] text-sdt">SPC excursion flag. Service the suspect tool, then release the lot to clear it.</p>}
      </header>

      {route && (
        <Section title="Route">
          <ol className="flex flex-wrap gap-[3px]" aria-label="Route steps">
            {route.steps.map((s, i) => {
              const r = RECIPES[s.recipe];
              const cur = i === lot.step;
              return (
                <li
                  key={i}
                  title={`${i + 1}. ${s.recipe}${s.qtS ? `, queue-time limit ${Math.round(s.qtS / 60)} min` : ""}`}
                  className={`num flex h-6 w-6 items-center justify-center rounded-xs border text-[11px] ${
                    cur ? "border-accent bg-accent text-accent-ink" : i < lot.step ? "border-line bg-raised text-muted" : "border-line text-steel"
                  }`}
                >
                  {BAY_INITIAL[r.bay]}
                </li>
              );
            })}
          </ol>
          <p className="mt-1 text-[11px] text-muted">L litho, E etch, D deposition, C CMP, M metrology. The lot returns to litho {route.steps.filter((s) => RECIPES[s.recipe].bay === "LITHO").length} times.</p>
        </Section>
      )}

      <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2.5">
        <Btn variant="primary" disabled={mode !== "sim" || lot.prio === 1 || snap.expeditesLeft <= 0} onClick={() => send({ type: "expedite", lotId: lot.id })} title={`${snap.expeditesLeft} expedites left this shift`}>
          Expedite ({snap.expeditesLeft} left)
        </Btn>
        {lot.held ? (
          <Btn disabled={mode !== "sim"} onClick={() => send({ type: "release", lotId: lot.id })}>
            Release lot
          </Btn>
        ) : (
          <Btn disabled={mode !== "sim"} onClick={() => send({ type: "hold", lotId: lot.id })}>
            Hold lot
          </Btn>
        )}
        <p className="w-full text-[11px] text-muted">Holding keeps the lot out of dispatch. Its queue-time clock keeps running.</p>
      </div>

      <Genealogy hist={hist} />
    </div>
  );
}

function Genealogy({ hist }: { hist: HistoryEntry[] }) {
  return (
    <Section title={`Genealogy (${hist.length} events)`}>
      {hist.length === 0 ? (
        <p className="text-[12px] text-muted">Nothing recorded for this lot in this session yet. Lots in progress at the start of the shift build their history from the first event.</p>
      ) : (
        <ol className="flex max-h-72 flex-col gap-1 overflow-y-auto scroll-thin" aria-label="Lot genealogy, newest first">
          {[...hist].reverse().map((h, i) => (
            <li key={i} className="grid grid-cols-[52px_1fr] gap-2 text-[12px]">
              <span className="num text-muted">{fmtClock(h.t).slice(0, 5)}</span>
              <span className={h.kind === "qt" || h.kind === "hold" ? "text-sdt" : ""}>{h.text}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
