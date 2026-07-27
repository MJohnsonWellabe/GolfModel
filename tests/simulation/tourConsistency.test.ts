import { describe, expect, it } from 'vitest';
import { coursesFor } from '../../src/data/courseRoster';
import { TOUR_RIVALS } from '../../src/data/tourRivals';
import { entrantForm, entrantOvr, entrantSigma, simulateEntrantRound } from '../../src/systems/AiTournament';
import { majorCourseForRound, MAJOR_WIND_RAMP } from '../../src/systems/TourMajorSetup';

/**
 * RIVAL IDENTITY (owner pass 9, verbatim): "the same ai should generally be
 * good most tourneys. ie the ai should get a stat and just keep that stat. if
 * they're a 95 ai, they should shoot a good score almost every round. if
 * they're 85 they should be consistently middle of the leaderboard." And:
 * "the rex or legend should be about -10.0 … in a major. it should be hard to
 * win."
 *
 * Those sentences are the gates below. They are deliberately about the SHAPE
 * of a leaderboard rather than any single score: a rating has to predict a
 * finish, the strong have to be reliably near the top, the weak have to be
 * reliably behind them, and a major has to cost about ten under to win.
 *
 * RE-PINNED FOR THE 2026-07 REBALANCE (owner: "Put 2 players at the level of
 * rex Callaway. Put 2 at the level of Mei Tanaka too."). The old gate on the
 * single best rival — P(top rival finishes top-3) ≥ 0.8 — measured 0.94–1.00
 * when exactly two rivals could contend. With SIX in that band the same number
 * is arithmetically unreachable: half a dozen near-equal golfers cannot each
 * own a top-three slot, and the one who does own it changes week to week. That
 * is the requested field, not a regression, so the gate moved deliberately:
 * the claim is now about the TOP CLASS (the six own the podium and supply the
 * winner) plus the top rival still finishing in the upper half nearly every
 * week. Everything the owner actually asked for — a rating predicts a finish,
 * the best is reliably good, the weakest essentially never wins — is still
 * pinned, and ρ (0.77–0.91 before) is measured below and still gated.
 *
 * These gates measure the BASE field, with no season context, so no hot streak
 * can colour them; the streak-side numbers live in tourHotStreaks.test.ts.
 *
 * Re-measure with `node scripts/calibrate-tour-field.mjs`, which prints every
 * number pinned here over a much larger sample.
 */

const COURSES = coursesFor({ newCourses: true, courseRebuilds: true });
/** A representative spread: player-tough, mid, and player-mild venues. */
const VENUES = ['wildwood', 'timberline', 'redhollow', 'maplevale'];
const EVENTS = 20;

const OVR = TOUR_RIVALS.map((r) => entrantOvr(r));
const TOP = OVR.indexOf(Math.max(...OVR));
/** The contenders: the six at Rex's and Mei's level. */
const ELITE = TOUR_RIVALS.map((r, i) => (r.difficulty === 'Legend' ? i : -1)).filter((i) => i >= 0);
/** The chasing pack: everyone else. After the floor lift they are good
 *  players — they are just not these six. */
const PACK = TOUR_RIVALS.map((r, i) => (r.difficulty === 'Legend' ? -1 : i)).filter((i) => i >= 0);
const EASY = TOUR_RIVALS.map((r, i) => (r.difficulty === 'Easy' ? i : -1)).filter((i) => i >= 0);

const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

/** One event's per-rival toPars, using completeTourRound's own seed mix. */
function playEvent(courseId: string, ev: number, round = 0, major = false): number[] {
  const course = major ? majorCourseForRound(COURSES[courseId], round) : COURSES[courseId];
  return TOUR_RIVALS.map(
    (r, i) =>
      simulateEntrantRound(
        course,
        courseId,
        r,
        1000 + ev * 15013 + round * 7919 + i * 104729,
        (2000 ^ 0x9e3779b9) + ev * 8191 + round * 6151 + i * 3079
      ).toPar
  );
}

/** Finishing rank per rival (0 = best). Ties break toward the higher rating so
 *  the metric measures the scoring model, not the tie-break. */
function ranksOf(toPars: number[]): number[] {
  const order = [...TOUR_RIVALS.keys()].sort((a, b) => toPars[a] - toPars[b] || OVR[b] - OVR[a]);
  const rank = Array(TOUR_RIVALS.length).fill(0);
  order.forEach((idx, r) => (rank[idx] = r));
  return rank;
}

