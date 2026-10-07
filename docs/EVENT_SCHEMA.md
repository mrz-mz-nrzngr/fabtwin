# FabTwin event schema, version 1

This is the contract between the simulator, the console, and a future SECS/GEM bridge. A bridge turns real equipment messages into these events, and the console renders them with no other change.

- TypeScript types: `src/events/types.ts`
- Runtime validator: `src/events/validate.ts` (`parseFabEvent`, `parseFrame`)
- JSON Schema (draft-07): `docs/fabtwin-event.schema.json`
- Live client: `src/events/live.ts` (`LiveClient`)
- Reference producer: `scripts/mock-live-server.ts`

`src/sim/events.test.ts` validates every event of a full simulated shift against the JSON Schema and against the runtime validator, so the three cannot drift apart.

## Envelope

Every event has the same five fields.

| Field | Type | Meaning |
|---|---|---|
| `v` | `1` | Schema version. A consumer must reject versions it does not know. |
| `seq` | integer, at least 1 | Monotonic per source. Lets a consumer notice gaps. |
| `t` | integer | Event time in milliseconds since the Unix epoch, UTC. |
| `source` | string | Producer name, for example `fabtwin-sim` or `secsgem-bridge`. |
| `type` | string | One of the six types below. |
| `data` | object | Payload for that type. |

## Event types

### `equipment.state_changed`

An equipment state transition, using the five SEMI E10 states: `PRODUCTIVE`, `STANDBY`, `ENGINEERING`, `SCHEDULED_DOWN`, `UNSCHEDULED_DOWN`.

```json
{
  "v": 1, "seq": 412, "t": 1768197660000, "source": "fabtwin-sim",
  "type": "equipment.state_changed",
  "data": { "toolId": "LTH-03", "from": "STANDBY", "to": "SCHEDULED_DOWN",
            "reason": "setup", "lotId": "L0045", "recipe": null }
}
```

`from` is `null` for the first event about a tool. `reason` is free text. The simulator uses `setup`, `process`, `resume`, `idle`, `pm`, `post-pm qual`, `post-repair qual`, `qualified`, `failure`.

### `alarm.set` and `alarm.cleared`

```json
{ "v": 1, "seq": 413, "t": 1768197700000, "source": "fabtwin-sim", "type": "alarm.set",
  "data": { "alarmId": "ALM-0007", "code": "TOOL_DOWN", "severity": "critical",
            "text": "ETC-03 is down with L0059 inside. Needs a repair crew.", "toolId": "ETC-03" } }
```

`severity` is `info`, `warning` or `critical`. `alid` carries the SECS/GEM alarm id when the source is real equipment. `alarm.cleared` repeats `alarmId` and `code` and may add `clearedBy`.

Codes the simulator uses: `TOOL_DOWN`, `TOOL_DEGRADED`, `PM_DUE`, `QT_RISK`, `QT_VIOLATION`, `SPC_RULE`, `SPC_HOLD`.

### `lot.started` and `lot.completed`

Track-in (processing starts) and track-out (processing ends) of one step.

```json
{ "v": 1, "seq": 420, "t": 1768197900000, "source": "fabtwin-sim", "type": "lot.completed",
  "data": { "lotId": "L0045", "toolId": "MET-03", "stepIndex": 6, "recipe": "MET-OVL",
            "durationS": 134.2, "final": false, "route": "LOGIC-16",
            "measurement": { "param": "OVL", "value": 3.296, "unit": "nm" } } }
```

`final: true` means the lot finished its last step and ships. `measurement` appears on metrology steps and feeds the SPC chart.

### `collection_event`

A SECS/GEM style collection event, `ceid` plus a name and optional reports.

| CEID | Name | Meaning |
|---|---|---|
| 1001 | LotReleased | A lot entered the fab |
| 1002 | LotHeld | Held by the operator or by an SPC rule |
| 1003 | LotReleasedFromHold | |
| 1004 | LotExpedited | |
| 1005 | QueueTimeViolation | `reports`: `stepIndex`, `recipe`, `limitS`, `waitedS` |
| 1006 / 1007 | PmStarted / PmCompleted | |
| 1008 | CrewAssigned | `reports.etaS` |
| 1009 | DispatchRuleChanged | `reports`: `bay`, `from`, `to` |
| 1010 | SpcMeasurement | `reports`: `param`, `value`, `z`, `rules` |
| 1011 | LotShipped | `reports`: cycle time, on-time flag, escape flag |

A bridge may add its own CEIDs. The console ignores ones it does not know.

## Transport

A WebSocket frame carries one event, an array of events, or `{ "events": [...] }`. The console validates every event. Invalid ones are counted and dropped, never half-applied. `LiveClient` reconnects with exponential backoff, capped at 15 seconds.

Try it:

```bash
npm run mock-live          # ws://localhost:8787, replays a simulated shift at 30x
# then open the app, choose "Live mode", and connect
```

In live mode the simulator pauses and the equipment table, utilization Gantt, alarm list, tool panels and lot genealogy are driven only by the socket. Simulator-only views (KPIs, objectives, score, FOUP motion) are off.

## Versioning

- Adding an optional field, a new `reason`, a new alarm `code` or a new CEID does not change the version.
- Renaming or removing a field, changing a type, or adding a required field bumps `v`. Consumers must refuse a `v` they do not know.
