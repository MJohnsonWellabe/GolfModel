import { describe, expect, it } from 'vitest';
import { coursesFor } from '../../src/data/courseRoster';
import { TOUR_RIVALS } from '../../src/data/tourRivals';
import {
  entrantForm,
  entrantOvr,
  hotStreakAt,
  simulateEntrantRound,
  STREAK_MAX_EVENTS,
  STREAK_MIN_EVENTS,
  STREAK_OVR_BONUS,
  streakFormBonus
} from '../../src/systems/AiTournament';
import { completeTourRound, newSeason, TOUR_EVENTS } from '../../src/systems/TourSeason';
import { majorCourseForRound } from '../../src/systems/TourMajorSetup';

/**
 * HOT STREAKS (owner, verbatim): "give some ais random hot streaks where they
 * play higher than their level (+5) for a few weeks."
 *
 * A streak is a temporary FORM bonus laid over a rival's rating for a run of
 * consecutive tour events. Everything below defends one of four properties:
 *
 *   1. DETERMINISM. A shared season exists only because both phones re-derive
 *      the identical AI field from the season seed — see CoopSeason.ts and
 *      recomputeSeasonPoints. A streak decided by Math.random or a clock would
 *      give the two players different leaderboards for the same event, which
 *      is not a bug you can patch around: the season would simply be wrong on
 *      one of the devices.
 *   2. IT IS AN EVENT, NOT THE WEATHER. Only some rivals, only sometimes, and
 *      never for the whole season.
 *   3. IT REACHES THE SCORES. "+5" means the rival plays like a golfer five
 *      overall points better — a real, measurable number of strokes.
 *   4. IT DOES NOT BREAK THE MAJOR. The owner signed off on a major being won
 *      at about −10; a purple patch is allowed to make that harder, not to
 *      rewrite it.
 */

const COURSES = coursesFor({ newCourses: true, courseRebuilds: true });
const VENUES = ['wildwood', 'timberline', 'redhollow', 'maplevale'];
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

/** Season seeds sampled wherever a statistical property is being measured —
 *  including negatives and zero, which a hash written carelessly gets wrong. */
const SEEDS = [0, 1, 7, 42, 1234, 90210, -13, -777, 2147483647, 8675309];

describe('a hot streak is derived, never rolled', () => {
  it('answers the same thing every time it is asked', () => {
    // Two independent computations of the same (seed, rival, event) — the
    // literal shape of "two devices agree about the field".
    for (const seed of SEEDS) {
      for (const r of TOUR_RIVALS) {
        for (let ev = 0; ev < TOUR_EVENTS; ev++) {
          const a = hotStreakAt(seed, r.id, ev);
          const b = hotStreakAt(seed, r.id, ev);
          expect(b).toEqual(a);
        }
      }
    }
  });

  it('depends on all three of the seed, the rival and the event', () => {
    // If it collapsed onto any one of them the feature would degrade into
    // "everybody is hot in season 4" or "Rex is hot forever".
    const perSeed = SEEDS.map((s) =>
      TOUR_RIVALS.map((r) => Array.from({ length: TOUR_EVENTS }, (_, ev) => (hotStreakAt(s, r.id, ev) ? 1 : 0)).join(''))
        .join('|')
    );
    expect(new Set(perSeed).size, 'the season seed does not move the streaks').toBe(SEEDS.length);
    const perRival = TOUR_RIVALS.map((r) =>
      Array.from({ length: TOUR_EVENTS }, (_, ev) => (hotStreakAt(4242, r.id, ev) ? 1 : 0)).join('')
    );
    expect(new Set(perRival).size, 'every rival runs hot at the same time').toBeGreaterThan(1);
  });

  it('a whole tour event re-simulates identically on a second device', () => {
    // The end-to-end version of property 1: two fresh seasons on the same
    // seed, played through the real season path, must produce the same field.
    // Math.random is booby-trapped for the duration, so any hidden entropy —
    // in the streak derivation or anywhere else on this path — fails loudly
    // instead of silently desynchronising a shared season.
    const ids = ['wildwood', 'timberline', 'redhollow', 'maplevale'];
    const realRandom = Math.random;
    Math.random = () => {
      throw new Error('the tour field must be derived from the season seed alone');
    };
    try {
      const a = newSeason(31337);
      const b = newSeason(31337);
      const ra = completeTourRound(a, COURSES, 11, -1, ids)!;
      const rb = completeTourRound(b, COURSES, 17, 5, ids)!; // different player score
      expect(rb.standings.filter((r) => !r.isPlayer)).toEqual(ra.standings.filter((r) => !r.isPlayer));
    } finally {
      Math.random = realRandom;
    }
  });
});

