/**
 * Alternate tee/pin layouts (V2 content expansion — approved from
 * docs/24_CONTENT_EXPANSION_PROPOSAL.md, behind the `layouts` flag).
 *
 * Pure and deterministic: the ROUND SEED drives every draw, so Replay, a
 * shared async challenge, and a Weekly event resolve the exact same tees
 * and pins for every participant, while ordinary rounds vary day to day.
 *
 * Two independent levers per hole:
 *  - `tees`  — alternate tee positions; the authored `tee` is variant 0 and
 *    is always in the draw, so a hole with one alternate plays it ~50% of
 *    seeded rounds.
 *  - `pins`  — authored pin placements (front / tucked / back reads). When
 *    present they REPLACE the random-ellipse pin draw with a deliberate
 *    designer choice; when absent the classic randomPinForGreen applies.
 *
 * Flag off → both levers dormant and rounds are byte-identical to today.
 */

import { CourseData, HoleData, Point } from '../core/types';
import { mulberry32 } from '../utils/Random';

/** Deterministic per-hole rng stream for layout draws (distinct multipliers
 *  from the pin/wind streams so layouts never correlate with either). */
function layoutRng(seed: number, holeIdx: number): () => number {
  return mulberry32(seed * 4519 + holeIdx * 211 + 13);
}

/** The tee this hole plays for this seed: the authored tee (variant 0) or an
 *  alternate. Undefined seed (never happens in normal play — every round is
 *  seeded) conservatively keeps the standard tee. */
export function teeForSeed(hole: HoleData, seed: number | undefined, holeIdx: number): Point {
  const alts = hole.tees;
  if (!alts || alts.length === 0 || seed === undefined) return hole.tee;
  const pick = Math.floor(layoutRng(seed, holeIdx)() * (alts.length + 1));
  return pick === 0 ? hole.tee : alts[Math.min(pick - 1, alts.length - 1)];
}

/**
 * Materialize the seed's tee variants onto a course. Holes without `tees`
 * (and courses with none at all) come back UNCHANGED — same object, zero
 * cost — so the flag-off path can also share this call site safely.
 */
export function applyTeeVariants(course: CourseData, seed: number | undefined): CourseData {
  if (seed === undefined || !course.holes.some((h) => h.tees?.length)) return course;
  let changed = false;
  const holes = course.holes.map((h, i) => {
    const tee = teeForSeed(h, seed, i);
    if (tee === h.tee) return h;
    changed = true;
    return { ...h, tee };
  });
  return changed ? { ...course, holes } : course;
}

/** The authored pin for this rng draw, or null when the hole has no authored
 *  set (caller falls back to the random-ellipse pin). Consumes ONE draw. */
export function pickAuthoredPin(hole: HoleData, rng: () => number): Point | null {
  const pins = hole.pins;
  if (!pins || pins.length === 0) return null;
  return pins[Math.min(Math.floor(rng() * pins.length), pins.length - 1)];
}

/**
 * The KINDEST authored pin on a hole: the one nearest the middle of the green.
 *
 * This is what a superintendent means by an easy pin — not tucked behind a
 * bunker, not on a shelf, not three paces from an edge, so a slightly missed
 * approach still finds putting surface instead of trouble. It is used to ease a
 * device's first few rounds (`easeIn`): simulation puts the first-hole blow-up
 * rate at 10% on Wildwood and 8% on Timberline for a casual player, and a
 * beginner's very first hole is the worst possible place to spend that.
 *
 * Returns null when the hole has no authored pins, so the caller falls back to
 * the normal seeded draw.
 */
export function gentlestAuthoredPin(hole: HoleData): Point | null {
  const pins = hole.pins;
  if (!pins || pins.length === 0) return null;
  const cx = hole.green.cx;
  const cy = hole.green.cy;
  let best = pins[0];
  let bestD = Infinity;
  for (const p of pins) {
    // Normalised by the green's radii so an oval green is judged by how far
    // toward its EDGE the pin sits, not by raw distance.
    const d = Math.hypot((p.x - cx) / (hole.green.rx || 1), (p.y - cy) / (hole.green.ry || 1));
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
