/**
 * Pure count-up math for the results score reveal (V2 Phase 2, Pass B).
 *
 * The animation layer feeds `countUpValue` an elapsed fraction each frame and
 * renders the returned integer; keeping the math pure (and separately tested)
 * guarantees the displayed number always ends EXACTLY on the real total —
 * the score itself is gameplay truth and may never be approximated.
 */

/** Ease-out cubic — fast start, soft settle (matches --ease-out's spirit). */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

/**
 * The value to display at progress `t` (0..1) counting from `from` to `to`.
 * Clamped: t ≤ 0 → from, t ≥ 1 → exactly `to`. Integers throughout.
 */
export function countUpValue(from: number, to: number, t: number): number {
  if (t >= 1) return to;
  if (t <= 0) return from;
  return Math.round(from + (to - from) * easeOutCubic(t));
}
