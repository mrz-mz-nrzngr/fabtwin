/**
 * Every input and output of FabTwin, with the tier it has earned and how to run it.
 * The Integrations page renders this, and a test checks it against package.json and the docs,
 * so the page cannot promise a command that does not exist.
 */
export type Tier = "live-tested" | "hardware-ready" | "account-ready" | "not-proven";

export const TIER_LABEL: Record<Tier, string> = {
  "live-tested": "Live-tested",
  "hardware-ready": "Hardware-ready",
  "account-ready": "Account-ready",
  "not-proven": "Not proven",
};

export const TIER_MEANING: Record<Tier, string> = {
  "live-tested": "Run end to end against a real server or peer on this machine, and the run is recorded.",
  "hardware-ready": "Tested against a simulator of the device, with the edge code for the real device included.",
  "account-ready": "Written against a published SaaS API with recorded fixtures, with setup steps for your own account.",
  "not-proven": "Written but not yet run against anything. Do not rely on it.",
};

export interface Integration {
  id: string;
  direction: "input" | "output";
  name: string;
  protocol: string;
  tier: Tier;
  summary: string;
  /** What the tier does and does not prove. */
  scope: string;
  steps: Array<{ text: string; command?: string }>;
  /** Names of npm scripts the steps use, checked against package.json. */
  scripts: string[];
  /** Where the recorded run lives in the repository. */
  proof?: string;
  /** Links that work inside the running app. */
  links?: Array<{ label: string; href: string }>;
}

