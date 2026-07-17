/**
 * Authored third-star skill challenges — explicit course data, one per hole
 * (retention plan, Part 5: "create explicit course-data definitions for the
 * third star rather than scattering hardcoded conditions through gameplay
 * code"). Each is deterministic and testable against HoleMasteryInput.
 *
 * Authoring notes: every course runs par 4 / par 3 / par 5. Challenges lean
 * into each course's character — Sable Bay and Port Johnson punish water and
 * sand, Wildwood rewards precision through the trees, Timberline rewards
 * clean striking in the pines.
 */

import { ThirdStarDef } from '../systems/Mastery';

export const MASTERY_CHALLENGES: ThirdStarDef[] = [
  // ---- Sable Bay (coastal; water everywhere, waste sand, island green) ----
  {
    id: 'sablebay:1',
    courseId: 'sablebay',
    holeNumber: 1,
    name: 'Dry Run',
    desc: 'Make par or better without finding water',
    test: (h) => h.strokes - h.par <= 0 && !h.waterHit
  },
  {
    id: 'sablebay:2',
    courseId: 'sablebay',
    holeNumber: 2,
    name: 'Island Nerve',
    desc: 'Hit the green in regulation',
    test: (h) => !!h.gir
  },
  {
    id: 'sablebay:3',
    courseId: 'sablebay',
    holeNumber: 3,
    name: 'Clean Passage',
    desc: 'Avoid water and sand for the whole hole',
    test: (h) => !h.waterHit && !h.sandHit
  },

  // ---- Wildwood Glen (parkland; creeks, tight woods) ----
  {
    id: 'wildwood:1',
    courseId: 'wildwood',
    holeNumber: 1,
    name: 'Split the Trees',
    desc: 'Hit the fairway off the tee',
    test: (h) => !!h.fairwayHit
  },
  {
    id: 'wildwood:2',
    courseId: 'wildwood',
    holeNumber: 2,
    name: 'Trust Your Read',
    desc: 'Make par or better without True Vision',
    test: (h) => h.strokes - h.par <= 0 && !h.usedTrueVision
  },
  {
    id: 'wildwood:3',
    courseId: 'wildwood',
    holeNumber: 3,
    name: 'Stick It Close',
    desc: 'Land your approach inside 15 feet',
    test: (h) => typeof h.approachFt === 'number' && h.approachFt >= 0 && h.approachFt <= 15
  },

  // ---- Timberline (forest; tight spruce corridors, honest bounces) ----
  {
    id: 'timberline:1',
    courseId: 'timberline',
    holeNumber: 1,
    name: 'Corridor Drive',
    desc: 'Hit the fairway and make par or better',
    test: (h) => !!h.fairwayHit && h.strokes - h.par <= 0
  },
  {
    id: 'timberline:2',
    courseId: 'timberline',
    holeNumber: 2,
    name: 'Mountain Roll',
    desc: 'Hole a putt of 15 feet or longer',
    test: (h) => (h.longestPuttFt ?? 0) >= 15
  },
  {
    id: 'timberline:3',
    courseId: 'timberline',
    holeNumber: 3,
    name: 'Timber Line',
    desc: 'Make birdie or better without finding sand',
    test: (h) => h.strokes - h.par <= -1 && !h.sandHit
  },

  // ---- Port Johnson Links (links; pot bunkers, wind) ----
  {
    id: 'portjohnson:1',
    courseId: 'portjohnson',
    holeNumber: 1,
    name: 'Pot Luck',
    desc: 'Stay out of every bunker',
    test: (h) => !h.sandHit
  },
  {
    id: 'portjohnson:2',
    courseId: 'portjohnson',
    holeNumber: 2,
    name: 'Into the Breeze',
    desc: 'Hit the green in regulation in 8+ wind',
    test: (h) => !!h.gir && (h.windSpeed ?? 0) >= 8
  },
  {
    id: 'portjohnson:3',
    courseId: 'portjohnson',
    holeNumber: 3,
    name: 'Links Craft',
    desc: 'Make par or better avoiding sand and water',
    test: (h) => h.strokes - h.par <= 0 && !h.sandHit && !h.waterHit
  }
];

/** Lookup by course + hole (undefined when a hole has no authored challenge). */
export function thirdStarFor(courseId: string, holeNumber: number): ThirdStarDef | undefined {
  return MASTERY_CHALLENGES.find((d) => d.courseId === courseId && d.holeNumber === holeNumber);
}
