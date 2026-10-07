/**
 * Western Electric run rules on standardised measurements (z = (x - target) / sigma).
 * `zs` holds the series with the newest point last. Returns the rule numbers the newest point breaks.
 *
 * 1: one point beyond 3 sigma.
 * 2: two of the last three beyond 2 sigma, same side.
 * 3: four of the last five beyond 1 sigma, same side.
 * 4: eight in a row on the same side of the centre line.
 */
export function evaluateRules(zs: readonly number[]): number[] {
  const n = zs.length;
  if (n === 0) return [];
  const broken: number[] = [];
  const last = zs[n - 1];
  if (Math.abs(last) > 3) broken.push(1);
  const countBeyond = (k: number, lim: number, side: 1 | -1) =>
    zs.slice(Math.max(0, n - k)).filter((z) => z * side > lim).length;
  for (const side of [1, -1] as const) {
    if (last * side > 2 && countBeyond(3, 2, side) >= 2 && !broken.includes(2)) broken.push(2);
    if (last * side > 1 && countBeyond(5, 1, side) >= 4 && !broken.includes(3)) broken.push(3);
  }
  if (n >= 8) {
    const tail = zs.slice(n - 8);
    if (tail.every((z) => z > 0) || tail.every((z) => z < 0)) broken.push(4);
  }
  return broken.sort((a, b) => a - b);
}

export const RULE_TEXT: Record<number, string> = {
  1: "1 point beyond 3σ",
  2: "2 of 3 beyond 2σ",
  3: "4 of 5 beyond 1σ",
  4: "8 in a row on one side",
};
