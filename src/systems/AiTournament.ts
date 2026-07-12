import { RULES } from '../config';
import { CourseData, Golfer } from '../core/types';
import { mulberry32 } from '../utils/Random';
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
 * "Tournament form": the raw simulator plays the AI conservatively (no spin
 * control, no green-reading), so its per-round means sit around E to +0.6 —
 * far behind a decent human's ~-1.5. Each difficulty tier gets a mean shift
 * (stochastically rounded to whole strokes with the tournament's own seeded
 * rng, so the DISTRIBUTION keeps the sim's natural variance) that lands the
 * field in the calibrated band: JD ≈ -0.3, Sergio ≈ -0.8, Phil ≈ -1.4,
 * Tiger ≈ -2.0 per round — Tiger usually leads, but sd ~1.3-1.6 means
 * usually, not always.
 */
const FORM_SHIFT: Record<string, number> = { Easy: 2.0, Medium: 2.4, Hard: 2.6, Legend: 2.7 };

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
    const res = simulateRound(course, e.golfer, t.seed + t.played * 7919 + i * 104729, RULES.holesPerRound);
    const base = FORM_SHIFT[e.difficulty] ?? 1;
    const rng = mulberry32((t.seed ^ 0x9e3779b9) + t.played * 6151 + i * 3079);
    const shift = Math.floor(base) + (rng() < base % 1 ? 1 : 0);
    // Never shift a round below one stroke per hole (absurd floor, unreachable
    // in practice — pure belt-and-braces for tiny custom courses).
    const total = Math.max(RULES.holesPerRound, res.total - shift);
    e.rounds.push(total);
    e.toPars.push(res.toPar - (res.total - total));
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
