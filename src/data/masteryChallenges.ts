/**
 * Authored hole-mastery ladders — explicit course data (retention plan,
 * Part 5). Every hole has THREE progressively harder, hole-specific
 * challenges: an approachable goal, a skilled goal, and a rare mastery feat.
 * Each is deterministic and testable against HoleMasteryInput.
 *
 * Every course runs par 4 (hole 1) / par 3 (hole 2) / par 5 (hole 3). The
 * challenges lean into each course's character — Sable Bay and Port Johnson
 * punish water and sand, Wildwood and Timberline reward precision.
 */

import { HoleMasteryDef, HoleMasteryInput, StarChallenge } from '../systems/Mastery';

// ---- Reusable predicates ----------------------------------------------------
const scored = (h: HoleMasteryInput): number => h.strokes - h.par;
const par = (h: HoleMasteryInput): boolean => scored(h) <= 0;
const birdie = (h: HoleMasteryInput): boolean => scored(h) <= -1;
const eagle = (h: HoleMasteryInput): boolean => scored(h) <= -2;
const gir = (h: HoleMasteryInput): boolean => !!h.gir;
const fir = (h: HoleMasteryInput): boolean => !!h.fairwayHit;
const onePutt = (h: HoleMasteryInput): boolean => h.holePutts === 1;
const noWater = (h: HoleMasteryInput): boolean => !h.waterHit;
const noSand = (h: HoleMasteryInput): boolean => !h.sandHit;
/** A flawless birdie on a par 4/5: fairway, green in regulation, one putt. */
const cleanBirdie = (h: HoleMasteryInput): boolean => fir(h) && gir(h) && onePutt(h);
/** A tee shot that finished on the green inside `ft` feet (par-3 dagger). */
const inside = (h: HoleMasteryInput, ft: number): boolean =>
  typeof h.approachFt === 'number' && h.approachFt >= 0 && h.approachFt <= ft;

// Named star-challenge builders (keep the desc + test in lockstep).
const S = (name: string, desc: string, test: (h: HoleMasteryInput) => boolean): StarChallenge => ({
  name,
  desc,
  test
});

const ladder = (
  courseId: string,
  holeNumber: number,
  stars: [StarChallenge, StarChallenge, StarChallenge]
): HoleMasteryDef => ({ id: `${courseId}:${holeNumber}`, courseId, holeNumber, stars });