export const INTEGRATIONS: Integration[] = [
  {
    id: "gem",
    direction: "input",
    name: "SECS/GEM equipment, fab in a box",
    protocol: "SECS-II over HSMS (TCP), GemBench simulators, FabTwin bridge to WebSocket",
    tier: "hardware-ready",
    summary: "Eight GemBench equipment simulators (litho, etch, deposition, CMP, metrology) speak real HSMS to a MES host. GemBench's bridge turns what they do into schema v1 events, the host adds route knowledge, and live mode shows tool states, alarms, lots, KPIs and FOUP motion.",
    scope: "Proven against eight GemBench equipment simulators, each its own process on its own TCP port: the HSMS and GEM conversation (S1F13, S1F17, S2F41, S1F3), tool faults, and the whole path into the console. The host and bridge are the code a real tool would talk to. Not proven: a physical tool, or any vendor's HSMS implementation. GemBench is written by the same author and is not certified by SEMI.",
    steps: [
      { text: "Install the .NET 10 SDK, git and Node 22, then install this repo's packages.", command: "npm ci" },
      { text: "The script uses the GemBench checkout next to this repo (../gembench), or the one you name. It clones that into a temporary folder, builds it in Release, starts eight equipment processes and the host. With no checkout it stops and says how to set GEMBENCH_REPO.", command: "GEMBENCH_REPO=/path/to/gembench npm run fab-in-a-box" },
      { text: "In the console choose Live mode, source WebSocket events, URL ws://localhost:8787, Connect." },
      { text: "To stop, press Ctrl+C in the terminal. The script ends the equipment processes it started." },
    ],
    scripts: ["fab-in-a-box"],
    proof: "docs/integration-runs.md, section Fab in a box",
  },
  {
    id: "sparkplug",
    direction: "input",
    name: "Sparkplug B over MQTT",
    protocol: "MQTT 3.1.1 over WebSocket from the browser, Sparkplug B protobuf payloads",
    tier: "live-tested",
    summary: "The browser subscribes to spBv1.0/<group>/#, decodes births, data and deaths, resolves aliases, checks sequence numbers and asks a node to rebirth when it joins late. Devices become tools, metrics become states, lots, alarms and SPC measurements.",
    scope: "Proven against Mosquitto 2.1.2 through its WebSocket listener, fed by an edge-node simulator that sends births, data, a bdSeq and an NDEATH will, including a dropped node and its rebirth. The payload codec was also checked both ways against the Eclipse Tahu JavaScript library. Not proven: a physical Sparkplug edge node, a Sparkplug-certified product, or another broker. The viewer is passive: it is not a primary host application and publishes no STATE.",
    steps: [
      { text: "Start Mosquitto with the config in this repo (plain MQTT on 18830, WebSocket on 18831, anonymous, loopback only).", command: "mosquitto -c integrations/mosquitto/fabtwin.conf" },
      { text: "Start the edge-node simulator. Add KILL_NODE=Etch KILL_AT=40 REVIVE_AT=70 to see an NDEATH and a rebirth.", command: "npm run sparkplug-sim" },
      { text: "In the console choose Live mode, source Sparkplug B over MQTT, broker ws://localhost:18831, group FabTwin, Connect." },
      { text: "For your own devices: publish to spBv1.0/<group>/DDATA/<edge node>/<tool id> with the metrics State, LotId, Recipe, Route, StepIndex, Alarm/<CODE> and Measurement/<CD|OVL|THK>. The tool id must be one of the 24 on this floor." },
    ],
    scripts: ["sparkplug-sim"],
    proof: "docs/integration-runs.md, section Sparkplug B",
  },
  {
    id: "opcua",
    direction: "input",
    name: "OPC UA",
    protocol: "OPC UA binary (opc.tcp), node-opcua client, subscriptions, WebSocket out",
    tier: "hardware-ready",
    summary: "A small Node service connects to an OPC UA server, browses the tools under a folder, subscribes to their variables and serves schema v1 events on ws://localhost:8788. Bad status codes and a lost connection become alarms.",
    scope: "Proven against a sample server built on the same node-opcua library, which stands in for a tool's OPC UA server: 12 tools and 90 variables, a server stop and a restart with the alarms raised and cleared. Not proven: a PLC or an industrial OPC UA server from another vendor, or the SignAndEncrypt mode against one. The bridge is the edge service for a real server: set OPCUA_ENDPOINT and OPCUA_ROOT.",
    steps: [
      { text: "Install the bridge's own packages.", command: "npm --prefix services/opcua-bridge ci" },
      { text: "Start the sample server on opc.tcp://localhost:48410/UA/FabTwin.", command: "npm run opcua-sample-server" },
      { text: "Start the bridge.", command: "npm run opcua-bridge" },
      { text: "In the console choose Live mode, source WebSocket events, URL ws://localhost:8788, Connect." },
      { text: "For your own server set OPCUA_ENDPOINT and OPCUA_ROOT (the folder under Objects that holds one object per tool). Variables use the same names as the Sparkplug metrics, with dots for slashes. OPCUA_TOOL_MAP renames server objects to tool ids." },
    ],
    scripts: ["opcua-sample-server", "opcua-bridge"],
    proof: "docs/integration-runs.md, section OPC UA",
  },
  {
    id: "ws",
    direction: "input",
    name: "Event WebSocket, schema v1",
    protocol: "WebSocket, JSON frames",
    tier: "live-tested",
    summary: "Any producer that sends FabTwin events works: one event, an array, or { events: [...] }. Every frame is validated, invalid ones are counted and dropped, and the client reconnects with backoff. Several URLs can be merged.",
    scope: "Proven by the live client's tests and by every run on this page. The schema is versioned and has a JSON Schema.",
    steps: [
      { text: "Replay a simulated shift at 30 times speed.", command: "npm run mock-live" },
      { text: "In the console choose Live mode, source WebSocket events, URL ws://localhost:8787, Connect." },
    ],
    scripts: ["mock-live"],
    proof: "docs/EVENT_SCHEMA.md and the tests in src/events",
  },
  {
    id: "rest",
    direction: "output",
    name: "MES REST API",
    protocol: "HTTP GET, JSON, OpenAPI 3.1",
    tier: "live-tested",
    summary: "Lots, one lot with its genealogy, WIP by step, tool states, alarms and KPIs, as Next.js route handlers. By default it serves the deterministic simulation for a seed and a time t, and every response says meta.simulated. With FABTWIN_LIVE_URLS set on a self-hosted server, source=live serves state derived from a live feed.",
    scope: "Proven by tests that validate every response against the OpenAPI schemas, and by curl against the production build. Read-only, no authentication: it serves simulated data. Serverless hosts serve the simulation only.",
    steps: [
      { text: "Run the production build.", command: "npm run build && npm start" },
      { text: "Ask for KPIs two simulated hours into seed 1.", command: "curl 'http://localhost:3000/api/v1/kpis?seed=1&t=7200'" },
    ],
    scripts: ["build", "start", "openapi"],
    proof: "docs/integration-runs.md, section MES API and exports",
    links: [
      { label: "OpenAPI description", href: "/api/v1/openapi.json" },
      { label: "Tools at t=7200", href: "/api/v1/tools?seed=1&t=7200" },
      { label: "WIP by step", href: "/api/v1/wip?seed=1&t=7200" },
    ],
  },
  {
    id: "export",
    direction: "output",
    name: "CSV and JSON exports",
    protocol: "HTTP GET, RFC 4180 CSV",
    tier: "live-tested",
    summary: "Lot history (every genealogy entry, or one lot) and the full shift report with the autopilot comparison, as CSV or JSON. The shift report can also be downloaded from the console after a shift.",
    scope: "Proven by tests that parse the CSV and by curl against the production build.",
    steps: [{ text: "Download from the links below, or with curl.", command: "curl -OJ 'http://localhost:3000/api/v1/exports/lot-history.csv?seed=1&t=7200'" }],
    scripts: ["start"],
    proof: "docs/integration-runs.md, section MES API and exports",
    links: [
      { label: "lot-history.csv", href: "/api/v1/exports/lot-history.csv?seed=1&t=7200" },
      { label: "lot-history.json, lot L0001", href: "/api/v1/exports/lot-history.json?seed=1&t=7200&lot=L0001" },
      { label: "shift-report.csv", href: "/api/v1/exports/shift-report.csv?seed=1" },
      { label: "shift-report.json", href: "/api/v1/exports/shift-report.json?seed=1" },
    ],
  },
  {
    id: "stream",
    direction: "output",
    name: "Event stream from the bridges",
    protocol: "WebSocket, JSON frames (schema v1)",
    tier: "live-tested",
    summary: "The fab-in-a-box host and the OPC UA bridge each serve the events they produce, so any other consumer (a historian, a script, a second console) can follow the same feed. A client that joins late first receives the latest state of every tool and the alarms still set.",
    scope: "Proven with the headless probe, which runs the same client code as the browser.",
    steps: [{ text: "Follow a feed from a terminal for 30 seconds.", command: "npm run live-probe -- ws ws://localhost:8787 30" }],
    scripts: ["live-probe"],
    proof: "docs/integration-runs.md, section Fab in a box",
  },
  {
    id: "compose",
    direction: "input",
    name: "Docker compose plant in a box",
    protocol: "docker compose",
    tier: "not-proven",
    summary: "Not written. Docker Desktop was not available while this was built, so every source above runs as a native process, and nothing here claims a container image works.",
    scope: "No compose file exists in this repository.",
    steps: [{ text: "Use the commands above. Each source is one or two native processes." }],
    scripts: [],
  },
];
