"use client";

import { create } from "zustand";
import { EPOCH_MS } from "@/sim/config";
import type { FabEvent } from "@/events/types";
import { LiveClient } from "@/events/live";
import type { LiveState } from "@/events/live";
import type { ShiftReport } from "@/sim/report";
import type { BayId, Command, Snapshot } from "@/sim/types";
import type { FromWorker, ToWorker } from "@/worker/protocol";
import { applyEvents, emptyModels } from "./readmodels";
import type { ReadModels } from "./readmodels";

export type Speed = 0 | 1 | 10 | 60;
export type Selection = { kind: "tool" | "lot"; id: string } | null;
export interface Toast {
  id: number;
  text: string;
  ok: boolean;
}

interface LiveInfo {
  url: string;
  state: LiveState | "off";
  detail?: string;
  received: number;
  rejected: number;
}

interface FabState {
  boot: "idle" | "booting" | "ready" | "error";
  error: string | null;
  phase: "briefing" | "running" | "ended";
  mode: "sim" | "live";
  seed: number;
  /** Increments on every new shift, so dialogs can tell shifts apart. */
  shiftNo: number;
  speed: Speed;
  snap: Snapshot | null;
  snapRecvAt: number;
  models: ReadModels;
  report: ShiftReport | null;
  selection: Selection;
  focus: { bay: BayId | null; n: number };
  view: "3d" | "2d";
  toasts: Toast[];
  live: LiveInfo;
  init: (seed?: number) => void;
  begin: (speed?: Speed) => void;
  setSpeed: (s: Speed) => void;
  send: (cmd: Command) => void;
  select: (s: Selection) => void;
  focusBay: (bay: BayId | null) => void;
  setView: (v: "3d" | "2d") => void;
  newShift: (seed: number) => void;
  openLive: (url: string) => void;
  closeLive: () => void;
  dismissToast: (id: number) => void;
}

let worker: Worker | null = null;
let liveClient: LiveClient | null = null;
let cmdSeq = 0;
let toastSeq = 0;
const pendingCmds = new Map<number, Command>();

function post(m: ToWorker) {
  worker?.postMessage(m);
}

export const useFab = create<FabState>((set, get) => ({
  boot: "idle",
  error: null,
  phase: "briefing",
  mode: "sim",
  seed: 1,
  shiftNo: 0,
  speed: 0,
  snap: null,
  snapRecvAt: 0,
  models: emptyModels(EPOCH_MS),
  report: null,
  selection: null,
  focus: { bay: null, n: 0 },
  view: "3d",
  toasts: [],
  live: { url: "ws://localhost:8787", state: "off", received: 0, rejected: 0 },

  init: (seed) => {
    const s = seed ?? get().seed;
    worker?.terminate();
    set({ boot: "booting", error: null, seed: s, shiftNo: get().shiftNo + 1, phase: "briefing", speed: 0, snap: null, report: null, models: emptyModels(EPOCH_MS), selection: null, mode: "sim" });
    try {
      worker = new Worker(new URL("../worker/sim.worker.ts", import.meta.url), { type: "module" });
    } catch (err) {
      set({ boot: "error", error: err instanceof Error ? err.message : "Web Workers are not available in this browser." });
      return;
    }
    worker.onerror = (e) => set({ boot: "error", error: e.message || "The simulation worker crashed." });
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === "frame") {
        if (get().mode === "live") return;
        const models = m.events.length ? applyEvents(get().models, m.events) : get().models;
        set({ snap: m.snapshot, snapRecvAt: performance.now(), models, boot: "ready" });
      } else if (m.type === "ended") {
        set({ report: m.report, phase: "ended", speed: 0 });
        post({ type: "speed", value: 0 });
      } else if (m.type === "commandResult") {
        const cmd = pendingCmds.get(m.id);
        pendingCmds.delete(m.id);
        void cmd;
        const id = ++toastSeq;
        set((st) => ({ toasts: [...st.toasts.slice(-3), { id, text: m.result.message, ok: m.result.ok }] }));
        setTimeout(() => get().dismissToast(id), 4500);
      } else if (m.type === "error") {
        set({ boot: "error", error: m.message });
      }
    };
    post({ type: "init", seed: s });
  },

  begin: (speed = 10) => {
    set({ phase: "running", speed });
    post({ type: "speed", value: speed });
  },

  setSpeed: (s) => {
    if (get().mode === "live" || get().phase === "ended") return;
    set({ speed: s, phase: s > 0 && get().phase === "briefing" ? "running" : get().phase });
    post({ type: "speed", value: s });
  },

  send: (cmd) => {
    if (get().mode === "live" || get().phase !== "running") {
      const id = ++toastSeq;
      set((st) => ({ toasts: [...st.toasts.slice(-3), { id, text: "Actions work during a running simulated shift.", ok: false }] }));
      setTimeout(() => get().dismissToast(id), 3500);
      return;
    }
    const id = ++cmdSeq;
    pendingCmds.set(id, cmd);
    post({ type: "command", id, cmd });
  },

  select: (selection) => set({ selection }),
  focusBay: (bay) => set((st) => ({ focus: { bay, n: st.focus.n + 1 } })),
  setView: (view) => set({ view }),

  newShift: (seed) => {
    get().closeLive();
    get().init(seed);
  },

  openLive: (url) => {
    liveClient?.close();
    post({ type: "speed", value: 0 });
    const base = get().snap;
    set({
      mode: "live",
      speed: 0,
      phase: "running",
      report: null,
      models: emptyModels(0),
      snap: base ? { ...base, lots: [], vehicles: [], objectives: [], score: 0 } : base,
      live: { url, state: "connecting", received: 0, rejected: 0 },
    });
    let firstT = 0;
    liveClient = new LiveClient(url, {
      onState: (state, detail) => set((st) => ({ live: { ...st.live, state, detail } })),
      onRejected: (errs) => set((st) => ({ live: { ...st.live, rejected: st.live.rejected + errs.length, detail: errs[0] } })),
      onEvents: (events: FabEvent[]) => {
        const st = get();
        if (!firstT) {
          firstT = events[0].t;
          set({ models: emptyModels(firstT) });
        }
        const models = applyEvents(get().models, events);
        let snap = st.snap;
        if (snap) {
          const tools = snap.tools.map((t) => ({ ...t }));
          for (const ev of events) {
            if (ev.type === "equipment.state_changed") {
              const tv = tools.find((t) => t.id === ev.data.toolId);
              if (tv) {
                tv.state = ev.data.to;
                tv.reason = ev.data.reason ?? "";
                tv.lotId = ev.data.lotId ?? null;
                tv.recipe = ev.data.recipe ?? null;
              }
            }
          }
          const last = events[events.length - 1];
          snap = { ...snap, tools, t: (last.t - firstT) / 1000 };
        }
        set((s) => ({ models, snap, snapRecvAt: performance.now(), live: { ...s.live, received: s.live.received + events.length } }));
      },
    });
    liveClient.connect();
  },

  closeLive: () => {
    liveClient?.close();
    liveClient = null;
    if (get().mode === "live") set({ mode: "sim", live: { ...get().live, state: "off" } });
  },

  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),
}));

/** Interpolated shift time in seconds. Safe to call every frame. */
export function simNow(): number {
  const { snap, snapRecvAt, speed, mode } = useFab.getState();
  if (!snap) return 0;
  if (mode === "live") return snap.t;
  const dt = speed > 0 ? Math.min((performance.now() - snapRecvAt) / 1000, 0.3) * speed : 0;
  return Math.min(snap.shiftS, snap.t + dt);
}
