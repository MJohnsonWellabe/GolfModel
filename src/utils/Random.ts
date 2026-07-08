/**
 * Seedable RNG for deterministic simulation (balance suites, shared
 * tournament conditions). Gameplay defaults to Math.random via the same
 * interface, so threading a seed through is opt-in and zero-cost.
 */

export type Rng = () => number;

/** mulberry32 — tiny, fast, good-enough distribution for gameplay. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller gaussian drawn from an injected uniform source. */
export function gaussianOf(rng: Rng, mean = 0, sigma = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
