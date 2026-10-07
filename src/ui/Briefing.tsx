"use client";

import { useState } from "react";
import { useFab } from "@/store/useFab";
import { Btn } from "./kit";
import { Modal } from "./Modal";
import { Foup } from "@/art/Foup";
import { ToolIso } from "@/art/ToolIso";
import { Wafer } from "@/art/Wafer";
import { Objectives } from "./TopBar";
import { buildConfig } from "@/sim/config";

export function Briefing({ onClose }: { onClose: () => void }) {
  const seed = useFab((s) => s.seed);
  const phase = useFab((s) => s.phase);
  const begin = useFab((s) => s.begin);
  const init = useFab((s) => s.init);
  const [draft, setDraft] = useState(String(seed));
  const cfg = buildConfig(seed);
  const parsed = Number.parseInt(draft, 10);
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= 999999;
  const running = phase === "running";

  return (
    <Modal title="Shift briefing" onClose={onClose} closeLabel={running ? "Back to the floor" : "Look around first"}>
      <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
          <p>
            You are the shift lead of a small 300 mm fab: five bays, {cfg.tools.length} tools, two stockers and an overhead hoist loop. Lots follow 12 to 20 step routes and keep returning to lithography. The shift is {cfg.shiftS / 3600} simulated hours.
          </p>
          <div>
            <p className="mb-1 text-[12px] font-medium text-muted">Objectives</p>
            <Objectives stacked />
          </div>
          <div>
            <p className="mb-1 text-[12px] font-medium text-muted">What you can do</p>
            <ul className="list-disc pl-4 text-[12px] text-muted">
              <li>Change a bay&apos;s dispatch rule (FIFO, earliest due date, critical ratio, setup avoidance).</li>
              <li>Expedite a lot (4 per shift), or hold and release one.</li>
              <li>Send a tool to preventive maintenance before it fails.</li>
              <li>Put a repair crew on a down tool. There are only {cfg.crewSize} crews.</li>
            </ul>
          </div>
          <p className="rounded-xs border border-line bg-raised p-2 text-[12px] text-muted">
            Portfolio project. The fab, the lots and every number on screen are simulated. Nothing here is real production data. The same seed always plays the same shift.
          </p>
          {!running && (
            <label className="flex items-center gap-2 text-[12px] text-muted">
              Shift seed
              <input
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                className="num min-h-8 w-24 rounded-xs border border-line bg-raised px-2 text-[13px] text-ink"
                aria-invalid={!valid}
              />
              {!valid && <span className="text-udt">Use a number from 1 to 999999.</span>}
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="primary"
              className="min-h-10 px-4 text-[13px]"
              disabled={!valid}
              onClick={() => {
                if (!running && parsed !== seed) init(parsed);
                begin(10);
                onClose();
              }}
            >
              {running ? "Continue at 10x" : "Start shift at 10x"}
            </Btn>
          </div>
        </div>
        <div className="hidden items-center gap-1 sm:flex sm:flex-col">
          <ToolIso size={110} kind="litho" />
          <Foup size={90} />
          <Wafer size={90} />
        </div>
      </div>
    </Modal>
  );
}
