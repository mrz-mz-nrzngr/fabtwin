# Verification of protocol and standards facts

Owner rule: every fact the code or the docs lean on is numbered here with its public source, and anything that is a choice of ours is marked as a design decision. Each source below was opened and read again on 2026-10-08 before it was cited. Where a source did not say what a comment or an earlier note claimed, section 8 says so.

Kinds: **Spec** (a published specification), **Reference** (a public encyclopedia page, weaker than a specification), **Source code** (an open-source implementation we read), **Library** (behaviour of a library we depend on, not a term of any specification), **Design** (our decision, with the reason), **Gap** (could not be verified from a public source).

## Sources

| Short name | What it is | Where, and the version read |
|---|---|---|
| Sparkplug | Eclipse Sparkplug Specification 3.0.0, PDF, 141 pages | https://sparkplug.eclipse.org/specification/version/3.0/documents/sparkplug-specification-3.0.0.pdf |
| MQTT | OASIS MQTT Version 3.1.1, OASIS Standard | https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html |
| Mosquitto | mosquitto.conf(5) manual of the Eclipse Mosquitto project; the broker run here is 2.1.2 | https://mosquitto.org/man/mosquitto-conf-5.html |
| OPC 10000-4 | OPC UA Part 4: Services, release 1.05.07 | https://reference.opcfoundation.org/Core/Part4/v105/docs/ |
| OPC 10000-5 | OPC UA Part 5: Information Model, release 1.05.06 | https://reference.opcfoundation.org/Core/Part5/v105/docs/ |
| UA-Nodeset | OPC Foundation's NodeIds.csv and StatusCode.csv | https://github.com/OPCFoundation/UA-Nodeset/tree/latest/Schema |
| node-opcua | The client and server library, version 2.186.17, read from `node_modules` | https://github.com/node-opcua/node-opcua |
| SEMI store | SEMI E10-0422 product page | https://store-us.semi.org/products/e01000-semi-e10-specification-for-definition-and-measurement-of-equipment-reliability-availability-and-maintainability-ram-and-utilization |
| US5740429 | US patent 5,740,429, "E10 reporting tool" (Advanced Micro Devices, filed 1995-07-07) | https://patents.google.com/patent/US5740429A/en |
| secsgem | Open-source Python SECS/GEM library, commit `59a5242` (pyproject version 0.3.0), LGPL-2.1, read only, no code copied | https://github.com/bparzella/secsgem |
| Tahu JS | `sparkplug-payload` 1.0.3 from Eclipse Tahu, EPL-2.0, used outside the repo for a cross-check | https://www.npmjs.com/package/sparkplug-payload |
| FOUP page | Wikipedia, FOUP | https://en.wikipedia.org/wiki/FOUP |
| WE page | Wikipedia, Western Electric rules | https://en.wikipedia.org/wiki/Western_Electric_rules |

SEMI standards are sold, so the standard text itself was not read. The E10 facts rest on the store page and on a patent that describes the standard (see section 5).

## 1. Sparkplug B (Eclipse Sparkplug 3.0.0)

