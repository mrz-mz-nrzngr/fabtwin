/// <reference lib="webworker" />
import { buildConfig } from "@/sim/config";
import { FabEngine } from "@/sim/engine";
import { buildReport } from "@/sim/report";
import type { FromWorker, ToWorker } from "./protocol";

/**
 * Hosts one FabEngine and advances it in real time at the requested speed.
 * The engine is event-driven, so chopping time into 40 ms ticks changes nothing about the result.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FromWorker) => ctx.postMessage(m);

let engine: FabEngine | null = null;
let speed = 0;
let last = performance.now();
let lastPost = 0;
let reported = false;
let timer: ReturnType<typeof setInterval> | null = null;

function frame(force = false) {
  if (!engine) return;
  const events = engine.drainEvents();
  const now = performance.now();
  if (!force && events.length === 0 && now - lastPost < 100) return;
  lastPost = now;
  post({ type: "frame", snapshot: engine.snapshot(), events });
  if (engine.ended && !reported) {
    reported = true;
    post({ type: "ended", report: buildReport(engine) });
  }
}

function tick() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (engine && speed > 0 && !engine.ended) engine.advanceTo(engine.now + dt * speed);
  frame();
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case "init":
        engine = new FabEngine(buildConfig(m.seed));
        speed = 0;
        reported = false;
        last = performance.now();
        frame(true);
        if (!timer) timer = setInterval(tick, 40);
        break;
      case "speed":
        speed = m.value;
        last = performance.now();
        break;
      case "command":
        if (engine) {
          const result = engine.apply(m.cmd);
          post({ type: "commandResult", id: m.id, result });
          frame(true);
        }
        break;
      case "dispose":
        if (timer) clearInterval(timer);
        timer = null;
        engine = null;
        break;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