describe('a hot streak is an event, not the weather', () => {
  /** Every rival's hot/cold pattern across a full season, for many seasons:
   *  seasons[season][rival][event]. */
  const seasons = Array.from({ length: 400 }, (_, s) =>
    TOUR_RIVALS.map((r) =>
      Array.from({ length: TOUR_EVENTS }, (_, ev) => hotStreakAt(s * 7919 + 11, r.id, ev) !== null)
    )
  );
  /** Flattened to one row per (season, rival). */
  const patterns = seasons.flat();

  it('catches about one rival in fourteen in any given week', () => {
    const flat = patterns.flat();
    const coverage = flat.filter(Boolean).length / flat.length;
    // Measured ≈0.072 — about four purple patches per sixteen-event season
    // across the whole field. Much lower and the feature never shows up in a
    // season; much higher and "hot" stops meaning anything, because someone
    // always is.
    expect(coverage, `${(coverage * 100).toFixed(1)}% of rival-weeks are hot`).toBeGreaterThan(0.04);
    expect(coverage, `${(coverage * 100).toFixed(1)}% of rival-weeks are hot`).toBeLessThan(0.12);
    // …and in plenty of weeks NOBODY is running hot, which is what makes the
    // weeks somebody is worth noticing. Measured ≈0.47 of all tour stops.
    const weeks = seasons.flatMap((season) =>
      Array.from({ length: TOUR_EVENTS }, (_, ev) => season.filter((rival) => rival[ev]).length)
    );
    const quiet = weeks.filter((n) => n === 0).length / weeks.length;
    expect(quiet, 'somebody is hot every single week').toBeGreaterThan(0.25);
  });

  it('runs for a few weeks and then stops', () => {
    const runs: number[] = [];
    for (const season of patterns) {
      let run = 0;
      for (const hot of season) {
        if (hot) run++;
        else if (run > 0) {
          runs.push(run);
          run = 0;
        }
      }
      // A run still open at event 16 is truncated by the schedule, not by the
      // streak, so it is not evidence about length either way.
      // "Then stops" is the assertion below: nobody is hot all season.
      expect(season.filter(Boolean).length, 'a rival ran hot for a whole season').toBeLessThan(TOUR_EVENTS);
    }
    expect(runs.length, 'no streak ever ended inside a season').toBeGreaterThan(100);
    // "A few weeks": streaks are drawn at 2–4 events. Back-to-back draws can
    // chain into something longer, which is a good story and stays rare, so
    // the guard is on the AVERAGE rather than the maximum.
    expect(mean(runs)).toBeGreaterThanOrEqual(STREAK_MIN_EVENTS);
    expect(mean(runs)).toBeLessThanOrEqual(STREAK_MAX_EVENTS + 1);
  });

  it('covers a contiguous block of events, and both of its ends are real', () => {
    // Pick the first streak the sampler can find and walk it end to end.
    let found: { seed: number; id: string; start: number; length: number } | null = null;
    outer: for (let seed = 1; seed < 400 && !found; seed++) {
      for (const r of TOUR_RIVALS) {
        for (let ev = 1; ev < TOUR_EVENTS - STREAK_MAX_EVENTS; ev++) {
          const w = hotStreakAt(seed, r.id, ev);
          // Only take a streak that starts here AND is not immediately chained
          // into by another, so "the event before is cold" is a real claim.
          if (w && w.start === ev && !hotStreakAt(seed, r.id, ev - 1)) {
            found = { seed, id: r.id, start: w.start, length: w.length };
            break outer;
          }
        }
      }
    }
    expect(found, 'no streak found in 400 seasons — the feature is inert').not.toBeNull();
    const { seed, id, start, length } = found!;
    expect(length).toBeGreaterThanOrEqual(STREAK_MIN_EVENTS);
    expect(length).toBeLessThanOrEqual(STREAK_MAX_EVENTS);
    expect(hotStreakAt(seed, id, start - 1), 'the streak had no beginning').toBeNull();
    for (let ev = start; ev < start + length; ev++) {
      expect(hotStreakAt(seed, id, ev), `event ${ev} fell out of the middle of a streak`).not.toBeNull();
    }
  });
});