export const MASTERY_CHALLENGES: HoleMasteryDef[] = [
  // ---- Sable Bay (coastal; water everywhere; island par 3) ----
  ladder('sablebay', 1, [
    S('Steady Start', 'Make par or better', par),
    S('Harbour Birdie', 'Birdie the hole', birdie),
    S('Flawless Four', 'Fairway, green in regulation, and one putt', cleanBirdie)
  ]),
  ladder('sablebay', 2, [
    S('Dry Landing', 'Make par or better without finding water', (h) => par(h) && noWater(h)),
    S('Island Birdie', 'Birdie the island green', birdie),
    S('Island Dagger', 'Stick the tee shot inside 6 feet', (h) => inside(h, 6))
  ]),
  ladder('sablebay', 3, [
    S('Reach the Bay', 'Make par or better', par),
    S('Coastline Birdie', 'Birdie the par 5', birdie),
    S('Sable Eagle', 'Eagle the par 5', eagle)
  ]),

  // ---- Wildwood Glen (parkland; tight tree-lined fairways; creeks) ----
  ladder('wildwood', 1, [
    S('Split the Trees', 'Make par or better', par),
    S('Glen Birdie', 'Birdie the hole', birdie),
    S('Flawless Glen', 'Fairway, green in regulation, and one putt', cleanBirdie)
  ]),
  ladder('wildwood', 2, [
    S('Find the Green', 'Hit the green in regulation', gir),
    S('Glen Dart', 'Make birdie', birdie),
    S('Trust the Read', 'Birdie without using True Vision', (h) => birdie(h) && !h.usedTrueVision)
  ]),
  ladder('wildwood', 3, [
    S('Down the Glen', 'Make par or better', par),
    S('Wildwood Birdie', 'Birdie the par 5', birdie),
    S('Glen Eagle', 'Eagle the par 5', eagle)
  ]),

  // ---- Timberline (forest; tight spruce corridors; pure greens) ----
  ladder('timberline', 1, [
    S('Corridor Drive', 'Hit the fairway and make par', (h) => fir(h) && par(h)),
    S('Pine Birdie', 'Birdie the hole', birdie),
    S('Flawless Timber', 'Fairway, green in regulation, and one putt', cleanBirdie)
  ]),
  ladder('timberline', 2, [
    S('Thin-Air Green', 'Hit the green in regulation', gir),
    S('Mountain Birdie', 'Green in regulation and one putt', (h) => gir(h) && onePutt(h)),
    S('Mountain Roll', 'Hole a putt of 15 feet or longer', (h) => (h.longestPuttFt ?? 0) >= 15)
  ]),
  ladder('timberline', 3, [
    S('Sand-Free Timber', 'Make par avoiding the sand', (h) => par(h) && noSand(h)),
    S('Timber Birdie', 'Birdie the par 5', birdie),
    S('Timber Eagle', 'Eagle the par 5', eagle)
  ]),

  // ---- Port Johnson Links (links; pot bunkers; real wind) ----
  ladder('portjohnson', 1, [
    S('Pot Luck', 'Make par avoiding every bunker', (h) => par(h) && noSand(h)),
    S('Links Birdie', 'Birdie the hole', birdie),
    S('Flawless Links', 'Fairway, green in regulation, and one putt', cleanBirdie)
  ]),
  ladder('portjohnson', 2, [
    S('Find the Redan', 'Hit the green in regulation', gir),
    S('Into the Breeze', 'Hit the green in 8+ wind', (h) => gir(h) && (h.windSpeed ?? 0) >= 8),
    S('Redan Dagger', 'Stick the tee shot inside 6 feet', (h) => inside(h, 6))
  ]),
  ladder('portjohnson', 3, [
    S('Clean Passage', 'Make par with no sand or water', (h) => par(h) && noSand(h) && noWater(h)),
    S('Harbour Birdie', 'Birdie the par 5', birdie),
    S('Links Eagle', 'Eagle the par 5', eagle)
  ]),

  // ---- Red Hollow (desert canyon; red-rock waste; carry golf) ----
  ladder('redhollow', 1, [
    S('Off the Rock', 'Make par avoiding the red sand', (h) => par(h) && noSand(h)),
    S('Rimrock Birdie', 'Birdie the hole', birdie),
    S('Canyon Flush', 'Fairway, green in regulation, and one putt', cleanBirdie)
  ]),
  ladder('redhollow', 2, [
    S('Clear the Kitchen', 'Carry the chasm — green in regulation', gir),
    S('Kitchen Birdie', 'Birdie across the chasm', birdie),
    S('Devil Dagger', 'Stick the tee shot inside 6 feet', (h) => inside(h, 6))
  ]),
  ladder('redhollow', 3, [
    S('Run the Canyon', 'Make par or better', par),
    S('Dry Wolf', 'Birdie without finding the creek', (h) => birdie(h) && noWater(h)),
    S('Wolf Eagle', 'Eagle the par 5', eagle)
  ]),

  // ---- Wild Valley (sand hills; golden fescue; huge blowouts) ----
  ladder('wildvalley', 1, [
    S('Thread the Blowout', 'Hit the fairway and make par', (h) => fir(h) && par(h)),
    S('Barrens Birdie', 'Birdie the hole', birdie),
    S('Flawless Barrens', 'Fairway, green in regulation, and one putt', cleanBirdie)
  ]),
  ladder('wildvalley', 2, [
    S('Into the Kettle', 'Hit the green in regulation', gir),
    S('Kettle Birdie', 'Green in regulation and one putt', (h) => gir(h) && onePutt(h)),
    S('Punchbowl Roll', 'Hole a putt of 15 feet or longer', (h) => (h.longestPuttFt ?? 0) >= 15)
  ]),
  ladder('wildvalley', 3, [
    S('Out of the Sandbox', 'Make par avoiding every bunker', (h) => par(h) && noSand(h)),
    S('Sandbox Birdie', 'Birdie the par 5', birdie),
    S('Barrens Eagle', 'Eagle the par 5', eagle)
  ])
];

/** The full three-star ladder for a course + hole (undefined when unauthored). */
export function thirdStarFor(courseId: string, holeNumber: number): HoleMasteryDef | undefined {
  return MASTERY_CHALLENGES.find((d) => d.courseId === courseId && d.holeNumber === holeNumber);
}

/** Alias reading more naturally at call sites now that a hole has a full ladder. */
export const holeMasteryFor = thirdStarFor;
