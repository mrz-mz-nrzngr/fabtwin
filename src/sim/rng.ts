/**
 * Counter-based randomness.
 *
 * Every random draw in the simulation is a pure function of (seed, keys...), not a
 * position in a shared stream. That makes a shift reproducible AND makes two runs that
 * diverge (player vs autopilot) stay comparable: tool 7's third failure is the same
 * failure in both runs, no matter what else happened in between.
 */

export function hash32(seed: number, ...keys: Array<string | number>): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const k of keys) {
    const s = typeof k === "number" ? `#${k}` : k;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x85ebca6b);
      h ^= h >>> 13;
    }
    h = Math.imul(h ^ 0x7f4a7c15, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Uniform in [0, 1). */
export function urand(seed: number, ...keys: Array<string | number>): number {
  return hash32(seed, ...keys) / 4294967296;
}

/** Standard normal via Box-Muller on two independent hashed draws. */
export function nrand(seed: number, ...keys: Array<string | number>): number {
  const u1 = Math.max(urand(seed, ...keys, "a"), 1e-12);
  const u2 = urand(seed, ...keys, "b");
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Exponential with the given mean. */
export function erand(seed: number, mean: number, ...keys: Array<string | number>): number {
  return -mean * Math.log(Math.max(1 - urand(seed, ...keys), 1e-12));
}

/** Weibull with the given shape and scale. */
export function wrand(seed: number, shape: number, scale: number, ...keys: Array<string | number>): number {
  return scale * Math.pow(-Math.log(Math.max(1 - urand(seed, ...keys), 1e-12)), 1 / shape);
}

/** Gamma function for x in (1, 3), Lanczos approximation. Used to convert MTBF to a Weibull scale. */
export function gamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}
