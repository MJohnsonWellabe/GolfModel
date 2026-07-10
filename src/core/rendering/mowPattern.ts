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
