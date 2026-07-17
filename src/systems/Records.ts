/**
 * Personal records — a trustworthy, versioned record store (retention plan,
 * Part 2). Pure: no DOM, no Firebase. The engine consumes a completed round
 * summary, mutates the record state, and returns exactly the record EVENTS the
 * results screen should surface (records broken or closely approached) — the
 * UI never diffs a spreadsheet.
 *
 * Persistence: rides the profile (see Profile.retention) so it persists
 * locally and syncs through the existing profile architecture. All fields
 * merge grow-only (mergeRecords), so cross-device sync and offline
 * reconciliation can never lose a best or double-award one.
 */

import { RoundStats } from '../data/progression';

export interface CourseBest {
  /** Best (lowest) three-hole total. */
  total: number;
  /** Best score to par (kept in lockstep with total). */
  toPar: number;
  /** Epoch ms when set. */
  at: number;
}

export interface PersonalRecords {
  v: 1;
  /** courseId → best round on that course. */
  bestByCourse: Record<string, CourseBest>;
  /** Best three-hole round to par anywhere. */
  bestRoundToPar: number | null;
  longestPuttFt: number;
  longestDriveYds: number;
  /** Closest approach that finished on the green (feet); null until one lands. */
  closestApproachFt: number | null;
  mostBirdiesRound: number;
  /** Current run of consecutive rounds at par or better. */
  parOrBetterRun: number;
  /** Best such run ever. */
  bestParOrBetterRun: number;
  /** Longest Fire streak (consecutive all-perfect swings while on fire). */
  longestFireStreak: number;
  /** weekly event id → best total/toPar for that event. */
  bestWeekly: Record<string, { total: number; toPar: number }>;
  totalRounds: number;
}

export function emptyRecords(): PersonalRecords {
  return {
    v: 1,
    bestByCourse: {},
    bestRoundToPar: null,
    longestPuttFt: 0,
    longestDriveYds: 0,
    closestApproachFt: null,
    mostBirdiesRound: 0,
    parOrBetterRun: 0,
    bestParOrBetterRun: 0,
    longestFireStreak: 0,
    bestWeekly: {},
    totalRounds: 0
  };
}

/** Coerce any stored/synced shape to a safe PersonalRecords (RTDB drops empty
 *  objects/nulls; older profiles have nothing at all). */
export function migrateRecords(raw: unknown): PersonalRecords {
  const base = emptyRecords();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<PersonalRecords>;
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const bestByCourse: Record<string, CourseBest> = {};
  for (const [k, v] of Object.entries(r.bestByCourse ?? {})) {
    if (v && typeof v.total === 'number') {
      bestByCourse[k] = { total: v.total, toPar: num(v.toPar, 0), at: num(v.at, 0) };
    }
  }
  const bestWeekly: Record<string, { total: number; toPar: number }> = {};
  for (const [k, v] of Object.entries(r.bestWeekly ?? {})) {
    if (v && typeof v.total === 'number') bestWeekly[k] = { total: v.total, toPar: num(v.toPar, 0) };
  }
  return {
    v: 1,
    bestByCourse,
    bestRoundToPar: typeof r.bestRoundToPar === 'number' ? r.bestRoundToPar : null,
    longestPuttFt: num(r.longestPuttFt, 0),
    longestDriveYds: num(r.longestDriveYds, 0),
    closestApproachFt: typeof r.closestApproachFt === 'number' ? r.closestApproachFt : null,
    mostBirdiesRound: num(r.mostBirdiesRound, 0),
    parOrBetterRun: num(r.parOrBetterRun, 0),
    bestParOrBetterRun: num(r.bestParOrBetterRun, 0),
    longestFireStreak: num(r.longestFireStreak, 0),
    bestWeekly,
    totalRounds: num(r.totalRounds, 0)
  };
}

/** Grow-only merge for cross-device sync (mirrors mergeProfiles semantics). */
export function mergeRecords(a: PersonalRecords, b: PersonalRecords): PersonalRecords {
  const out = emptyRecords();
  const courses = new Set([...Object.keys(a.bestByCourse), ...Object.keys(b.bestByCourse)]);
  for (const c of courses) {
    const va = a.bestByCourse[c];
    const vb = b.bestByCourse[c];
    out.bestByCourse[c] = !va ? vb : !vb ? va : va.total <= vb.total ? va : vb;
  }
  const minOrNull = (x: number | null, y: number | null): number | null =>
    x === null ? y : y === null ? x : Math.min(x, y);
  out.bestRoundToPar = minOrNull(a.bestRoundToPar, b.bestRoundToPar);
  out.longestPuttFt = Math.max(a.longestPuttFt, b.longestPuttFt);
  out.longestDriveYds = Math.max(a.longestDriveYds, b.longestDriveYds);
  out.closestApproachFt = minOrNull(a.closestApproachFt, b.closestApproachFt);
  out.mostBirdiesRound = Math.max(a.mostBirdiesRound, b.mostBirdiesRound);
  // The CURRENT run is device-temporal — take the larger (can't reconstruct
  // interleaving); the BEST run merges grow-only.
  out.parOrBetterRun = Math.max(a.parOrBetterRun, b.parOrBetterRun);
  out.bestParOrBetterRun = Math.max(a.bestParOrBetterRun, b.bestParOrBetterRun);
  out.longestFireStreak = Math.max(a.longestFireStreak, b.longestFireStreak);
  const weeks = new Set([...Object.keys(a.bestWeekly), ...Object.keys(b.bestWeekly)]);
  for (const w of weeks) {
    const va = a.bestWeekly[w];
    const vb = b.bestWeekly[w];
    out.bestWeekly[w] = !va ? vb : !vb ? va : va.total <= vb.total ? va : vb;
  }
  out.totalRounds = Math.max(a.totalRounds, b.totalRounds);
  return out;
}

