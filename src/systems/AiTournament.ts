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
 * "TOURNAMENT FORM" — how much better than the raw simulator an entrant
 * plays, as a CONTINUOUS function of their own overall rating.
 *
 * RE-BUILT (owner pass 9: "the same ai should generally be good most
 * tourneys… if they're a 95 ai, they should shoot a good score almost every
 * round. if they're 85 they should be consistently middle of the
 * leaderboard"). The old version bucketed everyone into four difficulty
 * TIERS, so a 95.2 and a 94.4 shared one mean and the whole field spanned
 * 2.9 strokes against a per-round sd of 1.6 — a Medium out-scored a Legend
 * ~22% of rounds and the finishing order scrambled every event.
 *
 * Now the rating IS the identity: form is a line in OVR, so every rival owns
 * a distinct mean, and the spread widens to ~4.2 strokes top-to-bottom.
 */
const FORM_AT_90 = 1.1;
const FORM_PER_OVR = 0.28;

/**
 * Per-round form spread, tightened AND rating-scaled: the better the player,
 * the steadier the week (0.35 at 95+, 0.80 at 80). Combined with the
 * two-sim average below this puts a Legend at sd ≈ 1.0 per round and an Easy
 * at ≈ 1.25 — consistent at the top, still lively at the bottom.
 */
const SIGMA_BEST = 0.35;
const SIGMA_SPAN = 0.45;

/** Overall rating of an entrant — the same mean-of-five as
 *  types.overallRating / career.careerOvr, kept unrounded so neighbouring
 *  rivals (95.2 vs 94.4) keep their separation. */
export function entrantOvr(golfer: Golfer): number {
  const s = golfer.stats;
  return (s.drivingPower + s.drivingAccuracy + s.approach + s.chipping + s.putting) / 5;
}

/** Strokes per round this rating plays BETTER than the raw simulator, before
 *  the per-course easing. */
export function entrantForm(ovr: number): number {
  return FORM_AT_90 + FORM_PER_OVR * (ovr - 90);
}

/** This rating's week-to-week form spread (strokes). */
export function entrantSigma(ovr: number): number {
  return SIGMA_BEST + SIGMA_SPAN * Math.min(1, Math.max(0, (95 - ovr) / 15));
}

/**
 * One AI entrant's round on a course: the REAL round simulator plus the
 * calibrated tournament form for their RATING. Exported so the Tour Season
 * fields its rivals with exactly this math — one calibration, every AI
 * leaderboard.
 *
 * TWO simulated rounds are averaged (sim sd 1.35 → 0.95): a single physics
 * draw is noisy enough to bury the rating differences this function exists
 * to express. The second seed is derived here so the caller's seed contract
 * is unchanged. `shiftSeed` remains a TWO-DRAW stream (gaussian form first,
 * then the rounding uniform — the order is part of the contract).
 */
export function simulateEntrantRound(
  course: CourseData,
  courseId: string,
  golfer: Golfer,
  simSeed: number,
  shiftSeed: number
): { total: number; toPar: number } {
  const a = simulateRound(course, golfer, simSeed, RULES.holesPerRound);
  const b = simulateRound(course, golfer, (simSeed ^ 0x85ebca6b) >>> 0, RULES.holesPerRound);
  const par = a.total - a.toPar;
  const ovr = entrantOvr(golfer);
  const rng = mulberry32(shiftSeed);
  const form = entrantForm(ovr) - fieldEasingFor(courseId) + gaussianOf(rng, 0, entrantSigma(ovr));
  // The averaged total is a half-integer and the form is real, so round the
  // RESULT once — stochastically, and via floor + fraction so it stays
  // correct for negative values (`% 1` flips sign, which silently biased the
  // courses whose easing exceeds the tier form).
  const shifted = (a.total + b.total) / 2 - form;
  const fl = Math.floor(shifted);
  // Never below one stroke per hole (absurd floor, unreachable in practice —
  // belt-and-braces for tiny custom courses).
  const total = Math.max(RULES.holesPerRound, fl + (rng() < shifted - fl ? 1 : 0));
  return { total, toPar: total - par };
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
