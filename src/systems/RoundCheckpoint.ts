/**
 * Unfinished-round checkpoint — behind the `resumeRound` feature flag.
 *
 * WHY
 * ---
 * The player-experience doc's promise is "open the game, begin a round,
 * complete three holes". Today a player who closes the tab on hole 2 loses the
 * round outright: reopening drops them on the landing with nothing to return
 * to, and the two holes they played are gone. For a first-time player — the
 * one most likely to be interrupted, and the one whose FIRST completed round is
 * the retention event that unlocks daily/weekly/season/store (progressive
 * disclosure, Part 11) — that is the single cheapest abandonment to recover.
 *
 * WHAT IT STORES
 * --------------
 * A HOLE-BOUNDARY checkpoint, never a mid-shot one: the course, the round seed
 * (so wind and pins come back identical), which hole is next, and the scores
 * already in the book. Resuming re-tees the hole that was in progress from its
 * start — the honest, unambiguous behaviour, and the one that needs no snapshot
 * of ball position, lie, stroke count, camera or physics state. Nothing about
 * the swing is restored because nothing about the swing is saved.
 *
 * WHAT IT DOES NOT COVER
 * ----------------------
 * Only plain solo rounds. Versus/scramble rounds carry an opponent's state, AI
 * tournaments span three courses, and weekly/tournament/challenge entries carry
 * submission rules — reviving any of those from a partial record risks a
 * double-submitted or mis-scored entry, which the trust rules in
 * docs/vision/03_PLAYER_EXPERIENCE.md ("be honest about ... leaderboard
 * limitations") say we should not gamble with. Those rounds simply do not
 * checkpoint.
 *
 * Storage is device-local (like DeviceSettings, and for the same reason: an
 * interrupted round is a fact about THIS device, and guests must get it too).
 * The record is versioned and every field is validated on read, so a corrupt or
 * stale entry degrades to "no checkpoint" rather than to a broken round.
 */

const KEY = 'bsg.roundCheckpoint.v1';
const VERSION = 1;

/** Checkpoints older than this are dropped on read — coming back a week later
 *  to "finish" a forgotten round is noise, not a favour. */
export const MAX_AGE_MS = 48 * 60 * 60 * 1000;

export interface RoundCheckpoint {
  v: number;
  courseId: string;
  /** Round seed, so the resumed holes play the same wind and pins. */
  seed: number;
  /** 0-based index of the hole to resume ON (the one that was in progress). */
  holeIdx: number;
  /** Holes in this round, so the card can say "hole 2 of 3". */
  holes: number;
  /** Strokes already recorded, one entry per completed hole. */
  scores: number[];
  /** Par of the holes already completed, for the "+2" readout. */
  parSoFar: number;
  /** Epoch ms of the last checkpoint write. */
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

/** True when the record is structurally sound, in date, and worth resuming.
 *  A checkpoint on hole 1 with nothing played is NOT worth offering — there is
 *  no progress to lose, and "resume" would just be a second Play button. */
export function isResumable(c: RoundCheckpoint | null, now: number): c is RoundCheckpoint {
  if (!c || c.v !== VERSION) return false;
  if (typeof c.courseId !== 'string' || !c.courseId) return false;
  if (!Number.isFinite(c.seed) || !Number.isInteger(c.holeIdx) || c.holeIdx < 0) return false;
  if (!Number.isInteger(c.holes) || c.holes <= 0 || c.holeIdx >= c.holes) return false;
  if (!Array.isArray(c.scores) || c.scores.some((s) => !Number.isFinite(s))) return false;
  if (c.scores.length !== c.holeIdx) return false;
  if (!Number.isFinite(c.at) || now - c.at > MAX_AGE_MS) return false;
  return c.holeIdx > 0;
}

export function loadCheckpoint(
  now: number = Date.now(),
  storage: KVStorage | null = defaultStorage()
): RoundCheckpoint | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RoundCheckpoint;
    return isResumable(parsed, now) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCheckpoint(c: RoundCheckpoint, storage: KVStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Quota/private-mode failures are non-fatal — the round just won't resume.
  }
}

export function clearCheckpoint(storage: KVStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Build the record for "the player is about to play hole `holeIdx`". */
export function checkpointFor(input: {
  courseId: string;
  seed: number;
  holeIdx: number;
  holes: number;
  scores: number[];
  parSoFar: number;
  at: number;
}): RoundCheckpoint {
  return {
    v: VERSION,
    courseId: input.courseId,
    seed: input.seed,
    holeIdx: input.holeIdx,
    holes: input.holes,
    scores: input.scores.slice(0, input.holeIdx),
    parSoFar: input.parSoFar,
    at: input.at
  };
}

/** "+2" / "E" / "-1" for the holes already played. */
export function toParLabel(c: RoundCheckpoint): string {
  const total = c.scores.reduce((a, b) => a + b, 0);
  const diff = total - c.parSoFar;
  return diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
}
