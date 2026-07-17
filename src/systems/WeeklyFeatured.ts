/**
 * Weekly Featured Round (retention plan, Part 8) — one standardized
 * competitive setup per ISO week, derived deterministically from the calendar
 * so every player on any device computes the SAME event with no server
 * authoring required (the admin Live Ops area can later override via config).
 *
 * Standardization: a fixed course rotation by week number and a wind seed
 * hashed from the event id — every entrant plays identical wind/pins (the
 * same shared-seed mechanism tournaments already use). Leaderboard entries
 * persist under `/weekly/{eventId}/entries/{playerId}` (see
 * docs/FIREBASE_SETUP.md): first write per player wins server-side, and the
 * client only submits when the new total beats the local best (duplicate and
 * regression submissions are dropped before the network).
 */

import { mulberry32 } from '../utils/Random';

export interface WeeklyEvent {
  /** Stable id, e.g. 'w2026-29'. */
  id: string;
  /** ISO year + ISO week. */
  isoYear: number;
  isoWeek: number;
  courseId: string;
  /** Shared RNG seed → identical wind/pins for every entrant. */
  seed: number;
  /** Event window (epoch ms, local Monday 00:00 → next Monday 00:00). */
  startMs: number;
  endMs: number;
}

/** The fixed rotation (plan Part 1's canonical course order). */
export const WEEKLY_ROTATION = ['sablebay', 'wildwood', 'timberline', 'portjohnson'] as const;

/** ISO-8601 year/week for a local date. */
export function isoWeekOf(d: Date): { isoYear: number; isoWeek: number } {
  // Thursday of the current week decides the ISO year.
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (t.getDay() + 6) % 7; // Mon=0..Sun=6
  t.setDate(t.getDate() - dayNum + 3);
  const isoYear = t.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const week1Mon = new Date(isoYear, 0, 4 - jan4Day);
  const isoWeek = 1 + Math.round((t.getTime() - week1Mon.getTime()) / (7 * 86400000) - 3 / 7);
  return { isoYear, isoWeek };
}

/** Local Monday 00:00 of the date's ISO week. */
function mondayOf(d: Date): Date {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayNum);
  t.setHours(0, 0, 0, 0);
  return t;
}

/** FNV-1a 32-bit → uint seed for the shared-wind RNG. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The featured event covering `date` (defaults to now). Pure + deterministic. */
export function weeklyEventFor(date: Date): WeeklyEvent {
  const { isoYear, isoWeek } = isoWeekOf(date);
  const id = `w${isoYear}-${String(isoWeek).padStart(2, '0')}`;
  const start = mondayOf(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  // Rotate the course by absolute week count so consecutive weeks always move
  // to the next course (never repeats across an ISO-year boundary).
  const absWeek = Math.floor(start.getTime() / (7 * 86400000));
  const courseId = WEEKLY_ROTATION[((absWeek % WEEKLY_ROTATION.length) + WEEKLY_ROTATION.length) % WEEKLY_ROTATION.length];
  return {
    id,
    isoYear,
    isoWeek,
    courseId,
    seed: hash32(id),
    startMs: start.getTime(),
    endMs: end.getTime()
  };
}

/** Time remaining in the event at `nowMs`, formatted compactly ('3d 4h', '2h'). */
export function weeklyTimeLeft(ev: WeeklyEvent, nowMs: number): string {
  const ms = Math.max(0, ev.endMs - nowMs);
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((ms % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export interface WeeklyEntry {
  playerId: string;
  name: string;
  golferId: string;
  total: number;
  toPar: number;
  holes: number[];
  submittedAt: number;
}

/** Client-side sanity gate (mirrors Tournaments.isPlausibleEntry — the RTDB is
 *  friends-tier trust, documented honestly in the plan). */
export function isPlausibleWeeklyEntry(e: WeeklyEntry, holeCount = 3): boolean {
  if (!e || typeof e.total !== 'number' || !Array.isArray(e.holes)) return false;
  if (e.holes.length !== holeCount) return false;
  if (e.holes.some((h) => typeof h !== 'number' || h < 1 || h > 12)) return false;
  const sum = e.holes.reduce((a, b) => a + b, 0);
  return sum === e.total && e.total >= holeCount && e.total <= holeCount * 12;
}

/** Rank + percentile of a player's best within an entry list (lower total is
 *  better; ties share the better rank). Null when the player has no entry. */
export function weeklyStanding(
  entries: WeeklyEntry[],
  playerId: string
): { rank: number; of: number; percentile: number } | null {
  const valid = entries.filter((e) => isPlausibleWeeklyEntry(e));
  const mine = valid.find((e) => e.playerId === playerId);
  if (!mine) return null;
  const better = valid.filter((e) => e.total < mine.total).length;
  const rank = better + 1;
  const of = valid.length;
  const percentile = of > 1 ? Math.round(((of - rank) / (of - 1)) * 100) : 100;
  return { rank, of, percentile };
}

/** Shared wind for the event's holes — same generator seed for every player. */
export function weeklyWindRoll(ev: WeeklyEvent): () => number {
  return mulberry32(ev.seed);
}
