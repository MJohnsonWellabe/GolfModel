import { describe, expect, it } from 'vitest';
import { coursesFor } from '../../src/data/courseRoster';
import { TOUR_RIVALS, TourRival } from '../../src/data/tourRivals';
import { entrantOvr, simulateEntrantRound } from '../../src/systems/AiTournament';
import { TOUR_POINTS } from '../../src/systems/TourSeason';
import { Golfer } from '../../src/core/types';

/**
 * THE 2026-07 REBALANCE (owner, verbatim): "Put 2 players at the level of rex
 * Callaway. Put 2 at the level of Mei Tanaka too. Make others a little better
 * too so no one is consistently awful."
 *
 * Three promises live in that sentence, and each one is a test below:
 *
 *   1. the top of the board is now SIX deep — Rex plus two at his level, Mei
 *      plus two at hers — so winning a tour event means beating a real field
 *      rather than two names;
 *   2. the bottom of the board came UP: the weakest rival shoots measurably
 *      better than the man who used to hold that slot;
 *   3. and the field is still a LADDER. Compressing everyone toward the middle
 *      would satisfy (2) by destroying the thing pass 9 bought — a rating that
 *      predicts a finish — so the spread between best and worst has to stay
 *      wide enough to read on a leaderboard.
 *
 * Re-measure any number here with `node scripts/calibrate-tour-field.mjs`.
 */

const COURSES = coursesFor({ newCourses: true, courseRebuilds: true });
/** Player-tough, mid and player-mild venues, so no single course's quirks
 *  decide whether the ladder holds. */
const VENUES = ['wildwood', 'timberline', 'redhollow', 'maplevale'];
const EVENTS = 24;

const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

/** A golfer's mean toPar over the same fixed grid of courses and events, with
 *  no season context — so no hot streak can colour a rating comparison. */
function meanToPar(golfer: Golfer): number {
  const out: number[] = [];
  for (const id of VENUES) {
    for (let ev = 0; ev < EVENTS; ev++) {
      out.push(
        simulateEntrantRound(
          COURSES[id],
          id,
          golfer,
          1000 + ev * 15013,
          (2000 ^ 0x9e3779b9) + ev * 8191
        ).toPar
      );
    }
  }
  return mean(out);
}

/** The rival Moss Whitaker used to be, kept here as the BEFORE picture the
 *  floor-lift test measures against. (80.4 OVR: 93 power and nothing else.) */
const OLD_MOSS: Golfer = {
  id: 'moss',
  name: 'Moss Whitaker (pre-rebalance)',
  color: 0x6d4c41,
  character: 'milo',
  stats: { drivingPower: 93, drivingAccuracy: 72, approach: 80, chipping: 78, putting: 79 }
};

const byOvr = [...TOUR_RIVALS].sort((a, b) => entrantOvr(b) - entrantOvr(a));
const ovrOf = (id: string): number => entrantOvr(TOUR_RIVALS.find((r) => r.id === id)!);

describe('the tour field is ten rivals, and the ten are load-bearing', () => {
  it('stays ten, because the points table pays exactly eleven finishers', () => {
    // TOUR_POINTS is you plus every rival. An eleventh rival would play all
    // sixteen events for nothing, so growing the roster is a decision with a
    // table behind it — not something a rebalance does by accident.
    expect(TOUR_RIVALS).toHaveLength(10);
    expect(TOUR_POINTS).toHaveLength(TOUR_RIVALS.length + 1);
    expect(TOUR_POINTS[TOUR_RIVALS.length]).toBeGreaterThan(0);
  });

  it('keeps every rival id, because ids are persisted', () => {
    // Season points, `winnerId`, and the per-event field scores a shared
    // season re-settles from are all keyed by these strings. Re-rating a rival
    // is free; renaming one orphans a player's season.
    expect(TOUR_RIVALS.map((r) => r.id).sort()).toEqual(
      ['baz', 'dutch', 'gus', 'lena', 'mei', 'moss', 'pip', 'rex', 'sol', 'wren'].sort()
    );
    expect(new Set(TOUR_RIVALS.map((r) => r.id)).size).toBe(TOUR_RIVALS.length);
  });
});

