import { describe, expect, it } from 'vitest';
import { coursesFor } from '../../src/data/courseRoster';
import { applyTeeVariants } from '../../src/systems/Layouts';
import {
  majorCourseForRound,
  majorHoleForRound,
  majorPinForRound,
  majorTeeForRound,
  pinSeverity,
  rankedAuthoredPins
} from '../../src/systems/TourMajorSetup';
import { completeTourRound, newSeason, MAJOR_ROUNDS, TOUR_MAJOR_IDXS } from '../../src/systems/TourSeason';
import { simulateEntrantRound } from '../../src/systems/AiTournament';
import { TOUR_RIVALS } from '../../src/data/tourRivals';

/**
 * MAJOR setup escalation (owner pass 8: "for the 3 rounders they should move
 * the tees progressively harder and the pins progressively harder per day").
 * These gates hold for EVERY course in the roster, so a new course's authored
 * tees/pins are automatically covered.
 */
const COURSES = coursesFor({ newCourses: true, courseRebuilds: true });

describe('major setup escalation', () => {
  it('tees play progressively longer, never shorter, round over round', () => {
    for (const [id, course] of Object.entries(COURSES)) {
      course.holes.forEach((hole, hi) => {
        const g = { x: hole.green.cx, y: hole.green.cy };
        const len = (r: number): number => {
          const t = majorTeeForRound(hole, r);
          return Math.hypot(t.x - g.x, t.y - g.y);
        };
        for (let r = 1; r < MAJOR_ROUNDS; r++) {
          expect(len(r), `${id} hole ${hi + 1} shortened r${r - 1}→r${r}`).toBeGreaterThanOrEqual(len(r - 1));
        }
        // Round 2 is always the authored card's tee.
        expect(majorTeeForRound(hole, 1)).toEqual(hole.tee);
      });
    }
  });

  it('pins play progressively more severe, never kinder, round over round', () => {
    for (const [id, course] of Object.entries(COURSES)) {
      course.holes.forEach((hole, hi) => {
        for (let r = 1; r < MAJOR_ROUNDS; r++) {
          expect(
            pinSeverity(hole, majorPinForRound(hole, r)),
            `${id} hole ${hi + 1} pin eased r${r - 1}→r${r}`
          ).toBeGreaterThanOrEqual(pinSeverity(hole, majorPinForRound(hole, r - 1)) - 1e-9);
        }
        // Escalation is real where the hole authors alternates: three ranked
        // pins mean the championship Sunday pin is strictly harder than
        // Thursday's unless the author placed duplicates.
        const ranked = rankedAuthoredPins(hole);
        if (ranked.length >= 2) {
          expect(pinSeverity(hole, ranked[ranked.length - 1])).toBeGreaterThanOrEqual(
            pinSeverity(hole, ranked[0])
          );
        }
      });
    }
  });

  it('pin severity is judged against the NEAREST green lobe (Wild Prairie h2)', () => {
    const hole = COURSES.wildvalley.holes[1];
    expect(hole.green2).toBeTruthy();
    // The authored card pin sits centered in the SECOND lobe: measured against
    // the main lobe alone it would read as far off the green (the old
    // single-lobe bug ranked it the hole's most severe pin); against its own
    // lobe it is a fair mid-green pin.
    const backLobePin = { x: 492, y: 372 };
    const g = hole.green;
    const rot = g.rot ?? 0;
    const dx = backLobePin.x - g.cx;
    const dy = backLobePin.y - g.cy;
    const lx = dx * Math.cos(-rot) - dy * Math.sin(-rot);
    const ly = dx * Math.sin(-rot) + dy * Math.cos(-rot);
    const mainLobeOnly = Math.hypot(lx / g.rx, ly / g.ry);
    expect(mainLobeOnly).toBeGreaterThan(1); // outside the main lobe entirely
    expect(pinSeverity(hole, backLobePin)).toBeLessThan(0.6); // fair in its own
  });

  it('materialized holes carry no tee variants, so the seeded draw no-ops', () => {
    for (const course of Object.values(COURSES)) {
      const materialized = majorCourseForRound(course, 2);
      for (const h of materialized.holes) expect(h.tees).toBeUndefined();
      // applyTeeVariants finds nothing to vary and returns the SAME object —
      // the setup cannot be re-rolled out from under the round.
      expect(applyTeeVariants(materialized, 12345)).toBe(materialized);
    }
  });

  it('holes without alternates play their authored card all three rounds', () => {
    const bare = {
      ...COURSES.wildvalley.holes[0],
      pins: undefined,
      tees: undefined
    };
    for (let r = 0; r < MAJOR_ROUNDS; r++) {
      const h = majorHoleForRound(bare, r);
      expect(h.tee).toEqual(bare.tee);
      expect(h.pin).toEqual(bare.pin);
    }
  });

  it('the rival field plays the SAME escalated course as the player', () => {
    // Walk a season to its first major on a one-course rotation, then verify
    // each major round's recorded field scores are exactly simulateEntrantRound
    // on the materialized course for that round — the identical function the
    // player's startTourRound builds its live course from.
    const courseIds = ['wildvalley'];
    const s = newSeason(424242);
    for (let ev = 0; ev < TOUR_MAJOR_IDXS[0]; ev++) {
      const out = completeTourRound(s, COURSES, 11, 0, courseIds);
      expect(out?.eventDone).toBe(true);
    }
    // The rival totals the major SHOULD record: each round simulated on that
    // round's materialized course, with completeTourRound's exact seed mix.
    const expected = (r: number): number[] =>
      TOUR_RIVALS.map(
        (riv, i) =>
          simulateEntrantRound(
            majorCourseForRound(COURSES.wildvalley, r),
            'wildvalley',
            riv,
            s.seed + TOUR_MAJOR_IDXS[0] * 15013 + r * 7919 + i * 104729,
            (s.seed ^ 0x9e3779b9) + TOUR_MAJOR_IDXS[0] * 8191 + r * 6151 + i * 3079
          ).total
      );
    completeTourRound(s, COURSES, 11, 0, courseIds);
    expect(s.activeEvent!.fieldTotals.map((t) => t[0])).toEqual(expected(0));
    completeTourRound(s, COURSES, 11, 0, courseIds);
    expect(s.activeEvent!.fieldTotals.map((t) => t[1])).toEqual(expected(1));
    // The final round clears activeEvent, so read it off the outcome's
    // standings: every rival's event total must be their three rounds summed.
    const final = completeTourRound(s, COURSES, 11, 0, courseIds)!;
    expect(final.eventDone).toBe(true);
    const perRival = [expected(0), expected(1), expected(2)];
    for (let i = 0; i < TOUR_RIVALS.length; i++) {
      const row = final.standings.find((x) => x.id === TOUR_RIVALS[i].id)!;
      expect(row.total).toBe(perRival[0][i] + perRival[1][i] + perRival[2][i]);
    }
  });
});