describe('a rating is an identity, not a die roll', () => {
  it('the form curve is monotonic in rating, and steadier at the top', () => {
    // Every rival owns a distinct mean — the flaw the tiers had was Rex and
    // Mei (95.2 vs 94.4) sharing one.
    const forms = TOUR_RIVALS.map((r) => entrantForm(entrantOvr(r)));
    for (let i = 0; i < TOUR_RIVALS.length; i++) {
      for (let j = 0; j < TOUR_RIVALS.length; j++) {
        if (OVR[i] <= OVR[j]) continue;
        expect(forms[i], `${TOUR_RIVALS[i].id} should out-form ${TOUR_RIVALS[j].id}`).toBeGreaterThan(forms[j]);
      }
    }
    expect(new Set(forms).size).toBe(TOUR_RIVALS.length);
    // The better the player, the less they bounce week to week.
    expect(entrantSigma(96)).toBeLessThan(entrantSigma(85));
    expect(entrantSigma(85)).toBeLessThan(entrantSigma(80));
    // …bounded at both ends, so no rating is either a metronome or a lottery.
    expect(entrantSigma(120)).toBeGreaterThan(0.3);
    expect(entrantSigma(40)).toBeLessThan(0.9);
  });

  it('the same seeds always produce the same scores', () => {
    expect(playEvent('wildwood', 7)).toEqual(playEvent('wildwood', 7));
    expect(playEvent('wildwood', 7)).not.toEqual(playEvent('wildwood', 8));
  });

  it('the six contenders own the top of the board; the pack chases', { timeout: 300_000 }, () => {
    let events = 0;
    let topHalf = 0;
    let eliteWins = 0;
    let packBelow = 0;
    let easyWins = 0;
    const rhos: number[] = [];
    for (const id of VENUES) {
      for (let ev = 0; ev < EVENTS; ev++) {
        const rank = ranksOf(playEvent(id, ev));
        events++;
        if (rank[TOP] < TOUR_RIVALS.length / 2) topHalf++;
        if (ELITE.some((i) => rank[i] === 0)) eliteWins++;
        if (PACK.every((i) => rank[i] >= TOUR_RIVALS.length / 2)) packBelow++;
        if (EASY.some((i) => rank[i] === 0)) easyWins++;
        // Spearman ρ between rating order and finishing order.
        const byOvr = [...OVR.keys()].sort((a, b) => OVR[b] - OVR[a]);
        const ovrRank = Array(OVR.length).fill(0);
        byOvr.forEach((idx, r) => (ovrRank[idx] = r));
        const n = OVR.length;
        let d2 = 0;
        for (let i = 0; i < n; i++) d2 += (ovrRank[i] - rank[i]) ** 2;
        rhos.push(1 - (6 * d2) / (n * (n * n - 1)));
      }
    }
    // "if they're a 95 ai, they should shoot a good score almost every round" —
    // now that six rivals are within a point of each other, the honest version
    // of that sentence is the upper HALF of the board rather than the top three.
    expect(topHalf / events, 'the top rival is not reliably near the top').toBeGreaterThanOrEqual(0.8);
    // …and the tournament belongs to that six. If the pack started winning, the
    // six ratings at the top would have stopped meaning anything.
    expect(eliteWins / events, 'the contenders do not own the trophy').toBeGreaterThanOrEqual(0.85);
    // The mirror image of the old "an 85 is mid-board": every member of the
    // chasing pack finishes in the bottom half, most weeks.
    expect(packBelow / events, 'the pack is not reliably behind the six').toBeGreaterThanOrEqual(0.5);
    // Upsets stay possible but notable — the weakest rival winning outright
    // should be a story, not a Tuesday.
    expect(easyWins / events, 'the weakest rivals win too often').toBeLessThanOrEqual(0.03);
    // And the board as a whole still sorts by rating. ρ drops from the pre-
    // rebalance 0.77–0.91 for a reason that is not a defect: six near-equal
    // ratings genuinely cannot be told apart by one round, so their internal
    // order is close to a coin toss. What must survive is that the six beat the
    // four, which is most of the signal — measured ≈0.70.
    expect(mean(rhos), 'rating barely predicts the finishing order').toBeGreaterThanOrEqual(0.6);
  });
});

describe('a major is hard to win', () => {
  it('the championship breeze is a tilt, not a cliff', () => {
    expect(MAJOR_WIND_RAMP[0]).toBe(0);
    for (let r = 1; r < MAJOR_WIND_RAMP.length; r++) {
      expect(MAJOR_WIND_RAMP[r]).toBeGreaterThan(MAJOR_WIND_RAMP[r - 1]);
    }
    expect(Math.max(...MAJOR_WIND_RAMP)).toBeLessThanOrEqual(3);
    // It reaches the field through the materialized course (and the player
    // through the same object — startTourRound plays exactly this).
    const base = COURSES.wildwood;
    const sunday = majorCourseForRound(base, 2);
    expect(sunday.minWind).toBe((base.minWind ?? 2) + MAJOR_WIND_RAMP[2]);
    expect(sunday.maxWind).toBe((base.maxWind ?? 20) + MAJOR_WIND_RAMP[2]);
  });

  it('winning a major takes about ten under', { timeout: 300_000 }, () => {
    const winning: number[] = [];
    for (const id of VENUES) {
      for (let ev = 0; ev < EVENTS; ev++) {
        const cum = TOUR_RIVALS.map(() => 0);
        for (let r = 0; r < 3; r++) {
          playEvent(id, 5000 + ev, r, true).forEach((v, i) => (cum[i] += v));
        }
        winning.push(Math.min(...cum));
      }
    }
    // Owner: "the rex or legend should be about -10.0 … it should be hard to
    // win." Pooled across venues — a player-tough course naturally sits a
    // little above the mark and a player-mild one below it.
    const avg = mean(winning);
    expect(avg, `majors are winnable at ${avg.toFixed(2)}`).toBeLessThanOrEqual(-8.5);
    expect(avg, `majors demand ${avg.toFixed(2)} — beyond a human`).toBeGreaterThanOrEqual(-12);
  });
});
