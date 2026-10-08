import type { FabEvent } from "@/events/types";
import { LiveClient } from "@/events/live";
import type { LiveState } from "@/events/live";

/** What the console can listen to. Every source ends up as FabTwin schema v1 events. */
export type LiveKind = "ws" | "sparkplug";

export interface LiveConfig {
  kind: LiveKind;
  /** ws: one or more WebSocket URLs (comma separated in the dialog). sparkplug: the MQTT-over-WebSocket broker URL. */
  urls: string[];
  /** Sparkplug only. */
  sparkplug?: { groupId: string; topicFilter?: string; username?: string; password?: string };
}

export interface SourceHandlers {
  onEvents: (events: FabEvent[], sourceId: string) => void;
  onState: (sourceId: string, state: LiveState, detail?: string) => void;
  onRejected: (sourceId: string, errors: string[]) => void;
}

export interface LiveSource {
  readonly id: string;
  connect(): void;
  close(): void;
}

export function createWsSource(url: string, h: SourceHandlers): LiveSource {
  const client = new LiveClient(url, {
    onEvents: (events) => h.onEvents(events, url),
    onState: (state, detail) => h.onState(url, state, detail),
    onRejected: (errs) => h.onRejected(url, errs),
  });
  return { id: url, connect: () => client.connect(), close: () => client.close() };
}

export function parseUrls(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean);
}

export function validUrls(urls: string[], schemes: RegExp = /^wss?:\/\/.+/): boolean {
  return urls.length > 0 && urls.every((u) => schemes.test(u));
}
