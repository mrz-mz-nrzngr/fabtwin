import { buildConfig } from "./config";
import type { SimConfig } from "./types";

/** A quiet fab for unit tests: no warm WIP, no releases, no failures, no PM. Tests switch on what they need. */
export function quietConfig(seed = 1, overrides: Partial<SimConfig> = {}): SimConfig {
  const base = buildConfig(seed);
  return {
    ...base,
    warmLots: 0,
    releasesEnabled: false,
    failuresEnabled: false,
    excursionsEnabled: false,
    tools: base.tools.map((t) => ({ ...t, pmIntervalS: 1e9 })),
    ...overrides,
  };
}
