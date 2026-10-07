import { parseFrame } from "./validate";
import type { FabEvent } from "./types";

export type LiveState = "connecting" | "open" | "closed" | "error";

export interface LiveHandlers {
  onEvents: (events: FabEvent[]) => void;
  onState: (state: LiveState, detail?: string) => void;
  onRejected?: (errors: string[]) => void;
}

interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

/**
 * Optional live mode. Connects to a WebSocket that sends FabTwin events (schema v1),
 * validates every frame, and reconnects with exponential backoff. Anything that fails
 * validation is reported and dropped, never half-applied.
 */
export class LiveClient {
  private socket: SocketLike | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(
    private readonly url: string,
    private readonly handlers: LiveHandlers,
    private readonly factory: SocketFactory = (u) => new WebSocket(u) as unknown as SocketLike,
    private readonly backoffMs: (attempt: number) => number = (n) => Math.min(15000, 500 * 2 ** n),
  ) {}

  connect() {
    this.stopped = false;
    this.open();
  }

  close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
    this.handlers.onState("closed");
  }

  private open() {
    this.handlers.onState("connecting");
    let socket: SocketLike;
    try {
      socket = this.factory(this.url);
    } catch (err) {
      this.handlers.onState("error", err instanceof Error ? err.message : "could not open socket");
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.retry = 0;
      this.handlers.onState("open");
    };
    socket.onmessage = (ev) => {
      let raw: unknown;
      try {
        raw = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      } catch {
        this.handlers.onRejected?.(["frame is not valid JSON"]);
        return;
      }
      const { events, errors } = parseFrame(raw);
      if (errors.length) this.handlers.onRejected?.(errors);
      if (events.length) this.handlers.onEvents(events);
    };
    socket.onerror = () => this.handlers.onState("error", "socket error");
    socket.onclose = () => {
      if (this.stopped) return;
      this.handlers.onState("closed", "connection lost");
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.open(), this.backoffMs(this.retry++));
  }
}
