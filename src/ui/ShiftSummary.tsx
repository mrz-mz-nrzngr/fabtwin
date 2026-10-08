"use client";

import { useFab } from "@/store/useFab";
import { Section } from "./kit";
import { fmtDur, pct } from "./format";
import { ToolIso } from "@/art/ToolIso";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[#1f2830] py-1 last:border-0" title={hint}>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="num text-[13px]">{value}</dd>
    </div>
  );
}

export function ShiftSummary() {
  const snap = useFab((s) => s.snap);
  const mode = useFab((s) => s.mode);
  if (!snap) return null;
  const k = snap.kpi;
  return (
    <div className="flex min-h-0 flex-col">
      <Section
        title={mode === "live" ? "KPIs, derived from live events" : "Shift KPIs, simulated"}
        aside={<span className="text-[11px] text-muted">{mode === "live" ? "computed here from lot events" : "not real fab data"}</span>}
      >
        {mode === "live" && k.shipped === 0 && snap.lots.length === 0 && <p className="mb-1 text-[12px] text-muted">No lot events yet. KPIs fill in as lots start, complete and ship on the feed.</p>}
        <dl>
          <Stat label="Lots shipped" value={`${k.shipped}`} hint={mode === "live" ? "Lots whose last step completed (final flag, or the last step of a known route)" : "Lots that finished their last step this shift"} />
          <Stat label="Throughput" value={`${k.throughputPerHr.toFixed(1)} lots/h`} />
          <Stat label="WIP" value={`${k.wip} lots`} hint={mode === "live" ? "Lots seen on the feed that have not shipped" : "Lots in the fab right now. Release stops at the WIP cap."} />
          <Stat label="Cycle time, mean" value={k.avgCtS === null ? "none shipped" : fmtDur(k.avgCtS)} />
          <Stat label="X-factor" value={k.xFactor === null ? "-" : k.xFactor.toFixed(2)} hint="Cycle time divided by raw process time. 1.0 would mean no waiting at all." />
          <Stat label="On-time delivery" value={k.otd === null ? "-" : pct(k.otd)} />
          <Stat label="Queue-time violations" value={`${k.qtViolations}`} />
          <Stat label="Quality escapes" value={`${k.oocEscapes}`} hint="Lots with an SPC excursion flag that shipped" />
          <Stat label="Mean tool utilization" value={pct(k.avgUtil)} hint="Productive time divided by time observed, all 24 tools" />
          <Stat label="Unscheduled downtime" value={fmtDur(k.downtimeS)} hint="Summed over all tools" />
          {mode === "sim" && <Stat label="OHT waiting" value={fmtDur(snap.oht.waitS)} hint={`Vehicle-seconds stopped behind another vehicle. ${snap.oht.blockedNow} blocked now, ${snap.oht.jobsQueued} transport orders queued.`} />}
        </dl>
      </Section>
      <div className="flex flex-col items-center gap-2 px-3 py-4 text-center">
        <ToolIso size={96} kind="litho" lamp="#3ecf8e" />
        <p className="text-[13px] font-medium">Click a tool in the floor view to inspect it.</p>
        <p className="max-w-[34ch] text-[12px] text-muted">
          Or pick one from the equipment table below. You will see its state, the lot inside, the bay queue, its recipe, and the actions available.
        </p>
      </div>
    </div>
  );
}