| # | Fact | Kind | Source | Used in |
|---|---|---|---|---|
| 1 | The topic is `namespace/group_id/message_type/edge_node_id/[device_id]`. | Spec | Sparkplug 4.1 (tck-id-topic-structure) | `sparkplug/topic.ts` |
| 2 | For Sparkplug B the namespace string is `spBv1.0`. | Spec | Sparkplug 4.1.1 | `topic.ts` |
| 3 | The message types are NBIRTH, NDEATH, DBIRTH, DDEATH, NDATA, DDATA, NCMD, DCMD and STATE. | Spec | Sparkplug 4.1.3 | `topic.ts` |
| 4 | The device id MUST be present for DBIRTH, DDEATH, DDATA and DCMD, and MUST NOT be present for NBIRTH, NDEATH, NDATA, NCMD and STATE. | Spec | Sparkplug 4.1.5 | `parseTopic` |
| 5 | Group id, edge node id and device id are UTF-8 strings that must not contain `+`, `/` or `#`. | Spec | Sparkplug 4.1.2, 4.1.4, 4.1.5 | `parseTopic` splits on `/` |
| 6 | A host application's STATE topic is `spBv1.0/STATE/sparkplug_host_id` (three levels), so it never matches the four- or five-level topics above. | Spec | Sparkplug 2.4, 4.2 (Sparkplug Host Application, STATE) and 5.3 | `parseTopic` returns null for it |
| 7 | The payload field numbers are: Payload `timestamp`=1, `metrics`=2, `seq`=3, `uuid`=4, `body`=5. | Spec | Sparkplug 6.4.1 (the protobuf schema) | `sparkplug/proto.ts` |
| 8 | The Metric field numbers are: `name`=1, `alias`=2, `timestamp`=3, `datatype`=4, `is_historical`=5, `is_transient`=6, `is_null`=7, `metadata`=8, `properties`=9, and the value oneof `int_value`=10, `long_value`=11, `float_value`=12, `double_value`=13, `boolean_value`=14, `string_value`=15, `bytes_value`=16. | Spec | Sparkplug 6.4.1 | `proto.ts` |
| 9 | Types: `timestamp`, `alias`, `seq` and `long_value` are uint64; `datatype` and `int_value` are uint32; `float_value` is float, `double_value` double. | Spec | Sparkplug 6.4.1 | `proto.ts` |
| 10 | The DataType values are Unknown 0, Int8 1, Int16 2, Int32 3, Int64 4, UInt8 5, UInt16 6, UInt32 7, UInt64 8, Float 9, Double 10, Boolean 11, String 12, DateTime 13, Text 14 (and 15 to 34 for UUID, DataSet, Bytes, File, Template, PropertySet, PropertySetList and the array types, which FabTwin does not read). | Spec | Sparkplug 6.4.16 | `DataType` in `proto.ts` |
| 11 | Int8, Int16 and Int32 travel in a uint32 field and Int64 in a uint64 field, so a negative IntN must be reinterpreted on decode. | Spec | Sparkplug 6.4.17 | `sign()` in `proto.ts` |
| 12 | The payload timestamp is a uint64 of milliseconds since the Unix epoch, in UTC. | Spec | Sparkplug 6.4.5, tck-id-payloads-timestamp-in-UTC | `proto.ts`, mapper |
| 13 | Metric names are slash-delimited UTF-8 strings. A name MUST be included with every metric unless aliases are used. | Spec | Sparkplug 6.4.6 | mapper, convention (D-5) |
| 14 | An alias is a uint64 unique within the edge node. NBIRTH and DBIRTH MUST carry both name and alias; DATA and CMD messages carry the alias only. | Spec | Sparkplug 6.4.6 (tck-id-payloads-alias-*) | alias tables in the mapper |
| 15 | Every Edge Node message except NDEATH carries `seq`. NBIRTH's seq is between 0 and 255, each following message is one higher, and 255 is followed by 0. | Spec | Sparkplug 5.4 and 6.4.5 (tck-id-payloads-sequence-num-*); 6.4.21 for NDATA | `checkSeq` |
| 16 | An NDEATH MUST NOT carry a seq. | Spec | Sparkplug 6.4.25 (tck-id-payloads-ndeath-seq) | `checkSeq` is skipped for NDEATH |
| 17 | The NDEATH is the MQTT Will Message of the edge node's CONNECT: topic `spBv1.0/group_id/NDEATH/edge_node_id`, QoS 1, retain false, a protobuf payload with a `bdSeq` metric. | Spec | Sparkplug 5.4 and 6.4.25 | `scripts/sparkplug-edge-sim.ts` |
| 18 | `bdSeq` is incremented by one on every new CONNECT, wraps from 255 to 0, and the NBIRTH published after that CONNECT carries the same value. | Spec | Sparkplug 5.4 (tck-id-message-flow-edge-node-birth-publish-will-message-payload-bdSeq, -nbirth-payload-bdSeq) | edge simulator, `bdSeqOf` |
| 19 | The `bdSeq` datatype is Int64 in section 5.4 but the example in 6.4.25 shows UInt64. The two statements disagree; the mapper reads either as a number. | Spec | Sparkplug 5.4 versus 6.4.25 | `bdSeqOf` |
| 20 | A host correlates an NDEATH with an NBIRTH by `bdSeq`; an NDEATH whose bdSeq does not match the latest NBIRTH is stale and MUST be ignored (an old Will Message delivered late, or the duplicate after a clean NDEATH). | Spec | Sparkplug 5.4 step 4a, 5.5, 6.4.25 | stale-death rule in the mapper |
| 21 | The NDEATH payload timestamp is usually set at CONNECT time and is not useful to a host. The host marks the node offline using its own receipt time. | Spec | Sparkplug 5.5, 6.4.25 | mapper uses `now()` for NDEATH (fixed 2026-10-08) |
| 22 | After an NDEATH, the node's devices are implied offline and all its metrics stale. | Spec | Sparkplug 5.5 | an alarm on every tool of the node |
| 23 | NBIRTH MUST include a metric named `Node Control/Rebirth`, Boolean, value false. | Spec | Sparkplug 5.17 | edge simulator |
| 24 | A rebirth request is an NCMD with a `Node Control/Rebirth` Boolean metric of true. The node then stops DATA, publishes a complete NBIRTH and DBIRTHs, and reuses the same bdSeq. | Spec | Sparkplug 5.17 | `sources` in `sparkplug/source.ts`, edge simulator |
| 25 | A host MAY send `Node Control/Rebirth` on a gap in the sequence, on malformed payloads, on a DBIRTH, NDATA, DDATA or DDEATH that arrives before an NBIRTH, on a metric not in the birth, or on an unknown alias. Whether to do so is the host's choice. | Spec | Sparkplug 5.15 | `checkSeq`, `metrics()` |
| 26 | Any MQTT client in a Sparkplug system uses Clean Session true (MQTT 3.1.1). | Spec | Sparkplug 5.4 | `clean: true` in the simulator; the viewer uses mqtt.js defaults (clean) |
| 27 | The eclipse-tahu JavaScript library `sparkplug-payload` 1.0.3 decodes what FabTwin encodes, and FabTwin decodes what it encodes, with identical names, types, values, seq and timestamps. | Library | Run on 2026-10-08, `docs/runs/sparkplug-tahu-crosscheck.log` | `proto.ts` |

