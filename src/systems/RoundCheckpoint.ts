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
 * The course, the round seed (so wind and pins come back identical), which hole
 * was in progress, the scores already in the book — and THE SHOTS PLAYED ON
 * THAT HOLE.
 *
 * It used to store only the hole boundary, so "finish the round" re-teed the
 * hole you were standing in the middle of. That is defensible on paper and
 * infuriating in practice: three good shots into a par 5 you are sent back to
 * the tee, which is a worse offer than starting a new round.
 *
 * What a half-played hole needs is small: where the ball is resting and how
 * many strokes it took to get there. The LIE is not stored because it is not
 * independent — the surface under a point is a property of the hole, so it is
 * read back from the course rather than trusted from a file.
 *
 * Replaying the recorded shots was the other candidate and is worse here: the
 * outcome of a shot depends on the golfer who hit it, and an unlocked loadout
 * re-rolls a different golfer every round — so a replay-based resume would put
 * the ball where a DIFFERENT player's shots would have finished. The resting
 * position has no such coupling.
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
  /**
   * Where the ball was resting on the IN-PROGRESS hole, and the strokes played
   * to get there.
   *
   * Optional together: a checkpoint written before this existed resumes from
   * the tee, which is what it always did. Both or neither — a position without
   * a stroke count would resume the lie and lose the score.
   */
  ball?: { x: number; y: number };
  strokes?: number;
  /** Epoch ms of the last checkpoint write. */
  at: number;
  /** Times a resume of THIS record was attempted (or its round died mid-build
   *  — an iOS tab crash leaves the build breadcrumb) without the round ever
   *  settling again. A fresh checkpoint write resets it (the field is simply
   *  absent). Two strikes retire the record: a checkpoint that white-screens
   *  the device every time it is touched must stop being offered (owner:
   *  "can't resume with the resume button", three crashes in a row). */
  attempts?: number;
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
  if (!Number.isInteger(c.holes) || c.holeIdx > c.holes) return false;
  if (!Number.isFinite(c.at) || now - c.at > MAX_AGE_MS) return false;
  // A partial hole is all-or-nothing: a position without a stroke count would
  // resume the lie and lose the score.
  const partial = c.ball !== undefined || c.strokes !== undefined;
  if (partial) {
    if (!c.ball || !Number.isFinite(c.ball.x) || !Number.isFinite(c.ball.y)) return false;
    if (!Number.isInteger(c.strokes) || (c.strokes ?? 0) <= 0) return false;
  }
  // A record that has crashed the game twice is a trap, not an offer.
  if ((c.attempts ?? 0) >= 2) return false;
  // Progress is now shots OR holes: standing on the 1st green having played
  // three is progress worth returning to, and counting only completed holes is
  // why a mid-hole exit lost everything.
  return c.holeIdx > 0 || partial;
}

/** Strike the stored checkpoint: a resume is being attempted (or the last
 *  page died mid-build). Reads/writes RAW — the record may already be past
 *  isResumable's gates and still deserves the strike. */
export function markResumeAttempt(storage: KVStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as RoundCheckpoint;
    parsed.attempts = (parsed.attempts ?? 0) + 1;
    storage.setItem(KEY, JSON.stringify(parsed));
  } catch {
    /* unreadable record — loadCheckpoint will drop it anyway */
  }
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
  ball?: { x: number; y: number };
  strokes?: number;
}): RoundCheckpoint {
  return {
    v: VERSION,
    courseId: input.courseId,
    seed: input.seed,
    holeIdx: input.holeIdx,
    holes: input.holes,
    scores: input.scores.slice(0, input.holeIdx),
    parSoFar: input.parSoFar,
    at: input.at,
    // Both or neither, and only when there is genuinely a shot in the ground:
    // resuming "on the tee having played 0" is just starting the hole.
    ...(input.ball && (input.strokes ?? 0) > 0
      ? { ball: { x: input.ball.x, y: input.ball.y }, strokes: input.strokes }
      : {})
  };
}

/** "+2" / "E" / "-1" for the holes already played. */
export function toParLabel(c: RoundCheckpoint): string {
  const total = c.scores.reduce((a, b) => a + b, 0);
  const diff = total - c.parSoFar;
  return diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
}
