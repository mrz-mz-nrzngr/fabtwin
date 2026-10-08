import type { FabEvent } from "../../events/types";
import { SPC_SPECS } from "../../sim/config";
import { ToolAdapter, normaliseState } from "../adapter";
import type { Observation } from "../adapter";
import { DataType, decodePayload } from "./proto";
import type { Metric, Payload } from "./proto";
import { parseTopic } from "./topic";

/**
 * Sparkplug B to FabTwin events.
 *
 * What the Sparkplug specification fixes (topic layout, birth and death certificates, bdSeq, seq,
 * aliases, the Rebirth command) is implemented as the spec states it. What it leaves to the
 * application, the metric names, is FabTwin's own convention. See docs/VERIFICATION.md.
 *
 * Metric names read, case sensitive:
 *   State                  String, an E10 state name (PRODUCTIVE, STANDBY, ENGINEERING, SCHEDULED_DOWN, UNSCHEDULED_DOWN)
 *   LotId, Recipe, Route   String (Route is a FabTwin route id such as LOGIC-16, optional)
 *   StepIndex              Integer, zero based step of the route, optional
 *   Alarm/<CODE>           Boolean, true while the alarm is set (severity warning)
 *   Alarm/critical/<CODE>  Boolean, same with severity critical
 *   Alarm/info/<CODE>      Boolean, same with severity info
 *   Measurement/<PARAM>    Float or Double, PARAM is CD, OVL or THK; attached to the lot that completes next
 *
 * A device (DBIRTH, DDATA) is a tool and its device id is the tool id. An edge node that reports these
 * metrics itself, with no devices, is a tool named after the edge node.
 */

export interface MapperOptions {
  source?: string;
  /** Only messages of this group are used. Empty means all groups. */
  groupId?: string;
  /** Called when the mapper wants the edge node to republish its births (Node Control/Rebirth). */
  onRebirth?: (groupId: string, edgeNodeId: string) => void;
  now?: () => number;
}

export interface MapperStats {
  messages: number;
  decodeErrors: number;
  seqGaps: number;
  rebirthRequests: number;
  unknownAlias: number;
  staleDeaths: number;
  ignoredMetrics: number;
}

interface NodeMem {
  bdSeq: number | null;
  lastSeq: number | null;
  /** deviceId or "" for the node itself, to alias to name. */
  aliases: Map<string, Map<number, string>>;
  tools: Set<string>;
  online: boolean;
}

export const CODE_NODE_OFFLINE = "EDGE_NODE_OFFLINE";
export const CODE_DEVICE_OFFLINE = "DEVICE_OFFLINE";

export class SparkplugMapper {
  readonly stats: MapperStats = { messages: 0, decodeErrors: 0, seqGaps: 0, rebirthRequests: 0, unknownAlias: 0, staleDeaths: 0, ignoredMetrics: 0 };
  private nodes = new Map<string, NodeMem>();
  private adapter: ToolAdapter;
  private now: () => number;

  constructor(private readonly opts: MapperOptions = {}) {
    this.adapter = new ToolAdapter({ source: opts.source ?? "sparkplug" });
    this.now = opts.now ?? Date.now;
  }

  /** Online edge nodes, "group/node". */
  onlineNodes(): string[] {
    return [...this.nodes.entries()].filter(([, n]) => n.online).map(([k]) => k);
  }

  handle(topic: string, bytes: Uint8Array): { events: FabEvent[]; errors: string[] } {
    const tp = parseTopic(topic);
    if (!tp) return { events: [], errors: [] };
    if (this.opts.groupId && tp.groupId !== this.opts.groupId) return { events: [], errors: [] };
    if (tp.type === "NCMD" || tp.type === "DCMD") return { events: [], errors: [] };
    this.stats.messages++;
    let payload: Payload;
    try {
      payload = decodePayload(bytes);
    } catch (err) {
      this.stats.decodeErrors++;
      return { events: [], errors: [`${topic}: payload is not a Sparkplug B protobuf (${err instanceof Error ? err.message : "decode failed"})`] };
    }
    const key = `${tp.groupId}/${tp.edgeNodeId}`;
    const node = this.node(key);
    const t = payload.timestamp ?? this.now();
    const events: FabEvent[] = [];

    if (tp.type !== "NDEATH") this.checkSeq(tp.groupId, tp.edgeNodeId, node, payload, tp.type === "NBIRTH");

    switch (tp.type) {
      case "NBIRTH": {
        node.bdSeq = bdSeqOf(payload);
        node.online = true;
        node.aliases.set("", this.aliasTable(payload));
        for (const toolId of node.tools) events.push(...this.adapter.clearAlarm(toolId, CODE_NODE_OFFLINE, t));
        const hasToolMetrics = payload.metrics.some((m) => m.name === "State");
        if (hasToolMetrics) {
          node.tools.add(tp.edgeNodeId);
          events.push(...this.metrics(tp.edgeNodeId, payload.metrics, payload, t));
        }
        break;
      }
      case "NDEATH": {
        const bd = bdSeqOf(payload);
        if (node.bdSeq !== null && bd !== null && bd !== node.bdSeq) {
          this.stats.staleDeaths++;
          break;
        }
        node.online = false;
        for (const toolId of node.tools) events.push(...this.adapter.alarm(toolId, { t, code: CODE_NODE_OFFLINE, active: true, severity: "critical", text: `Edge node ${tp.edgeNodeId} is offline (NDEATH)` }));
        break;
      }
      case "DBIRTH": {
        const id = tp.deviceId!;
        node.tools.add(id);
        node.aliases.set(id, this.aliasTable(payload));
        events.push(...this.adapter.clearAlarm(id, CODE_DEVICE_OFFLINE, t));
        events.push(...this.adapter.clearAlarm(id, CODE_NODE_OFFLINE, t));
        events.push(...this.metrics(id, payload.metrics, payload, t, node, id));
        break;
      }
      case "DDEATH": {
        const id = tp.deviceId!;
        node.tools.add(id);
        events.push(...this.adapter.alarm(id, { t, code: CODE_DEVICE_OFFLINE, active: true, severity: "warning", text: `Device ${id} is offline (DDEATH)` }));
        break;
      }
      case "NDATA":
        events.push(...this.metrics(tp.edgeNodeId, payload.metrics, payload, t, node, ""));
        break;
      case "DDATA":
        node.tools.add(tp.deviceId!);
        events.push(...this.metrics(tp.deviceId!, payload.metrics, payload, t, node, tp.deviceId!));
        break;
    }
    return { events, errors: [] };
  }