Note on licensing: the `.proto` text in the specification is EPL-2.0. FabTwin does not copy the file. `proto.ts` defines the same wire format field by field from the table in fact 7 to 9.

## 2. MQTT 3.1.1 (OASIS)

| # | Fact | Kind | Source | Used in |
|---|---|---|---|---|
| 28 | If the Will Flag is 1, the server stores a Will Message with the connection and publishes it when the network connection closes, unless the server received a DISCONNECT first. | Spec | MQTT 3.1.2.5 [MQTT-3.1.2-8] | how an NDEATH reaches the viewer |
| 29 | Situations that publish the will include a network failure, a keep-alive timeout, and the client closing the connection without a DISCONNECT. | Spec | MQTT 3.1.2.5 | the edge simulator's `client.end(true)` |
| 30 | The Will Topic and Will Message are in the CONNECT payload; Will QoS and Will Retain are connect flags. | Spec | MQTT 3.1.2.5 to 3.1.2.7, 3.1.3.2, 3.1.3.3 | simulator |
| 31 | DISCONNECT is the final packet from a client that is disconnecting cleanly; after it the server does not publish the will. | Spec | MQTT 3.14 and 3.1.2.5 | Sparkplug 5.5 rule that an NDEATH is sent first |
| 32 | Over WebSocket, MQTT control packets are sent in binary frames, the client offers the sub-protocol `mqtt`, and the server answers with `mqtt`. | Spec | MQTT chapter 6 [MQTT-6.0.0-1] to [MQTT-6.0.0-4] | the browser source uses `ws://` or `wss://` URLs through mqtt.js; the Mosquitto run |
| 33 | The WebSocket URI has no meaning for MQTT itself. | Spec | MQTT chapter 6 | broker URL is free text in the dialog |

## 3. Mosquitto

