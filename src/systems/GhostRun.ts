/**
 * Ghost head-to-head — an opponent's round, replayed shot for shot beside yours.
 *
 * WHY A GHOST AND NOT A LOBBY
 * ---------------------------
 * The single strongest retention mechanic in mobile golf is a named human on
 * the other side of the ball, and this game has never had one: `GameMode` is
 * solo, or 1v1/scramble against AI. Real-time multiplayer would need
 * matchmaking, a relay, latency handling, disconnect policy and a server — none
 * of which exists.
 *
 * A ghost needs none of it. Because rounds are stored as inputs
 * (`systems/RoundRecording.ts`) and the physics is deterministic, an opponent's
 * round can be re-flown exactly as they played it, from a payload small enough
 * to fit in a link. It plays as though they were sitting next to you, and it
 * works offline, against a friend who is asleep, or against your own personal
 * best.
 *
 * WHAT THIS MODULE IS
 * -------------------
 * Pure bookkeeping over a replayed recording: which shot comes next on this
 * hole, what the running score comparison is, who is ahead. The rendering of
 * the ghost ball lives with the scene; the decision of what the ghost DOES
 * lives here, so it can be unit-tested without a GPU.
 */

import { replayRound, ReplayedShot, ReplayOptions } from './RoundReplay';
import { RoundRecording } from './RoundRecording';
import type { CourseData } from '../core/types';

export interface GhostStanding {
  /** Player strokes over the holes BOTH have finished, plus the current hole. */
  you: number;
  ghost: number;
  /** Positive = the ghost is ahead by this many strokes. */
  diff: number;
  label: string;
}

/**
 * A loaded opponent round, ready to play against. Construction replays the
 * whole recording up front (a few milliseconds — the physics is the same code
 * the round itself runs) so no work happens during play.
 */
export class GhostRun {
  private readonly byHole = new Map<number, ReplayedShot[]>();
  readonly name: string;
  readonly scores: number[];
  readonly ok: boolean;
  readonly reason?: string;

  constructor(recording: RoundRecording, course: CourseData, opts: ReplayOptions) {
    this.name = recording.name?.trim() || 'Ghost';
    const replay = replayRound(recording, course, opts);
    this.ok = replay.ok;
    this.reason = replay.reason;
    this.scores = replay.ok ? replay.scores : [];
    for (const hole of replay.holes) this.byHole.set(hole.holeIdx, hole.shots);
  }

  /** The ghost's strokes on a finished hole, or null if it never played it. */
  strokesOn(holeIdx: number): number | null {
    return this.scores[holeIdx] ?? null;
  }

  /**
   * The ghost's Nth shot on a hole (0-based), or null when the ghost had
   * already finished. A ghost that holed out in two while you are playing your
   * fifth simply has nothing left to show, which is itself the message.
   */
  shot(holeIdx: number, shotIdx: number): ReplayedShot | null {
    return this.byHole.get(holeIdx)?.[shotIdx] ?? null;
  }

  shotCount(holeIdx: number): number {
    return this.byHole.get(holeIdx)?.length ?? 0;
  }

  /**
   * Running comparison after `playedHoles` completed holes, with the current
   * hole's strokes so far included on both sides.
   *
   * Deliberately compares LIKE FOR LIKE: the ghost's strokes on the hole you
   * are on are only counted once you have finished it, so the readout never
   * says you are four behind because your opponent already played a hole you
   * have not started.
   */
  standing(yourScores: number[], playedHoles: number, yourStrokesThisHole: number, currentHole: number): GhostStanding {
    let you = 0;
    let ghost = 0;
    for (let h = 0; h < playedHoles; h++) {
      you += yourScores[h] ?? 0;
      ghost += this.scores[h] ?? 0;
    }
    you += yourStrokesThisHole;
    // The ghost's current hole counts only as far as you have played it, so an
    // in-progress hole compares stroke-for-stroke rather than to their total.
    const ghostHere = this.scores[currentHole];
    if (ghostHere !== undefined) ghost += Math.min(ghostHere, yourStrokesThisHole);
    const diff = ghost - you;
    return { you, ghost, diff, label: standingLabel(diff) };
  }
}

/** Human-readable standing. Reads from the PLAYER's point of view. */
export function standingLabel(ghostMinusYou: number): string {
  if (ghostMinusYou === 0) return 'All square';
  const n = Math.abs(ghostMinusYou);
  const s = n === 1 ? '1 shot' : `${n} shots`;
  return ghostMinusYou > 0 ? `You lead by ${s}` : `Down by ${s}`;
}
