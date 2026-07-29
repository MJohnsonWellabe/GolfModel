/**
 * Resolves "today's hole": generate, grade, retry, cache.
 *
 * The search is deterministic — candidate N for a date is always the same hole,
 * and the gate is a pure function — so every player independently arrives at
 * the SAME hole for the same day without anyone being told what it is. That is
 * what makes the day's score comparable, and it is why the daily hole needs no
 * server at all.
 *
 * Cost: generation is trivial and each grade is ~140 simulated rounds of pure
 * arithmetic. Resolving a day is a few tens of milliseconds, done once and
 * cached for the rest of the session, off the gameplay path.
 */

import {
  archetypeForDate,
  courseForHole,
  DAILY_ARCHETYPES,
  DailyArchetype,
  DailyHoleSpec,
  generateHole,
  seedForDate,
  themeForDate
} from './DailyHole';
import { gradeHole, HoleGrade } from './DailyHoleGate';
import type { CourseData } from '../core/types';

/** Attempts before giving up on a day. In practice the first few pass; the cap
 *  exists so a future generator change that produces mostly-rejected holes
 *  degrades to "no daily hole today" instead of hanging the boot.
 *
 *  Raised from 24 with the Stage 4 rebuild: the generator now draws far more
 *  dramatic holes (water carries, canyon rims, 640-yard three-shotters), and a
 *  dramatic hole is rejected more often even against the widened per-par band.
 *  A day with no hole at all is a visible hole in the product, so the search
 *  gets more room. Cost is bounded and paid at most once per day, off the
 *  gameplay path — a rejection is ~140 rounds of pure arithmetic. */
const MAX_ATTEMPTS = 60;

/** After this many failures the search stops insisting on the day's archetype
 *  and starts cycling through the others. The archetype is what gives a day its
 *  identity, so it is held as long as it is plausibly findable — but a day with
 *  an archetype that simply cannot be made fair (a par-3-only island green on a
 *  bad seed run) must still produce SOME hole rather than none. */
const ARCHETYPE_LOCK_ATTEMPTS = 24;

export interface DailyHoleResult {
  spec: DailyHoleSpec | null;
  grade: HoleGrade | null;
  /** Every rejection, for the admin/dev readout — this is how you tell whether
   *  the generator is drifting toward unplayable. */
  rejected: Array<{ seed: number; reason: string }>;
}

const cache = new Map<string, DailyHoleResult>();

/**
 * Today's hole. `themeCourses` supplies the shipped courses whose art direction
 * the hole may borrow — passed in so this module never imports the roster (and
 * so tests can pin a single theme).
 */
export function dailyHole(dateKey: string, themeCourses: Record<string, CourseData>): DailyHoleResult {
  const cached = cache.get(dateKey);
  if (cached) return cached;

  const available = Object.keys(themeCourses);
  const themeId = themeForDate(dateKey, available);
  const themeCourse = themeCourses[themeId] ?? Object.values(themeCourses)[0];
  const base = seedForDate(dateKey);
  const dayArchetype = archetypeForDate(dateKey);
  const rejected: Array<{ seed: number; reason: string }> = [];

  let result: DailyHoleResult = { spec: null, grade: null, rejected };
  if (themeCourse) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Distinct, deterministic seed per attempt.
      const seed = (base + attempt * 0x9e3779b1) >>> 0;
      const archetype: DailyArchetype =
        attempt < ARCHETYPE_LOCK_ATTEMPTS
          ? dayArchetype
          : DAILY_ARCHETYPES[(attempt - ARCHETYPE_LOCK_ATTEMPTS) % DAILY_ARCHETYPES.length];
      const hole = generateHole(seed, 1, archetype);
      let course: CourseData;
      try {
        course = courseForHole(hole, themeCourse, `Daily · ${dateKey}`);
      } catch (err) {
        // A candidate the course compiler refuses is simply the next rejection.
        rejected.push({ seed, reason: `compile failed: ${(err as Error).message}` });
        continue;
      }
      const grade = gradeHole(course);
      if (!grade.ok) {
        rejected.push({ seed, reason: grade.reason ?? 'unknown' });
        continue;
      }
      result = {
        spec: {
          dateKey,
          themeId,
          seed,
          archetype,
          par: course.holes[0].par,
          yardage: course.holes[0].yardage,
          attempts: attempt + 1,
          course
        },
        grade,
        rejected
      };
      break;
    }
  }
  cache.set(dateKey, result);
  return result;
}

/** Drop the memo (tests, and the dev date simulator). */
export function clearDailyHoleCache(): void {
  cache.clear();
}

/**
 * Spoiler-free shareable result — the pattern that made Wordle spread. Says how
 * you did without saying anything that helps the next person, so posting it is
 * an invitation rather than a leak.
 */
export function shareText(dateKey: string, par: number, strokes: number): string {
  const toPar = strokes - par;
  const marks =
    toPar <= -2 ? '🦅' : toPar === -1 ? '🐦' : toPar === 0 ? '🟩' : toPar === 1 ? '🟨' : toPar === 2 ? '🟧' : '🟥';
  const label = toPar === 0 ? 'par' : toPar > 0 ? `+${toPar}` : `${toPar}`;
  return `Bite-Sized Golf — Hole of the Day ${dateKey}\n${marks} ${strokes} (${label}) on a par ${par}`;
}
