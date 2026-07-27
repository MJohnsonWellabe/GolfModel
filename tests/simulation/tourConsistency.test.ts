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
 * finish, the best rival has to be reliably near the top, a mid rival has to
 * sit mid-board, and a major has to cost about ten under to win.
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
/** The owner's "85": whoever's rating sits closest to it. */
const MID = OVR.reduce((best, v, i) => (Math.abs(v - 85) < Math.abs(OVR[best] - 85) ? i : best), 0);
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

  it('a 95 is near the top almost every event; an 85 is mid-board', { timeout: 300_000 }, () => {
    let events = 0;
    let topThree = 0;
    let midBand = 0;
    let easyWins = 0;
    const rhos: number[] = [];
    for (const id of VENUES) {
      for (let ev = 0; ev < EVENTS; ev++) {
        const rank = ranksOf(playEvent(id, ev));
        events++;
        if (rank[TOP] <= 2) topThree++;
        if (rank[MID] >= 3 && rank[MID] <= 7) midBand++;
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
    // "if they're a 95 ai, they should shoot a good score almost every round"
    expect(topThree / events, 'the top rival is not reliably near the top').toBeGreaterThanOrEqual(0.8);
    // "if they're 85 they should be consistently middle of the leaderboard"
    expect(midBand / events, 'the mid rival is not reliably mid-board').toBeGreaterThanOrEqual(0.6);
    // Upsets stay possible but notable — a bottom-tier rival winning outright
    // should be a story, not a Tuesday.
    expect(easyWins / events, 'the weakest rivals win too often').toBeLessThanOrEqual(0.03);
    // And the board as a whole sorts by rating.
    expect(mean(rhos), 'rating barely predicts the finishing order').toBeGreaterThanOrEqual(0.65);
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
