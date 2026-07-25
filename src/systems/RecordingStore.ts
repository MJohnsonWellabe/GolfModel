/**
 * Device-local library of finished round recordings.
 *
 * Two jobs:
 *
 *   1. **Your own ghosts.** The best round you have played on a course is the
 *      most motivating opponent available offline, and the only one guaranteed
 *      to exist for a brand-new player with no friends in the game. Keeping the
 *      best recording per (course, seed-independent) key gives "race your
 *      personal best" for free.
 *   2. **A share/verify source.** A finished recording is what a challenge link
 *      or a leaderboard submission carries, so it has to survive the round that
 *      produced it.
 *
 * Bounded on purpose: recordings are small (<1 KB) but localStorage is not, and
 * an unbounded log would eventually break saving PROGRESS, which matters more.
 * The store keeps the best round per course and nothing else — a strictly
 * better round replaces the one it beats, so the library size is the size of
 * the course roster.
 */

import { isValidRecording, RoundRecording } from './RoundRecording';

const KEY = 'bsg.recordings.v1';
/** Hard ceiling regardless of roster size — a corrupted or hand-edited entry
 *  cannot grow the store without bound. */
const MAX_ENTRIES = 24;

export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): KVStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function total(rec: RoundRecording): number {
  return rec.scores.reduce((a, b) => a + b, 0);
}

/** Every stored recording, newest-best first. Invalid entries are dropped. */
export function loadRecordings(storage: KVStorage | null = defaultStorage()): RoundRecording[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRecording).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Store a recording if it is the best round yet on its course. Returns true
 * when it was kept.
 *
 * "Best" is fewest strokes, ties going to the EXISTING entry — a player who
 * matches their best keeps the ghost they already know, rather than silently
 * swapping it for an identical-scoring one.
 */
export function saveRecording(
  rec: RoundRecording,
  storage: KVStorage | null = defaultStorage()
): boolean {
  if (!storage || !isValidRecording(rec)) return false;
  const all = loadRecordings(storage);
  const existing = all.find((r) => r.courseId === rec.courseId && r.holes === rec.holes);
  if (existing && total(existing) <= total(rec)) return false;
  const next = all.filter((r) => r !== existing);
  next.push(rec);
  next.sort((a, b) => total(a) - total(b));
  try {
    storage.setItem(KEY, JSON.stringify(next.slice(0, MAX_ENTRIES)));
    return true;
  } catch {
    // Quota exhausted — a lost ghost is a far better outcome than a lost
    // profile, so this fails quietly rather than evicting anything else.
    return false;
  }
}

/** The player's best recorded round on a course, if any. */
export function bestRecordingFor(
  courseId: string,
  holes: number,
  storage: KVStorage | null = defaultStorage()
): RoundRecording | null {
  const matches = loadRecordings(storage).filter((r) => r.courseId === courseId && r.holes === holes);
  if (!matches.length) return null;
  return matches.reduce((best, r) => (total(r) < total(best) ? r : best));
}

export function clearRecordings(storage: KVStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