| # | Fact | Kind | Source | Used in |
|---|---|---|---|---|
| 34 | `listener port [bind address]` opens a listener; `protocol` per listener is `mqtt` (default), `websockets` or `http_api`, where `websockets` is MQTT tunnelled over WebSockets. | Spec | Mosquitto conf manual, `listener` and `protocol` | `integrations/mosquitto/fabtwin.conf` |
| 35 | `allow_anonymous` defaults to false unless no listeners are defined; setting it true allows clients with no user name. | Spec | Mosquitto conf manual, `allow_anonymous` | the demo config sets it true on loopback only |
| 36 | `persistence false` keeps the database in memory only. | Spec | Mosquitto conf manual, `persistence` | demo config |
| 37 | `log_type` selects the message types logged (error, warning, notice, information, subscribe, unsubscribe, websockets, none, all). | Spec | Mosquitto conf manual, `log_type` | demo config |
| 38 | Mosquitto 2.1.2 accepted this config and served both listeners (plain MQTT on 18830, MQTT over WebSocket on 18831) during the run. | Library | `docs/runs/sparkplug-mosquitto.log` | `docs/integration-runs.md` |

## 4. OPC UA

| # | Fact | Kind | Source | Used in |
|---|---|---|---|---|
| 39 | The standard "Objects" object (browse name `Objects`) is the browse entry point for Object nodes; the nodes that are not type definitions are reachable from it by hierarchical references. | Spec | OPC 10000-5, 8.2.4 | the bridge browses it first |
| 40 | The NodeId of the Objects folder is `i=85` (namespace 0). | Spec | UA-Nodeset NodeIds.csv (`ObjectsFolder,85,Object`) | `browseChildren(session, "ns=0;i=85")` |
| 41 | `HierarchicalReferences` is `i=33`. | Spec | UA-Nodeset NodeIds.csv | browse call, by name |
| 42 | A Subscription sends NotificationMessages at its publishing interval, and a keep-alive message when nothing changed for the keep-alive count. | Spec | OPC 10000-4, 5.14.1 and 5.14.2 | `ClientSubscription.create` parameters |
| 43 | `requestedLifetimeCount` must be at least three times the keep-alive count; the server revises illegal values instead of failing. | Spec | OPC 10000-4, 5.14.2.2 | 120 and 10 in the bridge |
| 44 | A MonitoredItem has a sampling interval, a monitoring mode, a filter and a queue; `queueSize` above 1 is a first-in-first-out queue, and an overflow sets the Overflow info bit on the new value. | Spec | OPC 10000-4, 5.13.1 and 7.21 | `samplingInterval: 100, queueSize: 10, discardOldest: true` |
| 45 | The Value attribute of a Variable is monitored for a change of value or a change of status. | Spec | OPC 10000-4, 5.13.1.1 | status-only changes reach the mapper |
| 46 | A StatusCode is a 32-bit unsigned integer. Severity is bits 30 and 31: 00 Good, 01 Uncertain, 10 Bad, 11 reserved and treated as Bad. | Spec | OPC 10000-4, 7.38.1 (earlier drafts number this 7.39) | `mapper.ts` quality rule |
| 47 | Clients must check the StatusCode of every result. Uncertain results are to be used with care, and Bad results must never be used. | Spec | OPC 10000-4, 7.38.1 and 7.11.5 | bad quality does not update the tool |
| 48 | `Good` is 0x00000000, `Uncertain` 0x40000000, `Bad` 0x80000000, `BadConnectionClosed` 0x80AE0000. | Spec | UA-Nodeset StatusCode.csv | log reading only |
| 49 | `StatusCode.isGoodish()` in node-opcua returns true when the raw value is below 0x10000000. This is a helper of the library, not a term of the specification. | Library | `node-opcua-status-code/dist/opcua_status_code.js` 2.186.17 | `bridge.ts`, labelled in a comment |
| 50 | node-opcua's client emits `connection_lost` and `connection_reestablished`, and with `keepSessionAlive` and a `connectionStrategy` it retries and re-creates the session and subscription. | Library | Observed in `docs/runs/opcua-bridge.log` | the outage run |
| 51 | The OPC UA server certificate folder and `automaticallyAcceptUnknownCertificate` belong to node-opcua's `OPCUACertificateManager`. | Library | node-opcua source | demo only; not a security statement |

