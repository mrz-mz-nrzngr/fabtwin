import WebSocket from "ws";
import type { FabEvent } from "@/events/types";
import { LiveClient } from "@/events/live";
import type { SocketFactory } from "@/events/live";
import { LiveTwin } from "@/live/twin";
import { applyEvents, emptyModels } from "@/store/readmodels";
import type { ReadModels } from "@/store/readmodels";
import type { MesView } from "./mes";

/**
 * Server-side follower of a FabTwin event feed, for the API's `source=live`. It runs in the Node
 * process of a self-hosted server (`next start`). Serverless hosts do not keep such a process alive,
 * so a deployment there serves the simulation only. Configure with FABTWIN_LIVE_URLS.
 */
let twin: LiveTwin | null = null;
let models: ReadModels | null = null;
let clients: LiveClient[] = [];

function start(urls: string[]) {
  twin = new LiveTwin();
  for (const url of urls) {
    const c = new LiveClient(
      url,
      {
        onEvents: (events: FabEvent[]) => {
          twin!.apply(events);
          models = applyEvents(models ?? emptyModels(twin!.baseMs), events);
        },
        onState: () => undefined,
      },
      ((u: string) => new WebSocket(u)) as unknown as SocketFactory,
    );
    c.connect();
    clients.push(c);
  }
}

export function getLiveView(): MesView | null {
  const raw = process.env.FABTWIN_LIVE_URLS;
  if (!raw) return null;
  if (!twin) start(raw.split(",").map((u) => u.trim()).filter(Boolean));
  const snapshot = twin!.snapshot();
  return { source: "live", seed: null, t: snapshot.t, shiftS: snapshot.shiftS, baseMs: twin!.baseMs, snapshot, models: models ?? emptyModels(twin!.baseMs) };
}

export function stopLive() {
  clients.forEach((c) => c.close());
  clients = [];
  twin = null;
  models = null;
}