describe('a hot streak reaches the scoreboard, and then lets go', () => {
  it('is exactly “plays like a golfer five points better”', () => {
    // The owner's "+5" is a RATING bonus. entrantForm is a line in the rating,
    // so the bonus is derived from that line rather than typed in as strokes —
    // re-tuning the form curve can never silently change what +5 means.
    expect(STREAK_OVR_BONUS).toBe(5);
    for (const ovr of [80, 85.4, 90, 94.4, 95.2]) {
      expect(streakFormBonus(ovr)).toBeCloseTo(entrantForm(ovr + 5) - entrantForm(ovr), 10);
    }
    // …which is a real number of strokes a round, not a rounding artefact.
    expect(streakFormBonus(90)).toBeGreaterThan(1.0);
  });

  it('a rival on a streak beats the same rival off it, shot for shot', { timeout: 300_000 }, () => {
    // Same rival, same course, same physics seeds, same form draw: the ONLY
    // difference between the two columns is whether the season has them hot.
    // So the gap measured here is the streak and nothing else.
    const rival = TOUR_RIVALS.find((r) => r.id === 'pip')!;
    const hotAt: Array<[number, number]> = [];
    const coldAt: Array<[number, number]> = [];
    for (let seed = 1; hotAt.length < 40 || coldAt.length < 40; seed++) {
      for (let ev = 0; ev < TOUR_EVENTS; ev++) {
        const target = hotStreakAt(seed, rival.id, ev) ? hotAt : coldAt;
        if (target.length < 40) target.push([seed, ev]);
      }
      if (seed > 5000) break; // the loop must terminate even if streaks vanish
    }
    expect(hotAt).toHaveLength(40);

    const hot: number[] = [];
    const cold: number[] = [];
    for (const id of VENUES) {
      for (let i = 0; i < 40; i++) {
        const simSeed = 1000 + i * 15013;
        const shiftSeed = (2000 ^ 0x9e3779b9) + i * 8191;
        hot.push(
          simulateEntrantRound(COURSES[id], id, rival, simSeed, shiftSeed, {
            seasonSeed: hotAt[i][0],
            eventIdx: hotAt[i][1]
          }).toPar
        );
        cold.push(
          simulateEntrantRound(COURSES[id], id, rival, simSeed, shiftSeed, {
            seasonSeed: coldAt[i][0],
            eventIdx: coldAt[i][1]
          }).toPar
        );
      }
    }
    const gain = mean(cold) - mean(hot);
    // The paired construction means the expected gain is exactly the form
    // bonus (≈1.4 strokes), blurred only by the stochastic rounding of the
    // half-stroke total.
    expect(gain, `a hot week is worth ${gain.toFixed(2)} strokes`).toBeGreaterThan(
      streakFormBonus(entrantOvr(rival)) - 0.3
    );
    expect(gain).toBeLessThan(streakFormBonus(entrantOvr(rival)) + 0.3);
  });

  it('and gives the strokes back when it ends', { timeout: 300_000 }, () => {
    // Follow ONE rival through ONE season across the seam of a streak: the
    // events inside it score better than the events after it. This is the
    // property that makes a streak a story — it has to be over at some point.
    const rival = TOUR_RIVALS.find((r) => r.id === 'gus')!;
    let seed = 0;
    let start = -1;
    let length = 0;
    for (seed = 1; seed < 2000; seed++) {
      for (let ev = 1; ev < TOUR_EVENTS - STREAK_MAX_EVENTS - 2; ev++) {
        const w = hotStreakAt(seed, rival.id, ev);
        if (w && w.start === ev && !hotStreakAt(seed, rival.id, ev - 1) && !hotStreakAt(seed, rival.id, ev + w.length)) {
          start = w.start;
          length = w.length;
          break;
        }
      }
      if (start >= 0) break;
    }
    expect(start, 'no clean streak-and-recovery found').toBeGreaterThanOrEqual(0);

    const scoresAt = (eventIdx: number): number[] =>
      VENUES.flatMap((id) =>
        Array.from(
          { length: 12 },
          (_, i) =>
            simulateEntrantRound(COURSES[id], id, rival, 4000 + i * 15013, (5000 ^ 0x9e3779b9) + i * 8191, {
              seasonSeed: seed,
              eventIdx
            }).toPar
        )
      );
    const during = mean(scoresAt(start + length - 1));
    const after = mean(scoresAt(start + length));
    expect(after, `the streak never ended (${during.toFixed(2)} hot vs ${after.toFixed(2)} after)`).toBeGreaterThan(
      during + 0.5
    );
  });
});

describe('streaks do not rewrite the calibration the owner signed off on', () => {
  it('a major is still won at about ten under with streaks live', { timeout: 600_000 }, () => {
    // The headline number (owner pass 9: "the rex or legend should be about
    // -10.0 … in a major. it should be hard to win"), measured through the
    // exact seed mix completeTourRound uses, WITH the season context that
    // switches streaks on. The season seed moves per event so each major is an
    // independent draw on who is hot — which is what an average over a career
    // of majors actually looks like.
    const winning: number[] = [];
    for (const id of VENUES) {
      for (let ev = 0; ev < 20; ev++) {
        const cum = TOUR_RIVALS.map(() => 0);
        for (let round = 0; round < 3; round++) {
          const course = majorCourseForRound(COURSES[id], round);
          TOUR_RIVALS.forEach((r, i) => {
            cum[i] += simulateEntrantRound(
              course,
              id,
              r,
              1000 + ev * 15013 + round * 7919 + i * 104729,
              (2000 ^ 0x9e3779b9) + ev * 8191 + round * 6151 + i * 3079,
              { seasonSeed: 4242 + ev * 31, eventIdx: ev % TOUR_EVENTS }
            ).toPar;
          });
        }
        winning.push(Math.min(...cum));
      }
    }
    const avg = mean(winning);
    // Same band tourConsistency pins for the streak-free field: a purple patch
    // is allowed to deepen the odd major, not to move the average out of the
    // range the owner approved.
    expect(avg, `majors are winnable at ${avg.toFixed(2)}`).toBeLessThanOrEqual(-8.5);
    expect(avg, `majors demand ${avg.toFixed(2)} — beyond a human`).toBeGreaterThanOrEqual(-12);
  });
});
