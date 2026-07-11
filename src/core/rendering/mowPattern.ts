/**
 * Mow-pattern math shared by the baked ground texture (CourseTexture.ts) and
 * the 3D fairway grass carpet (course3d.ts). Both must sample the SAME function
 * with the same hole axis and tile, or the ground checkerboard and the tuft
 * checkerboard drift apart and the two-tone read falls apart.
 *
 * Everything works in hole-axis coordinates: resolve a world point (wx, wy)
 * into `along` (distance up the tee→pin line) and `across` (perpendicular)
 * before calling in, so the pattern always aligns to the direction of play
 * regardless of how the hole is oriented in world space.
 */

/**
 * Signed checkerboard value in [-1, 1] for a hole-axis point: +1 on a "light"
 * cell, -1 on a "dark" cell. It is the product of two near-square waves (one
 * along each axis), so the sign flips every `tile` units in BOTH directions —
 * a true rows-and-columns checkerboard.
 *
 * `tile` is one cell's world width. `sharp` (>1) hardens the band edges toward
 * a square wave while keeping a thin anti-aliased transition so the boundary
 * never shimmers under mip/anisotropic filtering; the default reads as crisp
 * cells with clean but not jagged edges.
 */
export function mowCheckerboard(along: number, across: number, tile: number, sharp = 8): number {
  const sq = (t: number): number => Math.max(-1, Math.min(1, Math.sin((t / tile) * Math.PI) * sharp));
  return sq(along) * sq(across);
}

/**
 * Signed single-axis mowing STRIPE value in [-1, 1] for one hole-axis
 * coordinate: +1 on a "light" band, -1 on a "dark" band, flipping every `tile`
 * units. Same near-square wave as one factor of {@link mowCheckerboard}, so a
 * green striped with this reads as straight two-tone columns (project the world
 * point onto the ACROSS axis before calling → columns that run in the direction
 * of play) rather than the checkerboard's diamonds. `sharp` (>1) hardens the
 * band edge toward a square wave while keeping a thin anti-aliased transition.
 */
export function mowStripe(coord: number, tile: number, sharp = 8): number {
  return Math.max(-1, Math.min(1, Math.sin((coord / tile) * Math.PI) * sharp));
}

/**
 * Checkerboard axis rotation: a diamond grid (squares on point) instead of
 * squares aligned straight along/across the fairway. Both call sites
 * (CourseTexture's bake and course3d's grass-tuft tint) must add this to the
 * hole axis before projecting, or the ground diamonds and grass-tuft diamonds
 * rotate out of sync with each other.
 */
export const CHECKER_ROTATION = Math.PI / 4;
