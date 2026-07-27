import { describe, expect, it } from 'vitest';
import { coursesFor } from '../../src/data/courseRoster';
import {
  COURSE_FIELD_EASING,
  COURSE_FIELD_EASING_DEFAULT,
  fieldEasingFor
} from '../../src/data/courseDifficulty';
import { TOUR_RIVALS } from '../../src/data/tourRivals';
import { simulateEntrantRound } from '../../src/systems/AiTournament';

/**
 * Pins the owner-pass-8 tour-field recalibration: "The tourneys should be
 * winnable at 3-4 under. Three on a tough course with tough conditions. 4 on
 * a more mild course. There shouldn't be 5 ai tying at 4 under every
 * tournament."
 *
 * TARGET winning score per course (the derivation lives in
 * src/data/courseDifficulty.ts; re-measure with
 * `node scripts/calibrate-tour-field.mjs` — 400-event bootstrap): −3 on
 * courses a modeled expert HUMAN finds hard, sliding to −4 on courses the
 * player scores freely on. The bands below are the 400-event measurement
 * ±0.7 — wide enough for this test's smaller 25-event sample, tight enough
 * that a physics or easing-table drift of a full stroke fails loudly.
 */
const COURSES = coursesFor({ newCourses: true, courseRebuilds: true });

/** Measured E[win] per course, PLUS the pass-9 deepening (0.25/round, and
 *  0.7 for Timberline West) that lifted the major winning total to the −10
 *  the owner asked for. Re-measure with scripts/calibrate-tour-field.mjs.
 *
 *  These numbers SURVIVED the 2026-07 field rebalance unchanged, which is the
 *  point: six contenders instead of two were winning rounds ~0.6 strokes
 *  deeper, so every COURSE_FIELD_EASING entry absorbed its own measured delta
 *  to put the winning score back exactly here. The field got harder to beat by
 *  being deeper, not by scoring lower. */
const MEASURED_WIN: Record<string, number> = {
  wildwood: -3.15,
  sablebay: -3.57,
  timberline: -3.52,
  portjohnson: -3.92,
  timberlinewest: -3.29,
  redhollow: -4.19,
  wildvalley: -3.27,
  maplevale: -4.13,
};

const EVENTS = 25;

interface EventStats {
  best: number;
  bestCount: number;
  tierMean: Record<string, number>;
}

function runEvent(courseId: string, ev: number): EventStats {
  const course = COURSES[courseId];
  const tierSum: Record<string, { s: number; n: number }> = {};
  let best = Infinity;
  let bestCount = 0;
  TOUR_RIVALS.forEach((r, i) => {
    const res = simulateEntrantRound(
      course,
      courseId,
      r,
      1000 + ev * 15013 + i * 104729,
      (2000 ^ 0x9e3779b9) + ev * 8191 + i * 3079
    );
    const t = tierSum[r.difficulty] ?? (tierSum[r.difficulty] = { s: 0, n: 0 });
    t.s += res.toPar;
    t.n += 1;
    if (res.toPar < best) {
      best = res.toPar;
      bestCount = 1;
    } else if (res.toPar === best) bestCount++;
  });
  const tierMean: Record<string, number> = {};
  for (const [k, v] of Object.entries(tierSum)) tierMean[k] = v.s / v.n;
  return { best, bestCount, tierMean };
}

describe('tour field calibration', () => {
  it('every tour course has an explicit, sane easing entry', () => {
    for (const id of Object.keys(MEASURED_WIN)) {
      expect(COURSE_FIELD_EASING, `${id} missing from COURSE_FIELD_EASING`).toHaveProperty(id);
      expect(fieldEasingFor(id)).toBe(COURSE_FIELD_EASING[id]);
    }
    // Easing is a CORRECTION, not a lever — a value outside ±2 strokes/round
    // means the underlying FORM_SHIFT tiers have drifted and should be re-based.
    for (const [id, v] of Object.entries(COURSE_FIELD_EASING)) {
      expect(Math.abs(v), `${id} easing ${v} out of the correction range`).toBeLessThanOrEqual(2);
      expect(COURSES, `${id} eased but not in the roster`).toHaveProperty(id);
    }
    // Unknown ids (daily theme, builder previews) fall back to the default.
    expect(fieldEasingFor('__daily')).toBe(COURSE_FIELD_EASING_DEFAULT);
  });

  it(
    'the field wins at −3 (player-tough) to −4 (player-mild) on every course',
    { timeout: 300_000 },
    () => {
      for (const [id, measured] of Object.entries(MEASURED_WIN)) {
        const wins: number[] = [];
        for (let ev = 0; ev < EVENTS; ev++) wins.push(runEvent(id, ev).best);
        const mean = wins.reduce((a, b) => a + b, 0) / wins.length;
        expect(mean, `${id} E[win] drifted (was ${measured})`).toBeGreaterThan(measured - 0.7);
        expect(mean, `${id} E[win] drifted (was ${measured})`).toBeLessThan(measured + 0.7);
      }
    }
  );

  it('the field spreads: 4+way lead ties are rare, Legends beat Easys', { timeout: 300_000 }, () => {
    let events = 0;
    let bigTies = 0;
    const tier: Record<string, { s: number; n: number }> = {};
    for (const id of Object.keys(MEASURED_WIN)) {
      for (let ev = 0; ev < EVENTS; ev++) {
        const st = runEvent(id, 100 + ev);
        events++;
        if (st.bestCount > 3) bigTies++;
        for (const [k, v] of Object.entries(st.tierMean)) {
          const t = tier[k] ?? (tier[k] = { s: 0, n: 0 });
          t.s += v;
          t.n += 1;
        }
      }
    }
    // "There shouldn't be 5 ai tying at 4 under every tournament."
    //
    // RE-PINNED in the 2026-07 rebalance: with SIX rivals now within a point of
    // each other (owner: "Put 2 players at the level of rex Callaway. Put 2 at
    // the level of Mei Tanaka too."), more of them reach the lead together —
    // pooled P(4+way lead tie) measured 0.02 before and 0.073 after. That is
    // arithmetic, not drift: three times as many golfers can shoot the winning
    // number. The gate moves to 0.13 so it still fails on a real flattening of
    // the field while giving the measured rate room, and the owner's actual
    // complaint — a four-way tie most weeks — remains firmly out of bounds.
    expect(bigTies / events).toBeLessThan(0.13);
    // Skill ordering with real gaps (measured Legend−Easy ≈ 3.3/round after the
    // rebalance, from a Legend tier that is now six deep).
    const mean = (k: string): number => tier[k].s / tier[k].n;
    expect(mean('Legend')).toBeLessThan(mean('Hard'));
    expect(mean('Hard')).toBeLessThan(mean('Medium'));
    expect(mean('Medium')).toBeLessThan(mean('Easy'));
    expect(mean('Easy') - mean('Legend')).toBeGreaterThanOrEqual(1.0);
  });
});
