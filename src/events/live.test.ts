import { describe, expect, it, vi } from "vitest";
import { LiveClient } from "./live";
import type { LiveState } from "./live";
import type { FabEvent } from "./types";

class FakeSocket {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
}

const ev = (seq: number): FabEvent => ({
  v: 1,
  seq,
  t: 1_700_000_000_000 + seq,
  source: "test",
  type: "equipment.state_changed",
  data: { toolId: "LTH-01", from: "STANDBY", to: "PRODUCTIVE" },
});

describe("LiveClient", () => {
  it("delivers valid events, rejects invalid ones, and reports state", () => {
    const sockets: FakeSocket[] = [];
    const states: LiveState[] = [];
    const got: FabEvent[] = [];
    const rejected: string[][] = [];
    const c = new LiveClient(
      "ws://x",
      { onEvents: (e) => got.push(...e), onState: (s) => states.push(s), onRejected: (r) => rejected.push(r) },
      () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    );
    c.connect();
    sockets[0].onopen?.({});
    sockets[0].onmessage?.({ data: JSON.stringify(ev(1)) });
    sockets[0].onmessage?.({ data: JSON.stringify([ev(2), { bad: true }]) });
    sockets[0].onmessage?.({ data: "not json" });
    expect(states).toEqual(["connecting", "open"]);
    expect(got.map((e) => e.seq)).toEqual([1, 2]);
    expect(rejected).toHaveLength(2);
  });

  it("reconnects with backoff after a drop, and stops when closed", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const c = new LiveClient(
      "ws://x",
      { onEvents: () => {}, onState: () => {} },
      () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      (n) => 100 * (n + 1),
    );
    c.connect();
    sockets[0].onclose?.({});
    vi.advanceTimersByTime(99);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(sockets).toHaveLength(2);
    sockets[1].onclose?.({});
    vi.advanceTimersByTime(150);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(60);
    expect(sockets).toHaveLength(3);
    c.close();
    sockets[2].onclose?.({});
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(3);
    vi.useRealTimers();
  });
});
