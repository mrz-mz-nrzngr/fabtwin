/**
 * A stand-in for the future SECS/GEM bridge. It runs the simulator and broadcasts its events
 * over a WebSocket in the FabTwin event schema, so live mode can be tried without equipment.
 *
 *   npm run mock-live          ws://localhost:8787, 30x speed
 *   PORT=9000 SPEED=120 npm run mock-live
 */
import { WebSocketServer } from "ws";
import { buildConfig } from "../src/sim/config";
import { FabEngine } from "../src/sim/engine";

const port = Number(process.env.PORT ?? 8787);
const speed = Number(process.env.SPEED ?? 30);
const seed = Number(process.env.SEED ?? 7);

const wss = new WebSocketServer({ port });
const engine = new FabEngine(buildConfig(seed));
const backlog = engine.drainEvents();
let last = Date.now();

setInterval(() => {
  const now = Date.now();
  engine.advanceTo(engine.now + ((now - last) / 1000) * speed);
  last = now;
  const events = engine.drainEvents();
  backlog.push(...events);
  if (!events.length) return;
  const frame = JSON.stringify({ events });
  for (const c of wss.clients) if (c.readyState === 1) c.send(frame);
  if (engine.ended) {
    console.log("Shift finished. Restart the script for another run.");
    process.exit(0);
  }
}, 250);

wss.on("connection", (ws) => {
  // A late joiner first receives the current state of every tool, then the live stream.
  const state = backlog.filter((e) => e.type === "equipment.state_changed");
  const latest = new Map<string, (typeof state)[number]>();
  for (const e of state) if (e.type === "equipment.state_changed") latest.set(e.data.toolId, e);
  ws.send(JSON.stringify({ events: [...latest.values()] }));
  console.log(`client connected, ${wss.clients.size} total`);
});

console.log(`FabTwin mock live feed on ws://localhost:${port} (seed ${seed}, ${speed}x)`);
