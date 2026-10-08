import type { FabEvent } from "../../events/types";
import { ToolAdapter } from "../adapter";
import { applyNamedValues } from "../named";
import type { NamedValue } from "../named";

/**
 * OPC UA data changes to FabTwin events. The OPC UA side (sessions, subscriptions, monitored items) lives
 * in services/opcua-bridge; this class is the pure part: it batches the values that arrive within one
 * publish for a tool and turns them into events through the shared convention (src/integrations/named.ts).
 *
 * Quality: a data change whose StatusCode is not Good does not update the tool. It raises OPCUA_BAD_QUALITY
 * on the tool until every variable is Good again (OPC 10000-4 sections 7.11.5 and 7.38; Uncertain counts as not Good here, a design decision).
 * Connection: when the session is lost, OPCUA_CONNECTION_LOST is set on every known tool, and cleared on reconnect.
 */
export const CODE_BAD_QUALITY = "OPCUA_BAD_QUALITY";
export const CODE_CONNECTION_LOST = "OPCUA_CONNECTION_LOST";

export type OpcValue = number | boolean | string | null;

interface Pending {
  values: Map<string, NamedValue>;
}

export class OpcUaMapper {
  private adapter: ToolAdapter;
  private pending = new Map<string, Pending>();
  private bad = new Map<string, Set<string>>();
  private known = new Set<string>();
  private lost = false;
  ignoredNames = new Set<string>();

  constructor(source = "opcua") {
    this.adapter = new ToolAdapter({ source });
  }

  /** "Alarm.critical.X" and "Alarm/critical/X" mean the same. */
  static name(browseName: string): string {
    return browseName.replace(/\./g, "/");
  }

  setValue(toolId: string, browseName: string, value: OpcValue, t: number, good = true) {
    this.known.add(toolId);
    const name = OpcUaMapper.name(browseName);
    const bad = this.bad.get(toolId) ?? new Set<string>();
    if (!good) {
      bad.add(name);
      this.bad.set(toolId, bad);
      this.mark(toolId, t, true, `${name} has a bad OPC UA status`);
      return;
    }
    if (bad.delete(name) && bad.size === 0) this.mark(toolId, t, false, "");
    const p = this.pending.get(toolId) ?? { values: new Map<string, NamedValue>() };
    p.values.set(name, { name, value, t });
    this.pending.set(toolId, p);
  }

  private queued: FabEvent[] = [];
  private mark(toolId: string, t: number, active: boolean, text: string) {
    this.queued.push(...this.adapter.alarm(toolId, { t, code: CODE_BAD_QUALITY, active, severity: "warning", text: `${toolId}: ${text}` }));
  }

  /** Emit events for everything buffered. Call it once per publish or on a short timer. */
  flush(now: number): FabEvent[] {
    const out = this.queued;
    this.queued = [];
    for (const [toolId, p] of this.pending) {
      const list = [...p.values.values()];
      const t = list.reduce((m, v) => Math.max(m, v.t ?? now), 0) || now;
      const r = applyNamedValues(this.adapter, toolId, list, t);
      for (const n of r.ignored) this.ignoredNames.add(n);
      out.push(...r.events);
    }
    this.pending.clear();
    return out;
  }

  connectionLost(now: number): FabEvent[] {
    if (this.lost) return [];
    this.lost = true;
    return [...this.known].flatMap((id) => this.adapter.alarm(id, { t: now, code: CODE_CONNECTION_LOST, active: true, severity: "critical", text: `OPC UA connection to the server was lost` }));
  }

  connectionRestored(now: number): FabEvent[] {
    if (!this.lost) return [];
    this.lost = false;
    return [...this.known].flatMap((id) => this.adapter.alarm(id, { t: now, code: CODE_CONNECTION_LOST, active: false }));
  }
}
