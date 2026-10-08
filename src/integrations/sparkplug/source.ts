import mqtt from "mqtt";
import type { LiveConfig, LiveSource, SourceHandlers } from "@/live/sources";
import { SparkplugMapper } from "./mapper";
import { DataType, encodePayload } from "./proto";

/**
 * Browser-side Sparkplug B subscriber. Connects to an MQTT broker over WebSocket (ws:// or wss://),
 * subscribes to spBv1.0/<group>/#, decodes every message and hands FabTwin events to the console.
 *
 * This is a passive viewer, not a Sparkplug Host Application: it does not publish a STATE message
 * and never claims to be the primary host. It only publishes Node Control/Rebirth requests, which the
 * spec allows any host to send, so that nodes republish their births for a late joiner.
 */
export function createSparkplugSource(config: LiveConfig, h: SourceHandlers): LiveSource {
  const url = config.urls[0];
  const id = url;
  const group = config.sparkplug?.groupId?.trim() ?? "";
  const filter = config.sparkplug?.topicFilter?.trim() || (group ? `spBv1.0/${group}/#` : "spBv1.0/#");
  let client: mqtt.MqttClient | null = null;
  const lastRebirth = new Map<string, number>();

  const mapper = new SparkplugMapper({
    groupId: group || undefined,
    onRebirth: (g, n) => {
      const key = `${g}/${n}`;
      const now = Date.now();
      if (now - (lastRebirth.get(key) ?? 0) < 5000) return;
      lastRebirth.set(key, now);
      const body = encodePayload({ timestamp: now, metrics: [{ name: "Node Control/Rebirth", datatype: DataType.Boolean, timestamp: now, value: true }] });
      client?.publish(`spBv1.0/${g}/NCMD/${n}`, body as unknown as Buffer, { qos: 0 });
    },
  });

  return {
    id,
    connect() {
      h.onState(id, "connecting");
      client = mqtt.connect(url, {
        clientId: `fabtwin-${Math.random().toString(16).slice(2, 10)}`,
        reconnectPeriod: 2000,
        connectTimeout: 8000,
        username: config.sparkplug?.username || undefined,
        password: config.sparkplug?.password || undefined,
      });
      client.on("connect", () => {
        client?.subscribe(filter, { qos: 0 }, (err) => {
          if (err) h.onState(id, "error", `subscribe failed: ${err.message}`);
          else h.onState(id, "open", `subscribed to ${filter}`);
        });
      });
      client.on("reconnect", () => h.onState(id, "connecting", "reconnecting"));
      client.on("close", () => h.onState(id, "closed", "connection closed"));
      client.on("error", (e) => h.onState(id, "error", e.message));
      client.on("message", (topic, payload) => {
        const { events, errors } = mapper.handle(topic, payload);
        if (errors.length) h.onRejected(id, errors);
        if (events.length) h.onEvents(events, id);
      });
    },
    close() {
      client?.end(true);
      client = null;
      h.onState(id, "closed");
    },
  };
}
