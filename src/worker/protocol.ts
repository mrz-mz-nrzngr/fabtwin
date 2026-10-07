import type { FabEvent } from "@/events/types";
import type { ShiftReport } from "@/sim/report";
import type { Command, CommandResult, Snapshot } from "@/sim/types";

export type ToWorker =
  | { type: "init"; seed: number }
  | { type: "speed"; value: number }
  | { type: "command"; id: number; cmd: Command }
  | { type: "dispose" };

export type FromWorker =
  | { type: "frame"; snapshot: Snapshot; events: FabEvent[] }
  | { type: "commandResult"; id: number; result: CommandResult }
  | { type: "ended"; report: ShiftReport }
  | { type: "error"; message: string };
