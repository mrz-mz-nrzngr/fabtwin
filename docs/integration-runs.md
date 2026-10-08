# Integration runs

Recorded on 2026-10-08, between 09:30 and 09:40 UTC (16:30 to 16:40 in Jakarta), on one macOS machine, from a clean tree at FabTwin commit `51e479b` plus the working-tree changes of that day. Every integration below was run end to end, and the raw output is kept in [docs/runs/](runs/). Home paths and the host name are replaced with `<workspace>`, `<tmp>` and `<host>`.

Versions: Node 22.22.0, Next.js 16.4.0, mqtt 5.16.0, protobufjs 8.8.0, ws 8.22.0, node-opcua 2.186.17, .NET SDK 10.0.203, Mosquitto 2.1.2 (Homebrew), GemBench commit `fa50479`.

How the tiers are assigned (definitions in `docs/depth-pass.md` of the factory workspace, repeated on the Integrations page):

- **Live-tested**: run against a real server that is not our own code.
- **Hardware-ready**: run against a simulator of the device, with the edge code for the real device included.
- **Account-ready**: a SaaS API with recorded fixtures. None of FabTwin's integrations is in this tier.

The Integrations page renders `src/integrations/catalog.ts`. A test in `src/integrations/catalog.test.ts` pins each integration's tier and checks that the `Tier (id): ...` line in this file says the same.

