/**
 * A round, stored as the INPUTS that produced it rather than the score it
 * produced.
 *
 * WHY THIS IS THE KEYSTONE
 * ------------------------
 * Everything the game wants to do with a finished round — verify it, race a
 * friend's ghost against it, replay it, share it, spectate it — needs the same
 * thing: the ability to reproduce the round. Storing the score gives you none
 * of that and asks you to trust the client. Storing the shots gives you all of
 * it, because this game's physics is pure and deterministic: the same seed,
 * course, golfer and inputs always produce the same ball flight, on any
 * machine, in a browser or in a Cloud Function.
 *
 * WHAT A SHOT IS
 * --------------
 * `PhysicsEngine.resolveLaunch` takes: origin, aim, swing, club, golfer, fire
 * boost, lie, wind, hole, spin, launch/risk multipliers and the stroke count.
 * Of those, only the ones a HUMAN chose need storing — origin, lie, wind and
 * stroke count are consequences of the previous shots and the seed, and the
 * golfer is a property of the round. So a shot is eleven numbers, and a
 * three-hole round is typically a dozen shots.
 *
 * SIZE
 * ----
 * ~40 bytes per shot uncompressed as JSON; a full round is well under 1 KB,
 * which is small enough to put in a challenge URL, a database row, or a
 * leaderboard entry without a second thought.
 *
 * WIRE FORMAT
 * -----------
 * Field names are short and MUST NOT change meaning — recordings are persisted,
 * shared between players, and re-read by the verifier. Add fields, never
 * repurpose them, and bump `v` when the meaning of an existing field changes.
 */

import type { Band, GolferStats } from '../core/types';

/** One human shot: everything the player decided, nothing that was derived. */
export interface ShotInput {
  /** 0-based hole index within the round. */
  h: number;
  /** Aim angle in radians. */
  a: number;
  /** Club id ('driver', '7i', 'putter', …). */
  c: string;
  /** Physics power (already converted from meter-bar units). */
  p: number;
  /** Power band at the lock. */
  pq: Band;
  /** Signed accuracy offset, -1..1. */
  ac: number;
  /** Accuracy band at the lock. */
  aq: Band;
  /** Pre-shot shape: side spin (draw/fade) and top spin, from the strike pad. */
  ss: number;
  st: number;
  /** Launch multiplier from the strike-pad vertical position. */
  lm: number;
  /** Risk multiplier from how far the strike dot was pushed. */
  rm: number;
  /** In-flight swipe spin, if the player worked the ball in the air. The live
   *  code re-integrates the SAME resolved launch with the new spin applied from
   *  the playback step the swipe landed on (`HoleScene.applySwipeSpin`), and
   *  each swipe supersedes the last — so the final state is fully described by
   *  the last spin and the step it was applied from. Replaying with the spin
   *  applied from step 0 instead would put the ball somewhere else entirely. */
  fs?: number;
  ft?: number;
  /** Playback step the final swipe was applied from. */
  fst?: number;
}

export interface RecordedGolfer {
  character: string;
  archetype: string;
  /** Club upgrade tiers by family, so a shot resolves with the same clubs. */
  upgrades?: Record<string, number>;
  /** CAREER MODE: the Pro's attributes AS PLAYED, present exactly when
   *  archetype === 'career'. The career golfer's stats live on the profile
   *  and keep growing, so a replay that read the live profile would assemble
   *  a STRONGER golfer than the round was played with and reject an honest
   *  score — the same failure the recorded upgrades/perk exist to prevent. */
  career?: GolferStats;
}

export interface RoundRecording {
  v: number;
  courseId: string;
  seed: number;
  /** Holes played (the round length, not the course length). */
  holes: number;
  golfer: RecordedGolfer;
  shots: ShotInput[];
  /** The client's claimed strokes per hole — what the verifier checks. */
  scores: number[];
  /** Epoch ms the round finished. */
  at: number;
  /** Display name of the player, for ghost labels. Never used for identity. */
  name?: string;
  /** The season-pass perk equipped for this round, if any. Perks change the
   *  golfer's stats and perfect-zone width, so a replay that did not know about
   *  one would assemble a WEAKER golfer than the round was played with — the
   *  same failure the recorded character and archetype exist to prevent. */
  pk?: string;
  /** This round drew the ease-in (kindest) pins rather than the seeded ones —
   *  see `easeIn`. The pin is otherwise derived purely from the seed, so a
   *  replay that did not know this would play the round into a DIFFERENT cup
   *  than the player did and reject an honest score. Absent/false = seeded
   *  pins, which is every round except a device's first few casual ones. */
  gp?: boolean;
}