## 5. SEMI E10

| # | Fact | Kind | Source | Used in |
|---|---|---|---|---|
| 52 | SEMI E10 is titled "Specification for Definition and Measurement of Equipment Reliability, Availability, and Maintainability (RAM) and Utilization"; the current revision is E10-0422. | Spec | SEMI store | docs |
| 53 | E10 "defines six mutually exclusive, basic equipment states", and "unscheduled downtime state (UDT)" is the failed condition. | Spec | SEMI store, scope 2.1 | docs |
| 54 | The six states are productive, standby, engineering, scheduled downtime, unscheduled downtime and nonscheduled. | Spec | US5740429, description of the E10 Standard (E10-9X version) | `E10_STATES` |
| 55 | Productive is the equipment performing its intended function, including regular production, loading and unloading, rework and production tests. Standby is a condition to perform but not operated (no operator, no product, no support tools). Engineering is a condition to perform but operated for engineering experiments. Scheduled downtime is planned downtime such as scheduled maintenance. Unscheduled downtime is unplanned downtime such as unscheduled maintenance. Nonscheduled is time not scheduled for production (unworked shifts, weekends, holidays). | Spec | US5740429 | `src/sim/e10.ts` comments, README |
| 56 | The patent describes the E10-9X text. The names in the current E10-0422 may differ; the store page extract shows the number six but not the names. | Gap | SEMI store versus US5740429 | stated in README |

## 6. SECS/GEM, HSMS and SECS-II (from secsgem, commit 59a5242)

FabTwin's host in `scripts/lib/hsms.ts` is written for this repo; secsgem was read for the wire facts, and no code was copied.

| # | Fact | Kind | Source | Used in |
|---|---|---|---|---|
| 57 | An HSMS message is a 4-byte big-endian length, then a 10-byte header, then the SECS-II text; the length counts the header and the text. | Source code | secsgem `common/message.py` (`struct.pack(">L" ...)`), `hsms/header.py` (`length = 10`) | `HsmsHost.write`, `onData` |
| 58 | The header is `>HBBBBL`: session id (2 bytes); byte 2 = stream with the W bit as 0x80; byte 3 = function; byte 4 = PType (0); byte 5 = SType; bytes 6 to 9 = system bytes. | Source code | secsgem `hsms/header.py` encode and decode | `header()` |
| 59 | SType values: data 0, Select.req 1, Select.rsp 2, Deselect.req 3, Deselect.rsp 4, Linktest.req 5, Linktest.rsp 6, Reject.req 7, Separate.req 9. | Source code | secsgem `HsmsSType` | `select()`, `linktest()` |
| 60 | secsgem sends control messages (Select, Linktest, Deselect, Separate, Reject) with session id 0xFFFF. FabTwin's host now does too (it sent the device id before; changed 2026-10-08 and the fab-in-a-box run repeated). | Source code | secsgem `hsms/select_req_header.py` and siblings | `header()` |
| 61 | An item starts with a format byte: the format code in the top six bits and the count of length bytes (1 to 3) in the low two; then the length, big-endian, then the data. | Source code | secsgem `secs/variables/base.py` `encode_item_header`, `decode_item_header` | `head()`, `decodeItem` |
| 62 | Format codes (octal): list 0o00, binary 0o10, boolean 0o11, ASCII 0o20, I8 0o30, I1 0o31, I2 0o32, I4 0o34, F8 0o40, F4 0o44, U8 0o50, U1 0o51, U2 0o52, U4 0o54. | Source code | secsgem `secs/variables/*.py`, `item_l.py` | `CODE` in `hsms.ts` |
| 63 | secsgem encodes ASCII items as latin-1. | Source code | secsgem `secs/variables/string.py` | `latin1` in `hsms.ts` |
| 64 | S1F13 (Establish Communications Request) and its reply S1F14 (COMMACK 0 accepted); when the host sends S1F13 the body is an empty list. | Source code | secsgem `functions.yaml` S01F13, S01F14, data item COMMACK | `goOnline` |
| 65 | S1F17 (Request ON-LINE) has no body; S1F18 carries ONLACK: 0 accepted, 1 not allowed, 2 already online. | Source code | secsgem `functions.yaml` S01F17, S01F18; data item ONLACK | `goOnline` accepts 0 and 2 |
| 66 | S2F41 (Host Command Send) is `L[RCMD, L[ L[CPNAME, CPVAL] ... ]]`; S2F42 replies `L[HCACK, ...]` with HCACK 0 acknowledge, 1 invalid command, 2 cannot perform now, 3 parameter invalid, 4 acknowledge and will finish later, 5 already in condition, 6 no such object. | Source code | secsgem `functions.yaml` S02F41, S02F42; data item HCACK | `command()` |
| 67 | S1F3 (Selected Equipment Status Request) is a list of SVIDs; S1F4 replies a list of values. The SVID may be U1, U2, U4, U8 or a signed integer. | Source code | secsgem `functions.yaml` S01F03, S01F04; data item SVID | `readSv()` sends a U4 |
| 68 | secsgem's Select.rsp header carries no status code. The status in header byte 3 (0 = communication established) is defined in SEMI E37, which is paywalled; `select()` treats byte 3 equal to 0 as success. | Gap | secsgem `hsms/select_rsp_header.py`; SEMI E37 not read | `select()` |
| 69 | The GEM processing-state and control-state model GemBench implements (control states Equipment Offline, Host Offline, Online Local, Online Remote) is in SEMI E30, which is paywalled. FabTwin does not implement it. The host only sends S1F13, S1F17 and S2F41 and reads status variables. Whether GemBench follows E30 is a question for GemBench's own documentation, not this file. | Gap | SEMI E30 not read | scope note on the Integrations page |