| Integration | Tier | What it ran against |
|---|---|---|
| SECS/GEM equipment, fab in a box | Hardware-ready | 8 GemBench equipment simulators, one process each, real HSMS over TCP |
| Event stream from the bridges | Live-tested | the headless probe (the browser's client code) following the fab-in-a-box hub |
| Sparkplug B over MQTT | Live-tested | Mosquitto 2.1.2, plain MQTT and MQTT over WebSocket |
| OPC UA | Hardware-ready | a node-opcua sample server standing in for a tool's OPC UA server |
| MES REST API | Live-tested | curl against `next start` of the production build |
| CSV and JSON exports | Live-tested | curl against the same server |
| Event WebSocket, schema v1 | Live-tested | every run below, plus the client tests in `src/events` |
| Docker compose plant in a box | Not proven | not written; Docker was not used |

Why OPC UA and SECS/GEM are not "live-tested": the other end is a simulator we wrote (the OPC UA server uses the same library as the client, GemBench has the same author). Mosquitto is independent software, so the Sparkplug run earns the higher tier, but its edge node is still our simulator.

## Fab in a box

Tier (gem): Hardware-ready.
Tier (stream): Live-tested.

Fresh clone of GemBench, built and run by the script, with the headless probe as the consumer.

```
$ FABBOX_WORK=<tmp>/gembench-fresh GEMBENCH_REPO=<workspace>/projects/gembench DURATION=75 bash scripts/fab-in-a-box.sh
GemBench source: <workspace>/projects/gembench
GemBench commit: fa50479 at <tmp>/gembench-fresh

Build succeeded.
    0 Warning(s)
    0 Error(s)
Time Elapsed 00:00:05.23
[09:30:46] started 8 GemBench equipment simulators (HSMS ports 5101-5108), config in <tmpdir>/fabtwin-fab-in-a-box
[09:30:46] all equipment selected and online (S1F13, S1F17), control state Online Remote
[09:30:46] MES flow running. FabTwin live mode: ws://localhost:8787
[09:31:02] FabTwin connected to the hub (1 client)
[09:31:40] LTH-02 chamber fault raised (S2F41, HCACK 0)
[09:32:02] LTH-02 chamber fault cleared (S2F41, HCACK 0)
[09:32:06] duration reached, stopping
```

The probe ran for 40 seconds against `ws://127.0.0.1:8787` (`npx tsx scripts/live-probe.ts ws ws://127.0.0.1:8787 40`). It uses the same source and `LiveTwin` code as the browser:

```
t=5s  events {"equipment.state_changed":9,"lot.started":2,"collection_event":2} rejected 0 | tools {"PRODUCTIVE":2,"STANDBY":22} | wip 2 ...
t=25s events {"equipment.state_changed":18,"lot.started":7,"collection_event":12,"lot.completed":4} rejected 0 | tools {"PRODUCTIVE":3,"STANDBY":21} | wip 3 ... spc 1/0/0
  alarm.set ChamberFault on LTH-02 (critical)
t=40s events {"equipment.state_changed":28,"lot.started":12,"collection_event":22,"lot.completed":8,"alarm.set":1} rejected 0 | tools {"PRODUCTIVE":4,"UNSCHEDULED_DOWN":1,"STANDBY":19} | wip 4 ...
```

What this shows: the host completed the HSMS select, S1F13 and S1F17 with eight separate equipment processes, dispatched START and FINISH with S2F41, read metrology results with S1F3, and raised and cleared a fault through GemBench's test stimulus. The events arrived at a second client with none rejected, and the headless twin showed the faulted tool as unscheduled down. After the run, no `gembench.dll` process was left.

Not shown: a lot shipping. Lots take 12 to 20 steps of 10 seconds each, so 75 seconds ends with `shipped 0`. KPIs derived from shipped lots need a longer run (`DURATION=0` runs until Ctrl+C).

Without a GemBench checkout the script stops with a message (script copied to a folder with no sibling `gembench`):

```
$ env -u GEMBENCH_REPO -u GEMBENCH_DIR bash scripts/fab-in-a-box.sh
No GemBench checkout found at <tmp>/nolayout/fabtwin/../gembench.
Set GEMBENCH_REPO to a GemBench git URL or local path, or GEMBENCH_DIR to a built checkout.
exit 2
```

Raw files: `runs/fab-in-a-box-host.log`, `runs/fab-in-a-box-probe.log`, `runs/fab-in-a-box-no-checkout.log`.

## Sparkplug B

Tier (sparkplug): Live-tested.

Mosquitto 2.1.2 with the repo config `integrations/mosquitto/fabtwin.conf` (plain MQTT on 18830, MQTT over WebSocket on 18831, anonymous, loopback). Started at 09:34:30 UTC. Three processes talked to it:

1. `scripts/sparkplug-edge-sim.ts` with `KILL_NODE=Etch KILL_AT=30 REVIVE_AT=55 DURATION=80`: five edge nodes, twelve devices, an NDEATH will message per node.
2. `mosquitto_sub -p 18830 -t 'spBv1.0/#'` as an independent observer of the topics.
3. `scripts/live-probe.ts sparkplug ws://127.0.0.1:18831 75 FabTwin`, which runs `createSparkplugSource` (mqtt.js over WebSocket) and the same mapper and `LiveTwin` the browser uses.

Topic trace from the observer (local time, UTC+7):

```
2026-10-08T16:34:32+0700 spBv1.0/FabTwin/NBIRTH/Litho   (and Etch, Dep, Cmp, Metro)
2026-10-08T16:34:42+0700 spBv1.0/FabTwin/NCMD/Litho     rebirth requests from the late-joining viewer
2026-10-08T16:34:42+0700 spBv1.0/FabTwin/NCMD/Etch
2026-10-08T16:35:02+0700 spBv1.0/FabTwin/NDEATH/Etch    the Will Message, 30 s after the drop
```

Edge simulator:

```
[Etch] connection dropped without DISCONNECT, the broker publishes the NDEATH will
[Etch] connected, NBIRTH bdSeq=1
done after 80 s, 0 lots shipped by the flow
```

Probe: one NDEATH produced one `alarm.set EDGE_NODE_OFFLINE` per Etch tool (ETC-01, ETC-02, ETC-03, critical), and the new NBIRTH cleared all three:

```
  alarm.set EDGE_NODE_OFFLINE on ETC-01 (critical)   (also ETC-02, ETC-03)
t=50s events {... "alarm.set":3} rejected 0
  alarm.cleared EDGE_NODE_OFFLINE on ETC-01          (also ETC-02, ETC-03)
t=75s events {"equipment.state_changed":48,"lot.started":23,"lot.completed":17,"alarm.set":3,"alarm.cleared":3} rejected 0 | tools {"STANDBY":18,"PRODUCTIVE":6} ...
```

A defect found by this run and fixed: the first attempt (`runs/sparkplug-edge-sim-before-fix.log`) flapped, because the simulator kept re-dropping the revived node every second (it only checked that the node was alive and the clock past `KILL_AT`). That produced 54 alarms instead of 3. The simulator now drops a node once. The broker, the mapper and the probe behaved correctly in both runs. The mapper's stale-NDEATH rule (a death whose bdSeq does not match the latest birth is ignored) is covered by the unit tests.

Payload cross-check against an independent implementation: `sparkplug-payload` 1.0.3 (Eclipse Tahu's JavaScript library, EPL-2.0), installed outside the repo. A payload it encoded decoded in FabTwin's codec with the same names, types, values, `seq` and timestamps, and a payload FabTwin encoded decoded in Tahu's with the same content (`runs/sparkplug-tahu-crosscheck.log`). Tahu is not a dependency of FabTwin.

Raw files: `runs/sparkplug-mosquitto.log`, `runs/sparkplug-mosquitto_sub-topics.log`, `runs/sparkplug-edge-sim.log`, `runs/sparkplug-probe.log`.

## OPC UA

Tier (opcua): Hardware-ready.

Sample server (`npm run opcua-sample-server`, node-opcua 2.186.17) on `opc.tcp://localhost:48410/UA/FabTwin`, the bridge (`npm run opcua-bridge`), and the probe on `ws://127.0.0.1:8788`. Started at 09:36:16 UTC.

```
OPC UA sample server on opc.tcp://<host>.local:48410/UA/FabTwin with 12 tools
[09:36:22] connecting to opc.tcp://localhost:48410/UA/FabTwin (security None)
[09:36:22] session open
[09:36:22] found 12 tools and 90 variables under Objects/FabTwin
[09:36:22] subscribed (publishing interval 250 ms). FabTwin live mode: ws://localhost:8788
[09:36:32] 15 events published to 1 client(s); skipped names: ChamberTemperature
```

`ChamberTemperature` is a variable the sample server adds on purpose to show that names outside the convention are reported and skipped.

Outage and recovery. The server was stopped by PID at 09:36:53 and started again at 09:37:08:

```
[09:36:53] OPC UA connection lost, will retry
[09:37:09] OPC UA connection re-established
[09:37:12] 67 events published to 1 client(s); skipped names: ChamberTemperature
[09:37:42] 81 events published to 1 client(s); skipped names: ChamberTemperature
```

The probe saw `alarm.set OPCUA_CONNECTION_LOST` (critical) on all 12 tools at the drop, nothing while the server was down (events stayed at 24, 8, 5 for 15 seconds), and `alarm.cleared` on all 12 after the reconnect. Events resumed (`t=75s ... "lot.started":14,"lot.completed":11,"alarm.set":12,"alarm.cleared":12`). The restarted sample server starts its simulated fab again from scratch, so lots after the restart are new ones. node-opcua also prints three `read_operational_limits ... BadNodeIdUnknown` blocks while reconnecting (it probes standard nodes this small server does not have); they are library noise and the bridge ignores them.

Raw files: `runs/opcua-sample-server.log`, `runs/opcua-bridge.log`, `runs/opcua-probe.log`.

## MES API and exports

Tier (rest): Live-tested.
Tier (export): Live-tested.

`npm run build` (Next.js 16.4.0, compiled and typechecked), then `npx next start -p 3107`, and curl, at 09:39:02 UTC. Full transcript with headers: `runs/mes-api-curl.txt`. The simulated fab for seed 1, two hours in:

```
$ curl -si 'http://localhost:3107/api/v1/kpis?seed=1&t=7200'
HTTP/1.1 200 OK
cache-control: no-store
content-type: application/json
{"meta":{"source":"simulation","simulated":true,"seed":1,"atS":7200,"at":"2026-01-12T08:00:00.000Z","shiftS":14400},
 "kpis":{"shipped":34,"shippedHot":5,"wip":61,"throughputPerHour":17,"meanCycleTimeS":7336,"xFactor":3.22,"onTimeDelivery":0.912, ...

$ curl -si 'http://localhost:3107/api/v1/lots?seed=1&t=7200&limit=2'      -> 200, "total":61, two lots
$ curl -si 'http://localhost:3107/api/v1/lots/L0001?seed=1&t=7200'        -> 200, lot with genealogy
$ curl -si 'http://localhost:3107/api/v1/tools?seed=1&t=7200&state=UNSCHEDULED_DOWN' -> 200, LTH-01, ETC-04 ...
$ curl -si 'http://localhost:3107/api/v1/wip?seed=1&t=7200'               -> 200, "totalLots":61,"byBay":[...]
$ curl -si 'http://localhost:3107/api/v1/alarms?seed=1&t=7200'            -> 200, "total":66
$ curl -si 'http://localhost:3107/api/v1/kpis?seed=1&t=99999'
HTTP/1.1 400 Bad Request
{"error":{"code":"bad_parameter","message":"t must be a number from 0 to 14400"}}
$ curl -si 'http://localhost:3107/api/v1/lots/NOPE?seed=1'
HTTP/1.1 404 Not Found
{"error":{"code":"not_found","message":"No lot NOPE at this time"}}
$ curl -si 'http://localhost:3107/api/v1/kpis?source=live'
HTTP/1.1 503 Service Unavailable
{"error":{"code":"live_unavailable","message":"No live source is configured. ...
```

Exports:

```
$ curl -si 'http://localhost:3107/api/v1/exports/lot-history.csv?seed=1&t=7200'
HTTP/1.1 200 OK
content-disposition: attachment; filename="lot-history.csv"
content-type: text/csv; charset=utf-8
lot_id,route,hot,t_s,timestamp,kind,tool_id,step_index,text
L0049,PWR-12,false,50,2026-01-12T06:00:50.000Z,release,,,Released onto PWR-12
L0034,SOC-20,false,50.6,2026-01-12T06:00:50.553Z,track-in,ETC-01,6,"Track-in on ETC-01, ETCH-POLY"

$ curl -si 'http://localhost:3107/api/v1/exports/shift-report.csv?seed=1'
section,key,value,comparison
summary,grade,C,
summary,score,6773,6773
kpi,shipped,62,62
```

The OpenAPI document at `/api/v1/openapi.json` is OpenAPI 3.1.0, "FabTwin MES API" 1.0.0, with the 8 paths the server answers. The same request twice returned byte-identical bodies (`sha1 d511f70f2f5f` both times) and seed 8 gave a different one, which is the determinism the simulation promises.

Scope: the data is the deterministic simulation, and every response says `meta.simulated: true`. The `source=live` path needs `FABTWIN_LIVE_URLS` on a self-hosted server and was not exercised in this run (the 503 above is the unconfigured answer); the unit tests in `src/server/api.test.ts` cover it with a fake feed.
