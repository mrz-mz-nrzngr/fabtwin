"use client";

import { useState } from "react";
import { useFab } from "@/store/useFab";
import { Btn } from "./kit";
import { Modal } from "./Modal";

export function LiveDialog({ onClose }: { onClose: () => void }) {
  const live = useFab((s) => s.live);
  const mode = useFab((s) => s.mode);
  const openLive = useFab((s) => s.openLive);
  const closeLive = useFab((s) => s.closeLive);
  const [url, setUrl] = useState(live.url);
  const valid = /^wss?:\/\/.+/.test(url);
  return (
    <Modal title="Live mode" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4 text-[13px]">
        <p className="text-[12px] leading-relaxed text-muted">
          Connect the console to a WebSocket that sends FabTwin events (schema v1): equipment state changes, alarm set and clear, lot start and complete, collection events. The simulator pauses while live, and the equipment table, Gantt, alarms and lot genealogy follow the socket. The planned SECS/GEM simulator bridge will speak this schema.
        </p>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Socket URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} className="num min-h-9 rounded-xs border border-line bg-raised px-2 text-[13px] text-ink" aria-invalid={!valid} />
        </label>
        {!valid && <p className="text-[12px] text-udt">The URL must start with ws:// or wss://.</p>}
        <p className="num text-[12px]" aria-live="polite">
          Status: <span className={live.state === "open" ? "text-prd" : live.state === "error" ? "text-udt" : "text-muted"}>{live.state}</span>
          {mode === "live" && ` · ${live.received} events · ${live.rejected} rejected`}
          {live.detail ? ` · ${live.detail}` : ""}
        </p>
        <p className="text-[12px] text-muted">
          No bridge yet? Run <span className="num text-ink">npm run mock-live</span> in a terminal. It replays a simulated shift on ws://localhost:8787.
        </p>
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" disabled={!valid} onClick={() => openLive(url)}>
            {mode === "live" ? "Reconnect" : "Connect"}
          </Btn>
          {mode === "live" && (
            <Btn
              onClick={() => {
                closeLive();
                const st = useFab.getState();
                st.init(st.seed);
                onClose();
              }}
            >
              Leave live mode and restart the shift
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  );
}
