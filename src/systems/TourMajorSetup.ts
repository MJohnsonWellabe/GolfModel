/**
 * MAJOR championship setup (owner pass 8: "for the 3 rounders they should
 * move the tees progressively harder and the pins progressively harder per
 * day").
 *
 * A major spans three rounds on one course. This module materializes the
 * course each round actually plays: round 1 is the members' setup (forward
 * tee, kind pin), round 2 the authored card, round 3 the championship setup
 * (back tee, tucked pin). Everything is derived from geometry the holes
 * already author — tee variants (`tees`) and pin placements (`pins`) — so
 * courses without alternates simply play their card all three days.
 *
 * Pure and deterministic (no seed at all): both sides of a major MUST see
 * the identical setup — the player's live round (main.ts startTourRound)
 * and the rival field's simulated rounds (TourSeason.completeTourRound) —
 * and a function of (hole, roundNo) alone cannot drift between them.
 */

import { CourseData, EllipseArea, HoleData, Point } from '../core/types';

/**
 * How hard a pin position plays, as its normalized distance from the center
 * of the NEAREST green lobe (0 = dead center, 1 = on the edge). Distance is
 * measured in each lobe's own radii — an oval green judges a pin by how far
 * toward its EDGE it sits, not by raw yards — and rotated ovals are
 * un-rotated first so the radii apply on the right axes.
 *
 * Two-lobe greens take the MINIMUM over both lobes: a pin sitting centered
 * in the second lobe of an L-shaped green is a fair pin, not a severe one,
 * even though it is miles from the FIRST lobe's center (Wild Prairie hole 2
 * authors exactly this — its back-lobe pin measures 2.01 against the main
 * lobe alone and 0.2 against its own).
 */
export function pinSeverity(hole: HoleData, p: Point): number {
  const lobeDist = (g: EllipseArea): number => {
    const dx = p.x - g.cx;
    const dy = p.y - g.cy;
    const rot = g.rot ?? 0;
    const lx = dx * Math.cos(-rot) - dy * Math.sin(-rot);
    const ly = dx * Math.sin(-rot) + dy * Math.cos(-rot);
    return Math.hypot(lx / (g.rx || 1), ly / (g.ry || 1));
  };
  const d = lobeDist(hole.green);
  return hole.green2 ? Math.min(d, lobeDist(hole.green2)) : d;
}

/** The hole's authored pins ranked kind → severe WITHIN its own set (a
 *  major escalates each hole against itself, not against other holes).
 *  Empty when the hole authors no alternates. */
export function rankedAuthoredPins(hole: HoleData): Point[] {
  const pins = hole.pins;
  if (!pins || pins.length === 0) return [];
  return [...pins].sort((a, b) => pinSeverity(hole, a) - pinSeverity(hole, b));
}

/** Center of the green complex a tee's length is measured against (the main
 *  lobe's center — the second lobe is a pin-position feature, not a
 *  different target line off the tee). */
function greenCenter(hole: HoleData): Point {
  return { x: hole.green.cx, y: hole.green.cy };
}

/**
 * The tee a major hole plays in round `r` (0-based): round 1 the SHORTEST
 * of the authored variants (forward), round 2 the authored standard tee,
 * round 3 the LONGEST (back). The standard tee is itself in the variant
 * pool, so length never DECREASES across the rounds — shortest ≤ standard
 * ≤ longest by construction. One authored tee and no alternates = the same
 * tee all three days.
 */
export function majorTeeForRound(hole: HoleData, r: number): Point {
  const variants = [hole.tee, ...(hole.tees ?? [])];
  if (variants.length === 1) return hole.tee;
  const g = greenCenter(hole);
  const byLength = [...variants].sort(
    (a, b) => Math.hypot(a.x - g.x, a.y - g.y) - Math.hypot(b.x - g.x, b.y - g.y)
  );
  if (r <= 0) return byLength[0];
  if (r === 1) return hole.tee;
  return byLength[byLength.length - 1];
}

/** The pin a major hole plays in round `r`: the round-ranked authored pin
 *  (kindest first, most severe last), or the authored card pin when the
 *  hole has no alternates. Fewer pins than rounds clamps to the last. */
export function majorPinForRound(hole: HoleData, r: number): Point {
  const ranked = rankedAuthoredPins(hole);
  if (ranked.length === 0) return hole.pin;
  return ranked[Math.min(Math.max(0, r), ranked.length - 1)];
}

/**
 * One hole, materialized for a major round: escalated tee and pin baked
 * into `tee`/`pin` — the fields BOTH the live game and simulateHole play —
 * with `tees` stripped so the seeded variant draw (`applyTeeVariants`)
 * no-ops instead of re-rolling the tee out from under the setup.
 */
export function majorHoleForRound(hole: HoleData, r: number): HoleData {
  const { tees: _tees, ...rest } = hole;
  return { ...rest, tee: majorTeeForRound(hole, r), pin: majorPinForRound(hole, r) };
}

/** The whole course a major round plays. `r` is the 0-based round number,
 *  clamped so a stray value degrades to the nearest real setup. */
export function majorCourseForRound(course: CourseData, r: number): CourseData {
  const rr = Math.min(Math.max(0, r), 2);
  return { ...course, holes: course.holes.map((h) => majorHoleForRound(h, rr)) };
}
