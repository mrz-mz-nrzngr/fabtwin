/**
 * OPC UA to FabTwin bridge. Connects to an OPC UA server as a client, finds the tools under a folder,
 * subscribes to their variables, and serves FabTwin schema v1 events over WebSocket. Point FabTwin's
 * live mode at ws://localhost:8788.
 *
 *   OPCUA_ENDPOINT=opc.tcp://localhost:48410/UA/FabTwin npm run bridge
 *
 * env: OPCUA_ROOT=FabTwin (browse name of the folder holding the tools)  WS_PORT=8788
 *      PUBLISH_MS=250  DURATION=0  OPCUA_TOOL_MAP='{"Press7":"ETC-01"}' (rename server objects to FabTwin tool ids)
 *      OPCUA_USER / OPCUA_PASSWORD (user name token)  OPCUA_SECURITY=None|SignAndEncrypt
 * The convention for variable names is in src/integrations/named.ts.
 */
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AttributeIds,
  BrowseDirection,
  ClientMonitoredItem,
  ClientSubscription,
  MessageSecurityMode,
  OPCUACertificateManager,
  OPCUAClient,
  SecurityPolicy,
  StatusCodes,
  TimestampsToReturn,
  UserTokenType,
} from "node-opcua";
import type { ClientSession, DataValue, UserIdentityInfo, MonitoringParametersOptions, ReferenceDescription } from "node-opcua";
import { EventHub } from "../../../scripts/lib/hub";
import { OpcUaMapper } from "../../../src/integrations/opcua/mapper";
import type { OpcValue } from "../../../src/integrations/opcua/mapper";

const ENDPOINT = process.env.OPCUA_ENDPOINT ?? "opc.tcp://localhost:48410/UA/FabTwin";
const ROOT = process.env.OPCUA_ROOT ?? "FabTwin";
const WS_PORT = Number(process.env.WS_PORT ?? 8788);
const PUBLISH_MS = Number(process.env.PUBLISH_MS ?? 250);
const DURATION = Number(process.env.DURATION ?? 0);
const TOOL_MAP: Record<string, string> = JSON.parse(process.env.OPCUA_TOOL_MAP ?? "{}");
const SECURE = (process.env.OPCUA_SECURITY ?? "None") === "SignAndEncrypt";
const say = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

const hub = new EventHub(WS_PORT, (n) => say(`FabTwin connected (${n} client${n === 1 ? "" : "s"})`));
const mapper = new OpcUaMapper("opcua");

async function browseChildren(session: ClientSession, nodeId: string | ReferenceDescription["nodeId"]): Promise<ReferenceDescription[]> {
  const r = await session.browse({ nodeId, referenceTypeId: "HierarchicalReferences", browseDirection: BrowseDirection.Forward, includeSubtypes: true, nodeClassMask: 0, resultMask: 63 });
  return r.references ?? [];
}

async function main() {
  const client = OPCUAClient.create({
    applicationName: "FabTwinBridge",
    clientCertificateManager: new OPCUACertificateManager({ rootFolder: process.env.OPCUA_PKI ?? join(tmpdir(), "fabtwin-opcua-pki-client"), automaticallyAcceptUnknownCertificate: true }),
    endpointMustExist: false,
    securityMode: SECURE ? MessageSecurityMode.SignAndEncrypt : MessageSecurityMode.None,
    securityPolicy: SECURE ? SecurityPolicy.Basic256Sha256 : SecurityPolicy.None,
    connectionStrategy: { initialDelay: 1000, maxDelay: 8000, maxRetry: 20 },
    keepSessionAlive: true,
  });
  client.on("connection_lost", () => {
    say("OPC UA connection lost, will retry");
    hub.publish(mapper.connectionLost(Date.now()));
  });
  client.on("connection_reestablished", () => {
    say("OPC UA connection re-established");
    hub.publish(mapper.connectionRestored(Date.now()));
  });
  say(`connecting to ${ENDPOINT} (security ${SECURE ? "Basic256Sha256 SignAndEncrypt" : "None"})`);
  await client.connect(ENDPOINT);
  const userIdentity: UserIdentityInfo | undefined = process.env.OPCUA_USER ? { type: UserTokenType.UserName, userName: process.env.OPCUA_USER, password: process.env.OPCUA_PASSWORD ?? "" } : undefined;
  const session = await client.createSession(userIdentity);
  say("session open");

  // Find the folder, then each tool object under it, then each variable under the tool.
  const objects = await browseChildren(session, "ns=0;i=85");
  const rootRef = objects.find((r) => r.browseName.name === ROOT);
  if (!rootRef) throw new Error(`No folder named ${ROOT} under Objects. Found: ${objects.map((o) => o.browseName.name).join(", ")}`);
  const toolRefs = await browseChildren(session, rootRef.nodeId);
  const items: Array<{ toolId: string; name: string; nodeId: string }> = [];
  for (const tr of toolRefs) {
    const toolId = TOOL_MAP[tr.browseName.name ?? ""] ?? tr.browseName.name ?? "";
    for (const vr of await browseChildren(session, tr.nodeId)) {
      if (vr.nodeClass === 2) items.push({ toolId, name: vr.browseName.name ?? "", nodeId: vr.nodeId.toString() });
    }
  }
  say(`found ${toolRefs.length} tools and ${items.length} variables under Objects/${ROOT}`);

  const sub = ClientSubscription.create(session, {
    requestedPublishingInterval: PUBLISH_MS,
    requestedLifetimeCount: 120,
    requestedMaxKeepAliveCount: 10,
    maxNotificationsPerPublish: 2000,
    publishingEnabled: true,
    priority: 10,
  });
  const params: MonitoringParametersOptions = { samplingInterval: 100, discardOldest: true, queueSize: 10 };
  for (const it of items) {
    const mi = ClientMonitoredItem.create(sub, { nodeId: it.nodeId, attributeId: AttributeIds.Value }, params, TimestampsToReturn.Both);
    mi.on("changed", (dv: DataValue) => {
      // isGoodish() is node-opcua's own helper (severity bits below 0x10000000), not a term from the specification.
      const good = dv.statusCode === undefined || dv.statusCode.isGoodish() || dv.statusCode === StatusCodes.Good;
      const raw = dv.value?.value as unknown;
      const value: OpcValue = typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string" ? raw : null;
      const t = dv.sourceTimestamp ? dv.sourceTimestamp.getTime() : Date.now();
      mapper.setValue(it.toolId, it.name, value, t, good);
    });
  }
  const flush = setInterval(() => hub.publish(mapper.flush(Date.now())), 100);
  say(`subscribed (publishing interval ${PUBLISH_MS} ms). FabTwin live mode: ws://localhost:${WS_PORT}`);

  const stats = setInterval(() => {
    const ignored = [...mapper.ignoredNames];
    say(`${hub.forwarded} events published to ${hub.clients} client(s)${ignored.length ? `; skipped names: ${ignored.join(", ")}` : ""}`);
  }, 10000);

  const stop = async () => {
    clearInterval(flush);
    clearInterval(stats);
    hub.close();
    try {
      await sub.terminate();
      await session.close();
      await client.disconnect();
    } catch {
      /* closing */
    }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  if (DURATION) setTimeout(stop, DURATION * 1000);
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