## 7. Other domain terms used in the docs

| # | Fact | Kind | Source | Used in |
|---|---|---|---|---|
| 70 | A FOUP is a plastic carrier that holds silicon wafers; a fully loaded 25-wafer 300 mm FOUP weighs 7 to 9 kg, which is why automated handling is used. | Reference | FOUP page | README, DESIGN.md, `LotPanel` (25 wafers) |
| 71 | Western Electric rules: 1, a point outside 3 sigma; 2, two of three beyond 2 sigma on one side; 3, four of five beyond 1 sigma on one side; 4, eight in a row on one side of the centre line. Codified in the 1956 Western Electric handbook. | Reference | WE page | `src/sim/spc.ts` |

## 8. Design decisions

These are ours. None of them is a claim about a standard.

| # | Decision | Reason |
|---|---|---|
| D-1 | **E10 transitions.** Allowed: productive to standby, scheduled down or unscheduled down; standby to productive, scheduled down or unscheduled down; engineering to standby or unscheduled down; scheduled down to productive, engineering, standby or unscheduled down; unscheduled down to engineering or standby. | E10 defines states, not a transition table. This table is what the model needs, and the engine throws on any other move, with a test over a full shift (`src/sim/e10.test.ts`). |
| D-2 | **Five of six states.** The nonscheduled state is not modelled. | The shift is continuous; there are no unworked shifts. |
| D-3 | **What counts as each state in the game.** Recipe setup is scheduled down, preventive maintenance is scheduled down, requalification after PM or repair is engineering. | A mapping chosen to make the game's decisions visible. Real fabs define their own mapping. |
| D-4 | **OHT blocking.** The loop is cut into cells slightly longer than a vehicle, a vehicle holds the cell it is in and the next one while crossing, idle vehicles wait in a siding that does not block. | Gives queueing without vehicle-level physics. Not fitted to any real system. |
| D-5 | **Naming convention for Sparkplug metrics and OPC UA variables.** `State`, `LotId`, `Recipe`, `Route`, `StepIndex`, `Alarm/<CODE>`, `Alarm/<severity>/<CODE>`, `Measurement/<CD|OVL|THK>`. In OPC UA the slash is a dot. | Both protocols give names and types but not meaning (Sparkplug 6.4.6 leaves names to the application). |
| D-6 | **A lot is in process while the tool is PRODUCTIVE and reports a non-empty lot id.** It starts when that becomes true and completes when it stops (state leaves PRODUCTIVE, or the lot id changes or clears). | Neither Sparkplug nor OPC UA has a lot concept. |
| D-7 | **Connectivity alarms.** NDEATH raises `EDGE_NODE_OFFLINE` (critical) on every tool of the node, DDEATH raises `DEVICE_OFFLINE` (warning), a lost OPC UA session raises `OPCUA_CONNECTION_LOST` (critical) on every known tool. | Facts 22 and 47 say the data is stale or unusable; how to show that is the host's choice (Sparkplug 5.5). |
| D-8 | **A Bad or Uncertain OPC UA status does not update the tool; it raises `OPCUA_BAD_QUALITY` until every variable is Good.** | Fact 47 forbids using Bad values and asks for care with Uncertain; treating Uncertain as not usable is stricter than the standard requires. |
| D-9 | **The Sparkplug viewer is passive.** It is not a primary host application, publishes no STATE, and publishes only `Node Control/Rebirth` requests, at most one per node every 5 seconds, and when it sees a sequence gap, an unknown alias, or data from a node it has not seen born. | Facts 6 and 25. The 5-second limit avoids a request storm. |
| D-10 | **Live-mode vehicles are synthesised.** A finished step sends a vehicle to the tool and carries the FOUP to the nearest stocker downstream. The stream has no vehicle positions. The synthesised vehicles do not model blocking. | The event schema carries equipment, alarm, lot and collection events only. |
| D-11 | **GemBench process states map to E10 states** in each generated equipment file: Idle to STANDBY, Setup to ENGINEERING, Ready to STANDBY, Executing to PRODUCTIVE, Paused to STANDBY, Complete to STANDBY. | Setup before a lot is neither productive nor idle; ENGINEERING was the closest of the five. |
| D-12 | **The fab-in-a-box host owns the routes.** GEM does not tell which step of a route a lot is on, so the host adds route, step, hot and final flags and the LotReleased and LotShipped collection events. | See `docs/EVENT_SCHEMA.md`. |
| D-13 | **API semantics.** Responses are the deterministic simulation for a seed and a time `t`; `meta.simulated` is always present; `source=live` only works when `FABTWIN_LIVE_URLS` is set. | The simulation is the product; the API must never present it as plant data. |
| D-14 | **Tiers.** SECS/GEM and OPC UA are hardware-ready because the far end is a simulator written by us. Sparkplug is live-tested because Mosquitto is independent software, with the edge node still simulated. | Rule in `docs/depth-pass.md` of the factory workspace. |

