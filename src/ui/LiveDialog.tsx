"use client";

import Link from "next/link";
import { useState } from "react";
import { parseUrls, validUrls } from "@/live/sources";
import type { LiveKind } from "@/live/sources";
import { useFab } from "@/store/useFab";
import { Btn } from "./kit";
import { Modal } from "./Modal";

const KINDS: Array<{ id: LiveKind; label: string; hint: string }> = [
  { id: "ws", label: "WebSocket events", hint: "FabTwin schema v1 frames. Fab in a box (GemBench SECS/GEM), the OPC UA bridge, or your own bridge. Several URLs, comma separated, are merged." },
  { id: "sparkplug", label: "Sparkplug B over MQTT", hint: "Subscribe to an MQTT broker's WebSocket listener and decode Sparkplug B births, data and deaths in the browser." },
];

const field = "num min-h-9 rounded-xs border border-line bg-raised px-2 text-[13px] text-ink";

export function LiveDialog({ onClose }: { onClose: () => void }) {
  const live = useFab((s) => s.live);
  const mode = useFab((s) => s.mode);
  const openLive = useFab((s) => s.openLive);
  const closeLive = useFab((s) => s.closeLive);
  const [kind, setKind] = useState<LiveKind>(live.kind);
  const [wsText, setWsText] = useState(live.kind === "ws" ? live.url : "ws://localhost:8787");
  const [broker, setBroker] = useState(live.kind === "sparkplug" ? live.url : "ws://localhost:18831");
  const [group, setGroup] = useState("FabTwin");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  const wsUrls = parseUrls(wsText);
  const valid = kind === "ws" ? validUrls(wsUrls) : validUrls([broker.trim()]);
  const connect = () =>
    openLive(kind === "ws" ? { kind, urls: wsUrls } : { kind, urls: [broker.trim()], sparkplug: { groupId: group.trim(), username: user || undefined, password: pass || undefined } });
  const sources = Object.entries(live.sources);

  return (
    <Modal title="Live mode" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4 text-[13px]">
        <p className="text-[12px] leading-relaxed text-muted">
          The console follows real traffic instead of the simulator. Whatever the source, it becomes the same event stream (schema v1). Tool states, alarms, lot genealogy and Gantt come straight from it. KPIs, WIP and SPC are computed from the lot events, and FOUP motion is drawn from them (the vehicles are synthesised, since the stream does not carry vehicle positions).
        </p>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[12px] text-muted">Source</legend>
          {KINDS.map((k) => (
            <label key={k.id} className={`flex cursor-pointer items-start gap-2 rounded-xs border px-2 py-1.5 ${kind === k.id ? "border-steel bg-raised" : "border-line"}`}>
              <input type="radio" name="live-kind" className="mt-1" checked={kind === k.id} onChange={() => setKind(k.id)} />
              <span>
                <span className="block text-[13px] text-ink">{k.label}</span>
                <span className="block text-[12px] text-muted">{k.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {kind === "ws" ? (
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            Socket URL (ws:// or wss://)
            <input value={wsText} onChange={(e) => setWsText(e.target.value)} className={field} aria-invalid={!valid} spellCheck={false} />
          </label>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              Broker WebSocket URL
              <input value={broker} onChange={(e) => setBroker(e.target.value)} className={field} aria-invalid={!valid} spellCheck={false} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              Sparkplug group id (empty means all groups)
              <input value={group} onChange={(e) => setGroup(e.target.value)} className={field} spellCheck={false} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[12px] text-muted">
                Username (optional)
                <input value={user} onChange={(e) => setUser(e.target.value)} className={field} autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-muted">
                Password (optional, kept in memory only)
                <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} className={field} autoComplete="off" />
              </label>
            </div>
          </div>
        )}
        {!valid && <p className="text-[12px] text-udt">{kind === "ws" ? "Each URL must start with ws:// or wss://." : "The broker URL must start with ws:// or wss://."}</p>}

        <div aria-live="polite" className="num text-[12px]">
          <p>
            Status: <span className={live.state === "open" ? "text-prd" : live.state === "error" ? "text-udt" : "text-muted"}>{live.state}</span>
            {mode === "live" && ` · ${live.received} events · ${live.rejected} rejected`}
            {live.detail ? ` · ${live.detail}` : ""}
          </p>
          {mode === "live" && sources.length > 1 && (
            <ul className="mt-1 text-muted">
              {sources.map(([id, s]) => (
                <li key={id}>
                  {id}: {s.state}
                </li>
              ))}
            </ul>
          )}
          {mode === "live" && live.ignoredTools.length > 0 && <p className="mt-1 text-sdt">Ignored tool ids that are not on this floor: {live.ignoredTools.join(", ")}</p>}
        </div>

        <p className="text-[12px] text-muted">
          No source running yet? The <Link href="/integrations" className="text-steel underline">Integrations page</Link> lists the start command for each one, for example <span className="num text-ink">npm run mock-live</span> for a replay on ws://localhost:8787.
        </p>
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" disabled={!valid} onClick={connect}>
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
