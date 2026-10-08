import { WebSocketServer } from "ws";
import type { FabEvent } from "../../src/events/types";

/**
 * A WebSocket server that publishes FabTwin events as { events: [...] } frames. A client that connects
 * late first receives the newest state of every tool, the lot each tool is running and the alarms that
 * are still set, so the console starts out knowing the fab as it is now.
 */
export class EventHub {
  readonly wss: WebSocketServer;
  private latestState = new Map<string, FabEvent>();
  private activeStart = new Map<string, FabEvent>();
  private activeAlarm = new Map<string, FabEvent>();
  forwarded = 0;

  constructor(port: number, onConnect?: (clients: number) => void, host = "127.0.0.1") {
    this.wss = new WebSocketServer({ port, host });
    this.wss.on("connection", (ws) => {
      const hello = [...this.latestState.values(), ...this.activeStart.values(), ...this.activeAlarm.values()];
      if (hello.length) ws.send(JSON.stringify({ events: hello }));
      onConnect?.(this.wss.clients.size);
    });
  }

  get clients() {
    return this.wss.clients.size;
  }

  publish(events: FabEvent[]) {
    if (!events.length) return;
    for (const e of events) {
      this.forwarded++;
      const d = e.data as unknown as { toolId?: string; alarmId?: string };
      if (e.type === "equipment.state_changed" && d.toolId) this.latestState.set(d.toolId, e);
      if (e.type === "lot.started" && d.toolId) this.activeStart.set(d.toolId, e);
      if (e.type === "lot.completed" && d.toolId) this.activeStart.delete(d.toolId);
      if (e.type === "alarm.set" && d.alarmId) this.activeAlarm.set(d.alarmId, e);
      if (e.type === "alarm.cleared" && d.alarmId) this.activeAlarm.delete(d.alarmId);
    }
    const frame = JSON.stringify({ events });
    for (const c of this.wss.clients) if (c.readyState === 1) c.send(frame);
  }

  close() {
    this.wss.close();
  }
}