## 9. Sources that did not check out, and what was done

1. **"spec 5.x" in `sparkplug/mapper.ts`.** The note given for the fix said to cite section 5.8. Section 5.8 ("Sparkplug Host Applications") only says a primary host differs from other hosts in that edge nodes wait for it; it says nothing about rebirth. The rule that a host MAY request a rebirth is section 5.15, and the command itself is section 5.17. The comment now cites 5.15 and 5.17.
2. **"section 6.4.x, payload seq rules".** The sequence rules are in 6.4.5 (Payload) and 5.4 (NBIRTH), and for NDATA also 6.4.21. The comment cites 6.4.5 and 5.4.
3. **"section 6.4" in `sparkplug/proto.ts`.** The schema is 6.4.1 and the data types are 6.4.16. The comment cites both.
4. **OPC UA "Part 4, DataValue and StatusCode".** In release 1.05 DataValue is 7.11 (7.11.5 for the status) and StatusCode is 7.38, not 7.39 (which is TimestampsToReturn). The comment cites 7.11.5 and 7.38.
5. **The Sparkplug NDEATH timestamp.** The mapper used the payload timestamp. The specification (fact 21) says to use the host's receipt time. Fixed, with a test.
6. **HSMS control session id.** FabTwin sent its configured session id in Select and Linktest. The reference implementation uses 0xFFFF (fact 60). Fixed and the fab-in-a-box run repeated against the same eight simulators.
7. **Sparkplug's own inconsistency** about the `bdSeq` datatype (fact 19) is in the specification, not in our code.
8. **A SEMI store link first tried returned 404.** The product page above is the one that exists; the E10 state names are from the patent, not the store page (fact 56).
9. **Not verifiable from a public source:** the HSMS Select status byte (fact 68) and GEM state models (fact 69).
