/**
 * Authored third-star skill challenges — explicit course data, one per hole
 * (retention plan, Part 5). Each is deterministic and testable against
 * HoleMasteryInput. Evaluated at ROUND end, so round-scale conditions can
 * anchor to a hole slot.
 *
 * HARD by design (playtest round 2: "course stars should be harder to get").
 * The standard spine on every course (holes run par 4 / par 3 / par 5):
 *   - the par 3 (hole 2): stick the tee shot inside TEN feet;
 *   - the par 5 (hole 3): EAGLE it.
 * The par 4 (hole 1) carries the course-specific test — including the two
 * round-scale monsters: shoot better than −3, and ≤3 putts for the round.
 */

import { ThirdStarDef } from '../systems/Mastery';

/** Tee shot finished on the green inside `ft` feet (par-3 dagger test). */
const stuckInside = (h: { approachFt?: number | null }, ft: number): boolean =>
  typeof h.approachFt === 'number' && h.approachFt >= 0 && h.approachFt <= ft;

export const MASTERY_CHALLENGES: ThirdStarDef[] = [
  // ---- Sable Bay (coastal; water everywhere, the island par 3) ----
  {
    id: 'sablebay:1',
    courseId: 'sablebay',
    holeNumber: 1,
    name: 'Card Wrecker',
    desc: 'Shoot 4 under or better for the round',
    test: (h) => typeof h.roundToPar === 'number' && h.roundToPar <= -4
  },
  {
    id: 'sablebay:2',
    courseId: 'sablebay',
    holeNumber: 2,
    name: 'Island Dagger',
    desc: 'Stick the tee shot inside 10 feet',
    test: (h) => stuckInside(h, 10)
  },
  {
    id: 'sablebay:3',
    courseId: 'sablebay',
    holeNumber: 3,
    name: 'Sable Eagle',
    desc: 'Eagle the par 5',
    test: (h) => h.strokes - h.par <= -2
  },

  // ---- Wildwood Glen (parkland; tight woods, pure greens) ----
  {
    id: 'wildwood:1',
    courseId: 'wildwood',
    holeNumber: 1,
    name: 'One-Putt Wonder',
    desc: 'Use 3 putts or fewer for the whole round',
    test: (h) => typeof h.roundPutts === 'number' && h.roundPutts <= 3
  },
  {
    id: 'wildwood:2',
    courseId: 'wildwood',
    holeNumber: 2,
    name: 'Glen Dart',
    desc: 'Stick the tee shot inside 10 feet',
    test: (h) => stuckInside(h, 10)
  },
  {
    id: 'wildwood:3',
    courseId: 'wildwood',
    holeNumber: 3,
    name: 'Glen Eagle',
    desc: 'Eagle the par 5',
    test: (h) => h.strokes - h.par <= -2
  },

  // ---- Timberline (forest; tight spruce corridors) ----
  {
    id: 'timberline:1',
    courseId: 'timberline',
    holeNumber: 1,
    name: 'Pure Corridor',
    desc: 'Hit the fairway and make birdie',
    test: (h) => !!h.fairwayHit && h.strokes - h.par <= -1
  },
  {
    id: 'timberline:2',
    courseId: 'timberline',
    holeNumber: 2,
    name: 'Thin-Air Dart',
    desc: 'Stick the tee shot inside 10 feet',
    test: (h) => stuckInside(h, 10)
  },
  {
    id: 'timberline:3',
    courseId: 'timberline',
    holeNumber: 3,
    name: 'Timber Eagle',
    desc: 'Eagle the par 5',
    test: (h) => h.strokes - h.par <= -2
  },

  // ---- Port Johnson Links (links; pot bunkers, real wind) ----
  {
    id: 'portjohnson:1',
    courseId: 'portjohnson',
    holeNumber: 1,
    name: 'Wind Craftsman',
    desc: 'Par or better in 8+ wind without touching sand',
    test: (h) => h.strokes - h.par <= 0 && !h.sandHit && (h.windSpeed ?? 0) >= 8
  },
  {
    id: 'portjohnson:2',
    courseId: 'portjohnson',
    holeNumber: 2,
    name: 'Redan Dagger',
    desc: 'Stick the tee shot inside 10 feet',
    test: (h) => stuckInside(h, 10)
  },
  {
    id: 'portjohnson:3',
    courseId: 'portjohnson',
    holeNumber: 3,
    name: 'Links Eagle',
    desc: 'Eagle the par 5',
    test: (h) => h.strokes - h.par <= -2
  }
];

/** Lookup by course + hole (undefined when a hole has no authored challenge). */
export function thirdStarFor(courseId: string, holeNumber: number): ThirdStarDef | undefined {
  return MASTERY_CHALLENGES.find((d) => d.courseId === courseId && d.holeNumber === holeNumber);
}
