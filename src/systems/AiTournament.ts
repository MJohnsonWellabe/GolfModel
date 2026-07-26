import { RULES } from '../config';
import { CourseData, Golfer } from '../core/types';
import { gaussianOf, mulberry32 } from '../utils/Random';
import { fieldEasingFor } from '../data/courseDifficulty';
import { simulateRound } from './RoundSimulator';


/**
 * AI Tournament (the mode that replaced the Ace Challenge): the player grinds
 * three rounds on three different courses against a field of AI pros. The AI
 * never plays on screen — after each of the player's rounds, every entrant's
 * score for that same course is produced by the REAL round simulator
 * (simulateRound: full physics + AI club/target selection with the opponent's
 * actual stats), and the leaderboard updates. Seeds are fixed at creation so
 * the field's scores are already determined the moment the tournament starts —
 * quitting and re-entering can't reroll them.
 */

export interface AiTourEntrant {
  golfer: Golfer;
  difficulty: string;
  /** Strokes per completed round (parallel to toPars). */
  rounds: number[];
  toPars: number[];
}

export interface AiTournamentState {
  /** Course id per round, all distinct. */
  courseIds: string[];
  /** Rounds the player has completed (also the rounds simulated for the field). */
  played: number;
  seed: number;
  player: { rounds: number[]; toPars: number[] };
  field: AiTourEntrant[];
}

export interface StandingRow {
  id: string;
  name: string;
  isPlayer: boolean;
  difficulty?: string;
  total: number;
  toPar: number;
}

export const AI_TOUR_ROUNDS = 3;

/** Coin purse by final position (aligned with the achievement economy:
 *  25–100 per milestone). Everyone below the podium gets field money. */
export const AI_TOUR_PURSE = [100, 60, 40] as const;
export const AI_TOUR_FIELD_COINS = 15;

/** Deterministic order-shuffle of the course pool; the first AI_TOUR_ROUNDS
 *  entries become the rota. With a 4-course pool every tournament plays 3
 *  distinct courses and sits out one. */
export function pickTournamentCourses(courseIds: readonly string[], seed: number): string[] {
  const rng = mulberry32(seed);
  const pool = [...courseIds];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(AI_TOUR_ROUNDS, pool.length));
}

export function createAiTournament(
  courseIds: readonly string[],
  field: ReadonlyArray<Golfer & { difficulty: string }>,
  seed: number
): AiTournamentState {
  return {
    courseIds: pickTournamentCourses(courseIds, seed),
    played: 0,
    seed,
    player: { rounds: [], toPars: [] },
    field: field.map((g) => ({ golfer: g, difficulty: g.difficulty, rounds: [], toPars: [] }))
  };
}

/**
 * "Tournament form": the mean shift each difficulty tier subtracts from the
 * raw simulator round.
 *
 * RE-CALIBRATED (owner pass 8: "multiple people have shot 4 under" every
 * tour event — the old {2.0..2.7} values dated from before the honest-woods
 * physics easings and had drifted ~2 strokes generous). The shift is now
 * tier MINUS a per-course easing (data/courseDifficulty.ts — the sim's
 * difficulty ordering for AIs disagrees with a human's, so one number can't
 * land the winning score everywhere) PLUS a gaussian per-round form draw
 * (FORM_SIGMA) that spreads the field so ten entrants stop stacking on one
 * total. Bootstrap-measured result: the 10-rival tour field's best score
 * lands at −3 (player-tough courses) to −4 (player-mild), Legends beat
 * Easys by ≥1.4/round, and a lead tie is a ~1-in-3 event, mostly 2-way —
 * which is what the playoff is for.
 */
const FORM_SHIFT: Record<string, number> = { Easy: 0.0, Medium: 0.6, Hard: 1.1, Legend: 1.6 };
/** Per-round form spread. sd(round) ≈ √(sim ~1.35² + 0.9²) ≈ 1.6. */
const FORM_SIGMA = 0.9;

/**
 * One AI entrant's round on a course: the REAL round simulator plus the
 * calibrated tournament-form shift for their difficulty tier. Exported so the
 * Tour Season fields its rivals with exactly this math — one calibration,
 * every AI leaderboard. `simSeed` drives the physics round; `shiftSeed` is a
 * TWO-DRAW stream (gaussian form first, then the rounding uniform — the
 * order is part of the seed contract).
 */
export function simulateEntrantRound(
  course: CourseData,
  courseId: string,
  golfer: Golfer,
  difficulty: string,
  simSeed: number,
  shiftSeed: number
): { total: number; toPar: number } {
  const res = simulateRound(course, golfer, simSeed, RULES.holesPerRound);
  const rng = mulberry32(shiftSeed);
  const s = (FORM_SHIFT[difficulty] ?? 0) - fieldEasingFor(courseId) + gaussianOf(rng, 0, FORM_SIGMA);
  // NEGATIVE-SAFE stochastic rounding: `s % 1` flips sign for negative s (a
  // −1.4 would round to −2 with certainty), so round via floor + fraction.
  // The shift may legitimately be negative — on courses the sim underrates
  // (Maple Vale) the field hands strokes BACK.
  const fl = Math.floor(s);
  const shift = fl + (rng() < s - fl ? 1 : 0);
  // Never shift a round below one stroke per hole (absurd floor, unreachable
  // in practice — pure belt-and-braces for tiny custom courses).
  const total = Math.max(RULES.holesPerRound, res.total - shift);
  return { total, toPar: res.toPar - (res.total - total) };
}

/**
 * Record the player's just-finished round and produce the field's scores for
 * the same course. Per-entrant seeds mix the tournament seed with the round
 * and entrant indices (large primes keep the simulator's mulberry streams
 * apart), so every entrant plays a genuinely different — but replayable —
 * round.
 */
export function completeRound(t: AiTournamentState, courses: Record<string, CourseData>, playerTotal: number, playerToPar: number): void {
  if (t.played >= t.courseIds.length) return;
  const course = courses[t.courseIds[t.played]];
  t.player.rounds.push(playerTotal);
  t.player.toPars.push(playerToPar);
  t.field.forEach((e, i) => {
    const res = simulateEntrantRound(
      course,
      t.courseIds[t.played],
      e.golfer,
      e.difficulty,
      t.seed + t.played * 7919 + i * 104729,
      (t.seed ^ 0x9e3779b9) + t.played * 6151 + i * 3079
    );
    e.rounds.push(res.total);
    e.toPars.push(res.toPar);
  });
  t.played++;
}

export function isFinal(t: AiTournamentState): boolean {
  return t.played >= t.courseIds.length;
}

/** Cumulative standings over the rounds played so far, lowest to-par first
 *  (ties: lower raw total, then the player, so a tied player never reads
 *  below an AI with the identical score). */
export function standings(t: AiTournamentState): StandingRow[] {
  const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
  const rows: StandingRow[] = [
    {
      id: 'player',
      name: 'You',
      isPlayer: true,
      total: sum(t.player.rounds),
      toPar: sum(t.player.toPars)
    },
    ...t.field.map((e) => ({
      id: e.golfer.id,
      name: e.golfer.name,
      isPlayer: false,
      difficulty: e.difficulty,
      total: sum(e.rounds),
      toPar: sum(e.toPars)
    }))
  ];
  return rows.sort((a, b) => a.toPar - b.toPar || a.total - b.total || Number(b.isPlayer) - Number(a.isPlayer));
}

/** The player's final purse by placement (1-indexed rank). */
export function purseFor(rank: number): number {
  return AI_TOUR_PURSE[rank - 1] ?? AI_TOUR_FIELD_COINS;
}
