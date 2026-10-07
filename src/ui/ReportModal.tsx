"use client";

import { useFab } from "@/store/useFab";
import { Btn } from "./kit";
import { Modal } from "./Modal";
import { BAY_NAME, fmtDur, pct } from "./format";
import { clock } from "@/sim/report";
import type { BayId } from "@/sim/types";

const GRADE_TEXT: Record<string, string> = {
  S: "All objectives met and a clear win over autopilot.",
  A: "All objectives met.",
  B: "Two of three objectives met.",
  C: "One objective met.",
  D: "No objective met.",
};

export function ReportModal({ onClose }: { onClose: () => void }) {
  const report = useFab((s) => s.report);
  const seed = useFab((s) => s.seed);
  const newShift = useFab((s) => s.newShift);
  const select = useFab((s) => s.select);
  if (!report) return null;
  const { kpi, autopilot } = report;

  const download = () => {
    const blob = new Blob([JSON.stringify(report.replay, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fabtwin-replay-seed-${report.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal title="Shift report" onClose={onClose} wide closeLabel="Inspect the floor">
      <div className="grid gap-4 p-4 md:grid-cols-[200px_minmax(0,1fr)]">
        <div>
          <p className="text-[12px] text-muted">Grade</p>
          <p className="num text-[64px] font-medium leading-none text-accent" data-testid="grade">
            {report.grade}
          </p>
          <p className="mt-1 text-[12px] text-muted">{GRADE_TEXT[report.grade]}</p>
          <p className="mt-3 text-[12px] text-muted">Score</p>
          <p className="num text-[28px] leading-none">{report.score.total.toLocaleString("en-US")}</p>
          <p className="num mt-1 text-[12px] text-muted">Autopilot, same seed: {autopilot.score.toLocaleString("en-US")}</p>
          <p className="mt-3 text-[11px] text-muted">Simulated results. Seed {report.seed}.</p>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section>
            <h3 className="mb-1 text-[12px] font-medium text-muted">Objectives</h3>
            <ul className="flex flex-col gap-0.5 text-[13px]">
              {report.objectives.map((o) => (
                <li key={o.id} className="flex items-baseline justify-between gap-3 border-b border-[#1f2830] py-0.5">
                  <span>{o.label}</span>
                  <span className={`num text-[12px] ${o.met ? "text-prd" : "text-udt"}`}>
                    {o.id === "hotCt" ? (o.value === null ? "none shipped" : fmtDur(o.value)) : o.value} {o.met ? "met" : "missed"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-1 text-[12px] font-medium text-muted">What drove the result</h3>
            <ul className="flex flex-col gap-2">
              {report.drivers.map((d, i) => (
                <li key={i} className="border-b border-[#1f2830] pb-2 last:border-0">
                  <p className={`text-[13px] font-medium ${d.tone === "good" ? "text-prd" : d.tone === "bad" ? "text-udt" : "text-ink"}`}>{d.title}</p>
                  <p className="text-[12px] leading-snug text-muted">{d.detail}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-4 md:grid-cols-[1fr_1.15fr]">
            <div>
              <h3 className="mb-1 text-[12px] font-medium text-muted">Score breakdown</h3>
              <table className="grid-table text-[12px]">
                <tbody>
                  {report.score.lines.map((l) => (
                    <tr key={l.label}>
                      <td title={l.detail}>{l.label}</td>
                      <td className={`num text-right ${l.points < 0 ? "text-udt" : l.points === 0 ? "text-muted" : ""}`}>{l.points > 0 ? `+${l.points}` : l.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="mb-1 text-[12px] font-medium text-muted">You against autopilot</h3>
              <table className="grid-table text-[12px]">
                <thead>
                  <tr>
                    <th />
                    <th className="text-right">You</th>
                    <th className="text-right">Autopilot</th>
                  </tr>
                </thead>
                <tbody>
                  <Cmp label="Shipped" a={`${kpi.shipped}`} b={`${autopilot.kpi.shipped}`} />
                  <Cmp label="Cycle time" a={kpi.avgCtS ? fmtDur(kpi.avgCtS) : "-"} b={autopilot.kpi.avgCtS ? fmtDur(autopilot.kpi.avgCtS) : "-"} />
                  <Cmp label="Hot-lot CT" a={kpi.avgHotCtS ? fmtDur(kpi.avgHotCtS) : "-"} b={autopilot.kpi.avgHotCtS ? fmtDur(autopilot.kpi.avgHotCtS) : "-"} />
                  <Cmp label="On time" a={kpi.otd === null ? "-" : pct(kpi.otd)} b={autopilot.kpi.otd === null ? "-" : pct(autopilot.kpi.otd)} />
                  <Cmp label="QT violations" a={`${kpi.qtViolations}`} b={`${autopilot.kpi.qtViolations}`} />
                  <Cmp label="Downtime" a={fmtDur(kpi.downtimeS)} b={fmtDur(autopilot.kpi.downtimeS)} />
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-muted">Autopilot = FIFO in every bay, no interventions, same seed and same failures.</p>
            </div>
          </section>

          {report.tools.some((t) => t.downS > 0) && (
            <section>
              <h3 className="mb-1 text-[12px] font-medium text-muted">Tools that lost the most time</h3>
              <table className="grid-table text-[12px]">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Bay</th>
                    <th className="text-right">Failures</th>
                    <th className="text-right">Down</th>
                    <th className="text-right">Util</th>
                  </tr>
                </thead>
                <tbody>
                  {report.tools.filter((t) => t.downS > 0).slice(0, 5).map((t) => (
                    <tr key={t.id}>
                      <td>
                        <button type="button" className="num text-steel hover:text-accent" onClick={() => (select({ kind: "tool", id: t.id }), onClose())}>
                          {t.id}
                        </button>
                      </td>
                      <td className="text-muted">{BAY_NAME[t.bay as BayId]}</td>
                      <td className="num text-right">{t.failures}</td>
                      <td className="num text-right">{fmtDur(t.downS)}</td>
                      <td className="num text-right">{pct(t.util)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {report.commands.length > 0 && (
            <section>
              <h3 className="mb-1 text-[12px] font-medium text-muted">Your actions ({report.commands.length})</h3>
              <ol className="max-h-32 overflow-y-auto scroll-thin text-[12px]">
                {report.commands.map((c, i) => (
                  <li key={i} className="grid grid-cols-[48px_1fr] gap-2">
                    <span className="num text-muted">{clock(c.t)}</span>
                    <span className={c.result.ok ? "" : "text-muted"}>{c.result.message}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <Btn variant="primary" onClick={() => newShift(seed)}>
              Replay seed {seed}
            </Btn>
            <Btn onClick={() => newShift(((seed * 7919 + 13) % 999983) + 1)}>Play a new seed</Btn>
            <Btn onClick={download}>Download replay JSON</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Cmp({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <tr>
      <td className="text-muted">{label}</td>
      <td className="num text-right">{a}</td>
      <td className="num text-right text-muted">{b}</td>
    </tr>
  );
}
