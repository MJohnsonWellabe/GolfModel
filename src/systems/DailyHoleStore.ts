/**
 * "Did I already play today's hole, and what did I shoot?"
 *
 * One attempt per day is the whole point of a daily: it makes the score mean
 * something and makes the shared result honest. That rule needs somewhere to
 * live, and it is device-local for the same reason the other preferences are —
 * guests must get the daily too, and a daily that only works for signed-in
 * players would be a daily almost nobody plays.
 *
 * This is deliberately NOT anti-cheat. Clearing site data resets it, and that is
 * fine: the daily is a personal streak, and the leaderboard version of it is
 * the server-verified one (systems/RoundVerify.ts).
 */

const KEY = 'bsg.dailyHole.v1';
/** Keep a short history so a streak can be computed without unbounded growth. */
const MAX_DAYS = 60;

export interface DailyPlay {
  dateKey: string;
  strokes: number;
  par: number;
  at: number;
}

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

function readAll(storage: KVStorage | null): DailyPlay[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is DailyPlay =>
        !!p &&
        typeof (p as DailyPlay).dateKey === 'string' &&
        Number.isInteger((p as DailyPlay).strokes) &&
        Number.isInteger((p as DailyPlay).par)
    );
  } catch {
    return [];
  }
}

/** Today's attempt, if it has been played. */
export function loadDailyPlay(dateKey: string, storage: KVStorage | null = defaultStorage()): DailyPlay | null {
  return readAll(storage).find((p) => p.dateKey === dateKey) ?? null;
}

/** Record an attempt. The FIRST attempt for a day wins — replaying to improve
 *  a shared score is exactly what one-attempt-a-day exists to prevent. */
export function saveDailyPlay(play: DailyPlay, storage: KVStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  const all = readAll(storage);
  if (all.some((p) => p.dateKey === play.dateKey)) return false;
  all.push(play);
  all.sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
  try {
    storage.setItem(KEY, JSON.stringify(all.slice(0, MAX_DAYS)));
    return true;
  } catch {
    return false;
  }
}

/** Consecutive days played, counting back from `todayKey`. The number a player
 *  is actually protecting when they come back tomorrow. */
export function dailyStreak(todayKey: string, storage: KVStorage | null = defaultStorage()): number {
  const played = new Set(readAll(storage).map((p) => p.dateKey));
  let streak = 0;
  const day = new Date(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return 0;
  for (;;) {
    const key = day.toISOString().slice(0, 10);
    if (!played.has(key)) break;
    streak++;
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return streak;
}
