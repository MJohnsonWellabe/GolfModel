/**
 * Score verification by re-simulation.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Every leaderboard in the game — weekly featured, tournaments, async
 * challenges — currently accepts whatever score the client sends.
 * docs/21_RETENTION_AND_PERFORMANCE_PASS.md is honest about it ("friends-tier
 * trust; server-authoritative validation would need Cloud Functions"), and that
 * honesty is the right call for a small circle of friends. It stops being the
 * right call the moment anyone cares about the standings, because a leaderboard
 * that cannot be trusted is not a leaderboard.
 *
 * THE APPROACH
 * ------------
 * Most games cannot verify a score server-side: their physics is entangled with
 * their renderer, so the only machine that can reproduce a shot is the one that
 * played it. This one can. `PhysicsEngine` is pure, deterministic and
 * Babylon-free, so a submission carrying the player's INPUTS
 * (`systems/RoundRecording.ts`) can be replayed anywhere — in a Cloud Function,
 * in CI, in a unit test — and the score it really produces compared with the
 * score it claims.
 *
 * A cheat must therefore produce an input sequence that genuinely holes out in
 * the claimed number of strokes under the round's real wind and pins. That is
 * not "hard to forge"; it is indistinguishable from playing well, which is
 * exactly the property a leaderboard wants.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not stop an assisted CLIENT (a bot that computes perfect inputs and
 * feeds them to the real game). No client-side game can. It closes the entire
 * class of trivial attacks — editing a score before it is sent — which is the
 * only one anybody actually performs against a game this size.
 */

import { replayRound, ReplayOptions } from './RoundReplay';
import { isValidRecording, RoundRecording } from './RoundRecording';
import type { CourseData } from '../core/types';

export type VerifyStatus =
  | 'verified'
  | 'malformed'
  | 'unknown-course'
  | 'score-mismatch'
  | 'unfinished'
  | 'replay-failed';

export interface VerifyResult {
  status: VerifyStatus;
  ok: boolean;
  /** Score the inputs actually produce. */
  actualTotal: number;
  /** Score the submission claimed. */
  claimedTotal: number;
  actualScores: number[];
  detail?: string;
}

/**
 * Replay a submitted recording and decide whether its claimed score is real.
 *
 * `courses` is injected rather than imported so the same function runs against
 * the client's roster in the browser and against a bundled snapshot in a Cloud
 * Function.
 */
export function verifyRecording(
  rec: unknown,
  courses: Record<string, CourseData>,
  opts: ReplayOptions
): VerifyResult {
  const empty = { actualTotal: 0, claimedTotal: 0, actualScores: [] as number[] };
  if (!isValidRecording(rec)) {
    return { status: 'malformed', ok: false, ...empty };
  }
  const recording = rec as RoundRecording;
  const course = courses[recording.courseId];
  if (!course) {
    return { status: 'unknown-course', ok: false, ...empty, detail: recording.courseId };
  }

  const replay = replayRound(recording, course, opts);
  const claimedTotal = recording.scores.reduce((a, b) => a + b, 0);
  if (!replay.ok) {
    return {
      status: 'replay-failed',
      ok: false,
      actualTotal: 0,
      claimedTotal,
      actualScores: [],
      detail: replay.reason
    };
  }

  // Every hole must have actually finished — either holed out, conceded inside
  // the gimme radius, or picked up at the stroke cap. A recording that simply
  // stops short would otherwise "verify" at a flattering score.
  const unfinished = replay.holes.find((h) => !h.holed && !h.pickedUp);
  if (unfinished) {
    return {
      status: 'unfinished',
      ok: false,
      actualTotal: replay.total,
      claimedTotal,
      actualScores: replay.scores,
      detail: `hole ${unfinished.holeIdx + 1} never finished`
    };
  }

  const mismatch = replay.scores.findIndex((s, i) => s !== recording.scores[i]);
  if (mismatch >= 0) {
    return {
      status: 'score-mismatch',
      ok: false,
      actualTotal: replay.total,
      claimedTotal,
      actualScores: replay.scores,
      detail: `hole ${mismatch + 1}: claimed ${recording.scores[mismatch]}, replayed ${replay.scores[mismatch]}`
    };
  }

  return {
    status: 'verified',
    ok: true,
    actualTotal: replay.total,
    claimedTotal,
    actualScores: replay.scores
  };
}