/** What the results screen shows: a record broken, or a near miss framed
 *  positively. `id` is stable for tests/analytics; `label` is player-facing. */
export interface RecordEvent {
  id: string;
  kind: 'broken' | 'near';
  label: string;
}

export interface RoundRecordInput {
  courseId: string;
  courseName: string;
  total: number;
  stats: RoundStats;
  /** Longest fire streak reached this round (0 = never on fire). */
  fireStreakBest?: number;
  /** Closest approach that held the green this round (feet), if any. */
  closestApproachFt?: number | null;
  /** Weekly featured event id when this round was a weekly entry. */
  weeklyEventId?: string;
  /** Epoch ms (injected for determinism). */
  now?: number;
}

/**
 * Fold a completed round into the records. Mutates `rec`; returns the events
 * to surface (already limited to broken records + close near-misses — the
 * results screen can show them directly). A first-ever round on a course sets
 * the baseline silently (a "record" with no history isn't a celebration).
 */
export function applyRoundRecords(rec: PersonalRecords, input: RoundRecordInput): RecordEvent[] {
  const events: RecordEvent[] = [];
  const { stats } = input;
  const now = input.now ?? 0;
  rec.totalRounds += 1;

  // Course best
  const prev = rec.bestByCourse[input.courseId];
  if (!prev) {
    rec.bestByCourse[input.courseId] = { total: input.total, toPar: stats.toPar, at: now };
  } else if (input.total < prev.total) {
    rec.bestByCourse[input.courseId] = { total: input.total, toPar: stats.toPar, at: now };
    events.push({ id: 'course_best', kind: 'broken', label: `New ${input.courseName} best: ${input.total}` });
  } else if (input.total === prev.total) {
    events.push({ id: 'course_best_tie', kind: 'near', label: `Matched your ${input.courseName} best (${prev.total})` });
  } else if (input.total - prev.total === 1) {
    events.push({ id: 'course_best_near', kind: 'near', label: `One stroke from your ${input.courseName} best` });
  }

  // Overall best round
  if (rec.bestRoundToPar === null) {
    rec.bestRoundToPar = stats.toPar;
  } else if (stats.toPar < rec.bestRoundToPar) {
    rec.bestRoundToPar = stats.toPar;
    events.push({ id: 'overall_best', kind: 'broken', label: 'Best round ever!' });
  }

  // Longest made putt
  if (stats.longestPuttMadeFt > rec.longestPuttFt) {
    const had = rec.longestPuttFt > 0;
    rec.longestPuttFt = stats.longestPuttMadeFt;
    if (had) {
      events.push({
        id: 'longest_putt',
        kind: 'broken',
        label: `Longest putt: ${Math.round(stats.longestPuttMadeFt)} ft`
      });
    }
  }

  // Longest drive
  if (stats.longestDriveYds > rec.longestDriveYds) {
    const had = rec.longestDriveYds > 0;
    rec.longestDriveYds = stats.longestDriveYds;
    if (had) {
      events.push({
        id: 'longest_drive',
        kind: 'broken',
        label: `Longest drive: ${Math.round(stats.longestDriveYds)} yds`
      });
    }
  }

  // Closest approach
  const appr = input.closestApproachFt;
  if (typeof appr === 'number' && appr >= 0) {
    if (rec.closestApproachFt === null) {
      rec.closestApproachFt = appr;
    } else if (appr < rec.closestApproachFt) {
      rec.closestApproachFt = appr;
      events.push({ id: 'closest_approach', kind: 'broken', label: `Closest approach: ${appr.toFixed(1)} ft` });
    }
  }

  // Most birdies in a round
  if (stats.birdies > rec.mostBirdiesRound) {
    const had = rec.mostBirdiesRound > 0;
    rec.mostBirdiesRound = stats.birdies;
    if (had && stats.birdies >= 2) {
      events.push({ id: 'most_birdies', kind: 'broken', label: `Most birdies in a round: ${stats.birdies}` });
    }
  }

  // Consecutive rounds at par or better
  if (stats.toPar <= 0) {
    rec.parOrBetterRun += 1;
    if (rec.parOrBetterRun > rec.bestParOrBetterRun) {
      rec.bestParOrBetterRun = rec.parOrBetterRun;
      if (rec.parOrBetterRun >= 3) {
        events.push({
          id: 'par_run',
          kind: 'broken',
          label: `${rec.parOrBetterRun} rounds at par or better in a row`
        });
      }
    }
  } else {
    rec.parOrBetterRun = 0;
  }

  // Longest fire streak
  const fire = input.fireStreakBest ?? 0;
  if (fire > rec.longestFireStreak) {
    const had = rec.longestFireStreak > 0;
    rec.longestFireStreak = fire;
    if (had) events.push({ id: 'fire_streak', kind: 'broken', label: `Longest Fire streak: ${fire}` });
  }

  // Weekly featured best
  if (input.weeklyEventId) {
    const w = rec.bestWeekly[input.weeklyEventId];
    if (!w || input.total < w.total) {
      rec.bestWeekly[input.weeklyEventId] = { total: input.total, toPar: stats.toPar };
      if (w) events.push({ id: 'weekly_best', kind: 'broken', label: `New weekly best: ${input.total}` });
    }
  }

  return events;
}