describe('two more at Rex’s level, two more at Mei’s', () => {
  it('puts a pair alongside each of the two benchmarks', () => {
    const rex = ovrOf('rex');
    const mei = ovrOf('mei');
    // Rex is still the man everyone is chasing…
    expect(byOvr[0].id).toBe('rex');
    // …but two rivals now sit at his shoulder rather than nobody.
    for (const r of byOvr.slice(1, 3)) {
      expect(Math.abs(entrantOvr(r) - rex), `${r.id} is not at Rex's level`).toBeLessThanOrEqual(0.5);
    }
    // Mei anchors the second pair, two more at her level directly beneath her.
    expect(byOvr[3].id).toBe('mei');
    for (const r of byOvr.slice(4, 6)) {
      expect(Math.abs(entrantOvr(r) - mei), `${r.id} is not at Mei's level`).toBeLessThanOrEqual(0.5);
    }
  });

  it('makes the elite exactly six deep — a seventh would be a different game', () => {
    // The step from the sixth rival to the seventh is the seam between the
    // contenders and the chasing pack. It has to be a real gap, or "at Rex's
    // level" quietly comes to mean "everyone".
    expect(entrantOvr(byOvr[5]) - entrantOvr(byOvr[6])).toBeGreaterThan(2);
    expect(byOvr.filter((r) => r.difficulty === 'Legend')).toHaveLength(6);
  });

  it('gives the six distinct ratings, so no two of them share a mean', () => {
    // entrantForm is a line in the rating: two rivals on the same rating are
    // literally the same golfer to the simulator, which is the flatness the
    // pass-9 identity work existed to remove. "At Rex's level" means a
    // fraction apart, not identical.
    const top = byOvr.slice(0, 6).map((r) => entrantOvr(r));
    expect(new Set(top).size).toBe(6);
  });
});

describe('nobody in the field is consistently awful', () => {
  it('the weakest rival shoots measurably better than the man he replaced', { timeout: 300_000 }, () => {
    const before = meanToPar(OLD_MOSS);
    const after = meanToPar(byOvr[byOvr.length - 1]);
    // The floor moved up five overall points, worth ≈1.7 strokes a round once
    // the form line (0.28/point) and the simulator's own response to better
    // stats are both in: measured +2.67 before, +0.96 after. Anything under a
    // full stroke means the lift did not actually reach the scores.
    expect(after, `floor moved ${(before - after).toFixed(2)} strokes (was ${before.toFixed(2)})`).toBeLessThan(
      before - 1.0
    );
  });

  it('but the ladder survives: best and worst are still a leaderboard apart', { timeout: 300_000 }, () => {
    const best = meanToPar(byOvr[0]);
    const worst = meanToPar(byOvr[byOvr.length - 1]);
    // Lifting the floor by flattening the field would trade one problem for a
    // worse one — a board that reshuffles every week. Against a per-round sd
    // of ~1.05 the top-to-bottom gap has to stay clearly bigger than the noise.
    expect(worst - best, 'the field flattened').toBeGreaterThan(2.0);
    // …and not so wide that the bottom of the field is out of the tournament
    // before it starts. (Measured 3.67 strokes, down from 5.38 before the
    // rebalance — tighter, still three and a half shots of daylight.)
    expect(worst - best, 'the field is a two-tier league').toBeLessThan(4.5);
  });

  it('and every real rating gap still shows up in the scores', { timeout: 300_000 }, () => {
    const byRival = new Map<string, number>(TOUR_RIVALS.map((r) => [r.id, meanToPar(r)]));
    for (const a of TOUR_RIVALS) {
      for (const b of TOUR_RIVALS) {
        // Only pairs separated by a REAL gap: 2 overall points is 0.56 strokes
        // of form, which this sample can resolve. Pinning neighbours a tenth
        // apart would make the test a coin flip rather than a guard.
        if (entrantOvr(a) - entrantOvr(b) < 2) continue;
        expect(
          byRival.get(a.id)!,
          `${a.id} (${entrantOvr(a).toFixed(1)}) should out-score ${b.id} (${entrantOvr(b).toFixed(1)})`
        ).toBeLessThan(byRival.get(b.id)!);
      }
    }
  });
});

describe('the difficulty tiers still describe the ladder', () => {
  it('runs Legend → Hard → Medium → Easy in rating order', () => {
    // The tier is display flavour (the rating is what the simulator reads),
    // but it must not LIE: after the rebalance "Easy" means the bottom of a
    // very good tour field, and it still has to be the bottom.
    const order: TourRival['difficulty'][] = ['Legend', 'Hard', 'Medium', 'Easy'];
    const worstOf = (t: string): number =>
      Math.min(...TOUR_RIVALS.filter((r) => r.difficulty === t).map((r) => entrantOvr(r)));
    const bestOf = (t: string): number =>
      Math.max(...TOUR_RIVALS.filter((r) => r.difficulty === t).map((r) => entrantOvr(r)));
    for (let i = 1; i < order.length; i++) {
      expect(TOUR_RIVALS.some((r) => r.difficulty === order[i]), `${order[i]} tier is empty`).toBe(true);
      expect(worstOf(order[i - 1]), `${order[i - 1]} overlaps ${order[i]}`).toBeGreaterThan(bestOf(order[i]));
    }
  });
});
