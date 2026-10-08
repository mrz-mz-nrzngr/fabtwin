export const NAMESPACE = "spBv1.0";

export type MessageType = "NBIRTH" | "NDEATH" | "DBIRTH" | "DDEATH" | "NDATA" | "DDATA" | "NCMD" | "DCMD" | "STATE";

const TYPES: readonly MessageType[] = ["NBIRTH", "NDEATH", "DBIRTH", "DDEATH", "NDATA", "DDATA", "NCMD", "DCMD", "STATE"];
const WITH_DEVICE = new Set<MessageType>(["DBIRTH", "DDEATH", "DDATA", "DCMD"]);

export interface ParsedTopic {
  type: MessageType;
  groupId: string;
  edgeNodeId: string;
  deviceId?: string;
}

/**
 * Splits a topic of the form namespace/group_id/message_type/edge_node_id/[device_id]
 * (Sparkplug 3.0.0, section 4.1). The device id is required for D* messages and forbidden otherwise.
 * STATE topics (spBv1.0/STATE/host_id) belong to host applications and return null here.
 */
export function parseTopic(topic: string): ParsedTopic | null {
  const p = topic.split("/");
  if (p[0] !== NAMESPACE || p.length < 4 || p.length > 5) return null;
  const type = p[2] as MessageType;
  if (!TYPES.includes(type) || type === "STATE") return null;
  const hasDevice = p.length === 5;
  if (hasDevice !== WITH_DEVICE.has(type)) return null;
  if (!p[1] || !p[3] || (hasDevice && !p[4])) return null;
  return { type, groupId: p[1], edgeNodeId: p[3], deviceId: hasDevice ? p[4] : undefined };
}

export function topicOf(t: ParsedTopic): string {
  return [NAMESPACE, t.groupId, t.type, t.edgeNodeId, ...(t.deviceId ? [t.deviceId] : [])].join("/");
}