export const RECORDING_VERSION = 1;

/**
 * Accumulates shots during a live round. The game hands it one entry per stroke
 * as the shot resolves; nothing here touches physics, rendering or storage, so
 * it is safe to call from the shot path.
 */
export class RoundRecorder {
  private shots: ShotInput[] = [];
  private active = false;

  /** Begin recording. Discards anything from a previous round. */
  start(): void {
    this.shots = [];
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  isRecording(): boolean {
    return this.active;
  }

  /** Record one human stroke. AI strokes are never recorded — a ghost of an AI
   *  is just the AI, and a verifier re-derives AI play from the seed. */
  add(shot: ShotInput): void {
    if (!this.active) return;
    this.shots.push(shot);
  }

  /** Attach in-flight swipe spin to the shot currently in the air. Called on
   *  every swipe; the last call wins, mirroring how the live re-integration
   *  discards the previous one. */
  setFlightSpin(side: number, top: number, fromStep: number): void {
    const last = this.shots[this.shots.length - 1];
    if (!last) return;
    last.fs = side;
    last.ft = top;
    last.fst = fromStep;
  }

  shotCount(): number {
    return this.shots.length;
  }


  /** Seal the recording. Returns null when nothing was recorded. */
  finish(meta: {
    courseId: string;
    seed: number;
    holes: number;
    golfer: RecordedGolfer;
    scores: number[];
    at: number;
    name?: string;
    gentlePins?: boolean;
    perkId?: string | null;
  }): RoundRecording | null {
    this.active = false;
    if (!this.shots.length) return null;
    return {
      v: RECORDING_VERSION,
      courseId: meta.courseId,
      seed: meta.seed,
      holes: meta.holes,
      golfer: meta.golfer,
      shots: this.shots.slice(),
      scores: meta.scores.slice(0, meta.holes),
      at: meta.at,
      name: meta.name,
      ...(meta.perkId ? { pk: meta.perkId } : {}),
      // Only written when true, so the common case costs nothing on the wire
      // and old recordings (no field) mean what they always meant: seeded pins.
      ...(meta.gentlePins ? { gp: true } : {})
    };
  }
}

const BANDS: readonly Band[] = ['perfect', 'good', 'miss'];

/** Structural validation. A recording that fails this is never replayed — a
 *  malformed one could otherwise drive the physics engine with NaNs. */
export function isValidRecording(r: unknown): r is RoundRecording {
  const rec = r as RoundRecording | null;
  if (!rec || typeof rec !== 'object') return false;
  if (rec.v !== RECORDING_VERSION) return false;
  if (typeof rec.courseId !== 'string' || !rec.courseId) return false;
  if (!Number.isFinite(rec.seed)) return false;
  if (!Number.isInteger(rec.holes) || rec.holes <= 0 || rec.holes > 18) return false;
  if (!rec.golfer || typeof rec.golfer.character !== 'string' || typeof rec.golfer.archetype !== 'string') {
    return false;
  }
  if (!Array.isArray(rec.shots) || !rec.shots.length || rec.shots.length > 400) return false;
  if (!Array.isArray(rec.scores) || rec.scores.length !== rec.holes) return false;
  if (rec.scores.some((s) => !Number.isInteger(s) || s < 1 || s > 20)) return false;
  for (const s of rec.shots) {
    if (!Number.isInteger(s.h) || s.h < 0 || s.h >= rec.holes) return false;
    if (typeof s.c !== 'string' || !s.c) return false;
    for (const n of [s.a, s.p, s.ac, s.ss, s.st, s.lm, s.rm]) {
      if (!Number.isFinite(n)) return false;
    }
    // Bounds mirror what the controls can physically produce; anything outside
    // is either corruption or a tampered submission.
    if (s.p < 0 || s.p > 2) return false;
    if (s.ac < -2 || s.ac > 2) return false;
    if (!BANDS.includes(s.pq) || !BANDS.includes(s.aq)) return false;
  }
  return true;
}

/** Shots for one hole, in play order. */
export function shotsForHole(rec: RoundRecording, holeIdx: number): ShotInput[] {
  return rec.shots.filter((s) => s.h === holeIdx);
}
