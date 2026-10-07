/**
 * FabTwin event schema, version 1.
 *
 * This is the integration contract. The simulator emits it, the UI consumes it, and a
 * SECS/GEM bridge can produce it from real equipment. The matching JSON Schema lives in
 * docs/fabtwin-event.schema.json and is checked against the simulator output in tests.
 */

export const SCHEMA_VERSION = 1 as const;

export type E10State =
  | "PRODUCTIVE"
  | "STANDBY"
  | "ENGINEERING"
  | "SCHEDULED_DOWN"
  | "UNSCHEDULED_DOWN";

export const E10_STATES: readonly E10State[] = [
  "PRODUCTIVE",
  "STANDBY",
  "ENGINEERING",
  "SCHEDULED_DOWN",
  "UNSCHEDULED_DOWN",
];

export type AlarmSeverity = "info" | "warning" | "critical";

export interface EventBase {
  /** Schema version. Consumers must reject versions they do not know. */
  v: typeof SCHEMA_VERSION;
  /** Monotonic per-source sequence number, starting at 1. Lets a consumer detect gaps. */
  seq: number;
  /** Event time, milliseconds since the Unix epoch (UTC). */
  t: number;
  /** Producer name, for example "fabtwin-sim" or "secsgem-bridge". */
  source: string;
}

export interface EquipmentStateChanged extends EventBase {
  type: "equipment.state_changed";
  data: {
    toolId: string;
    from: E10State | null;
    to: E10State;
    /** Free-text cause: setup, pm, qual, failure, repair, dispatch, idle, resume. */
    reason?: string;
    lotId?: string | null;
    recipe?: string | null;
  };
}

export interface AlarmSet extends EventBase {
  type: "alarm.set";
  data: {
    alarmId: string;
    code: string;
    severity: AlarmSeverity;
    text: string;
    toolId?: string;
    lotId?: string;
    /** SECS/GEM ALID when the alarm originates from real equipment. */
    alid?: number;
  };
}

export interface AlarmCleared extends EventBase {
  type: "alarm.cleared";
  data: {
    alarmId: string;
    code: string;
    toolId?: string;
    lotId?: string;
    clearedBy?: string;
  };
}

export interface LotStarted extends EventBase {
  type: "lot.started";
  data: {
    lotId: string;
    toolId: string;
    stepIndex: number;
    recipe: string;
    route?: string;
    wafers?: number;
    hot?: boolean;
  };
}

export interface LotCompleted extends EventBase {
  type: "lot.completed";
  data: {
    lotId: string;
    toolId: string;
    stepIndex: number;
    recipe: string;
    durationS: number;
    /** True when this was the last step on the route and the lot ships. */
    final: boolean;
    route?: string;
    hot?: boolean;
    measurement?: { param: string; value: number; unit: string };
  };
}

export interface CollectionEvent extends EventBase {
  type: "collection_event";
  data: {
    /** SECS/GEM collection event id. The simulator uses the 1000 range. */
    ceid: number;
    name: string;
    toolId?: string;
    lotId?: string;
    reports?: Record<string, string | number | boolean | null>;
  };
}

export type FabEvent =
  | EquipmentStateChanged
  | AlarmSet
  | AlarmCleared
  | LotStarted
  | LotCompleted
  | CollectionEvent;

export type FabEventType = FabEvent["type"];

/** Collection events the simulator emits. A bridge may add its own CEIDs. */
export const CEID = {
  LOT_RELEASED: 1001,
  LOT_HELD: 1002,
  LOT_RELEASED_FROM_HOLD: 1003,
  LOT_EXPEDITED: 1004,
  QT_VIOLATION: 1005,
  PM_STARTED: 1006,
  PM_COMPLETED: 1007,
  CREW_ASSIGNED: 1008,
  RULE_CHANGED: 1009,
  SPC_MEASUREMENT: 1010,
  LOT_SHIPPED: 1011,
} as const;
