/**
 * The conditions a round is played under, derived from its seed alone.
 *
 * Wind and pin placement used to be derived inline in main.ts. They are now
 * here because THREE separate consumers must agree on them exactly, and any
 * drift between them is a silent correctness bug rather than a visible one:
 *
 *   1. the live game, drawing the wind arrow and placing the cup;
 *   2. ghost playback (`systems/GhostPlayback.ts`), which re-simulates an
 *      opponent's recorded inputs — a different wind would send their ball
 *      somewhere they never hit it;
 *   3. score verification (`systems/RoundVerify.ts`), which re-simulates a
 *      submitted round to confirm the score — a different wind would reject
 *      honest rounds and, worse, could accept dishonest ones.
 *
 * Pure and Babylon-free: this runs unchanged in the browser, in vitest, and in
 * a Cloud Function.
 *
 * DETERMINISM CONTRACT
 * --------------------
 * The seeded streams below (`seed * 1000 + holeIdx` for wind,
 * `seed * 2003 + holeIdx * 97 + 7` for pins) are the ones every shipped round
 * has used. Changing either constant re-rolls the conditions of every stored
 * recording and every shared challenge code, invalidating them. Treat these as
 * a wire format.
 */

import { buildHeightField } from './HeightField';
import { pickAuthoredPin } from './Layouts';
import { drawWind } from './RoundSimulator';
import { randomPinForGreen } from '../utils/Geometry';
import { mulberry32 } from '../utils/Random';
import type { CourseData, HoleData, Point, Wind } from '../core/types';

/** Wind for a hole, from the round seed. Shared by every player in the round. */
export function windForSeed(
  seed: number | undefined,
  holeIdx: number,
  minWind: number,
  maxWind: number
): Wind {
  const rng = seed !== undefined ? mulberry32(seed * 1000 + holeIdx) : Math.random;
  return drawWind(rng, minWind, maxWind);
}

/**
 * Cup position for a hole, from the round seed. `useAuthoredPins` mirrors the
 * `layouts` feature flag — passed in rather than read here so this module stays
 * flag-free and usable server-side.
 *
 * Contoured greens veto random cups on slopes too steep to hold a resting ball,
 * using the same heightfield the round actually plays on, so the veto and the
 * roll always agree.
 */
export function pinForSeed(
  seed: number | undefined,
  holeIdx: number,
  hole: HoleData,
  opts: { useAuthoredPins: boolean; bunkerDepthScale?: number; wasteDepthScale?: number }
): Point {
  const rng = seed !== undefined ? mulberry32(seed * 2003 + holeIdx * 97 + 7) : Math.random;
  const authored = opts.useAuthoredPins ? pickAuthoredPin(hole, rng) : null;
  const hf = buildHeightField(hole, opts.bunkerDepthScale ?? 1, opts.wasteDepthScale ?? 0);
  const gradMag = hf
    ? (x: number, y: number): number => {
        const g = hf.gradientAt(x, y);
        return Math.hypot(g.x, g.y);
      }
    : undefined;
  return authored ?? randomPinForGreen(hole.green, hole.green2, rng, gradMag);
}

/** Every hole's conditions for a round, in play order. */
export interface RoundConditions {
  winds: Wind[];
  pins: Point[];
}

export function conditionsForRound(
  course: CourseData,
  seed: number | undefined,
  holeCount: number,
  opts: { useAuthoredPins: boolean; bunkerDepthScale?: number; wasteDepthScale?: number; maxWind: number }
): RoundConditions {
  const winds: Wind[] = [];
  const pins: Point[] = [];
  for (let i = 0; i < holeCount; i++) {
    const hole = course.holes[i];
    if (!hole) break;
    winds.push(windForSeed(seed, i, course.minWind ?? 2, course.maxWind ?? opts.maxWind));
    pins.push(pinForSeed(seed, i, hole, opts));
  }
  return { winds, pins };
}