  private node(key: string): NodeMem {
    let n = this.nodes.get(key);
    if (!n) {
      n = { bdSeq: null, lastSeq: null, aliases: new Map(), tools: new Set(), online: false };
      this.nodes.set(key, n);
    }
    return n;
  }

  private aliasTable(p: Payload): Map<number, string> {
    const m = new Map<number, string>();
    for (const x of p.metrics) if (x.alias !== undefined && x.name) m.set(x.alias, x.name);
    return m;
  }

  /** Sequence numbers run 0 to 255 and wrap (Sparkplug 3.0.0, section 6.4.x, payload seq rules). */
  private checkSeq(groupId: string, edgeNodeId: string, node: NodeMem, p: Payload, birth: boolean) {
    if (p.seq === undefined) return;
    if (birth) {
      node.lastSeq = p.seq;
      return;
    }
    const expected = node.lastSeq === null ? null : (node.lastSeq + 1) % 256;
    node.lastSeq = p.seq;
    // First sight of a node without its birth: we joined late, so ask it to republish (spec 5.x, optional for a host).
    if (expected === null && !node.online) return this.requestRebirth(groupId, edgeNodeId);
    if (expected !== null && p.seq !== expected) {
      this.stats.seqGaps++;
      this.requestRebirth(groupId, edgeNodeId);
    }
  }

  private requestRebirth(groupId: string, edgeNodeId: string) {
    this.stats.rebirthRequests++;
    this.opts.onRebirth?.(groupId, edgeNodeId);
  }

  private metrics(toolId: string, list: Metric[], p: Payload, t: number, node?: NodeMem, aliasKey?: string): FabEvent[] {
    const obs: Observation = { t };
    let touched = false;
    const events: FabEvent[] = [];
    const alarms: Array<Parameters<ToolAdapter["alarm"]>[1]> = [];
    for (const m of list) {
      let name = m.name;
      if (!name && m.alias !== undefined && node) name = node.aliases.get(aliasKey ?? "")?.get(m.alias);
      if (!name) {
        this.stats.unknownAlias++;
        const parts = [...this.nodes.entries()].find(([, v]) => v === node);
        if (parts) {
          const [g, n] = parts[0].split("/");
          this.requestRebirth(g, n);
        }
        continue;
      }
      const mt = m.timestamp ?? p.timestamp ?? t;
      if (name === "State") {
        const s = normaliseState(m.value);
        if (s) {
          obs.state = s;
          obs.t = mt;
          touched = true;
        } else this.stats.ignoredMetrics++;
      } else if (name === "LotId") {
        obs.lotId = typeof m.value === "string" ? m.value : null;
        touched = true;
      } else if (name === "Route") {
        obs.route = typeof m.value === "string" ? m.value : null;
        touched = true;
      } else if (name === "StepIndex") {
        obs.stepIndex = typeof m.value === "number" ? m.value : null;
        touched = true;
      } else if (name === "Recipe") {
        obs.recipe = typeof m.value === "string" ? m.value : null;
        touched = true;
      } else if (name.startsWith("Alarm/")) {
        const parts = name.split("/");
        const sev = parts.length === 3 && ["info", "warning", "critical"].includes(parts[1]) ? (parts[1] as "info" | "warning" | "critical") : "warning";
        const code = parts[parts.length - 1];
        if (typeof m.value === "boolean" && code) alarms.push({ t: mt, code, active: m.value, severity: sev, text: `${code} on ${toolId} (Sparkplug metric ${name})` });
        else this.stats.ignoredMetrics++;
      } else if (name.startsWith("Measurement/")) {
        const param = name.slice("Measurement/".length);
        const spec = SPC_SPECS.find((s) => s.param === param);
        if (spec && typeof m.value === "number" && (m.datatype === DataType.Float || m.datatype === DataType.Double || m.datatype === DataType.Unknown)) events.push(...this.adapter.measure(toolId, { t: mt, param, value: m.value, unit: spec.unit }));
        else this.stats.ignoredMetrics++;
      } else if (name !== "bdSeq" && !name.startsWith("Node Control/") && !name.startsWith("Device Control/")) {
        this.stats.ignoredMetrics++;
      }
    }
    for (const a of alarms) events.push(...this.adapter.alarm(toolId, a));
    if (touched) events.push(...this.adapter.observe(toolId, obs));
    return events;
  }
}

function bdSeqOf(p: Payload): number | null {
  const m = p.metrics.find((x) => x.name === "bdSeq");
  return m && typeof m.value === "number" ? m.value : null;
}
