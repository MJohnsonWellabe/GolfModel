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

// ---------------------------------------------------------------------------
// HOT STREAKS (owner: "give some ais random hot streaks where they play higher
// than their level (+5) for a few weeks").
//
// A rival's rating is their identity — the whole point of entrantForm — so a
// streak must not touch the rating. It is a TEMPORARY FORM BONUS laid over the
// top of it for a run of consecutive tour events, after which the rival drops
// straight back to who they are.
//
// DETERMINISM IS THE HARD REQUIREMENT. A shared season (src/firebase/CoopSeason)
// exists because both devices re-derive the identical AI field from the season
// seed alone; recomputeSeasonPoints re-settles an event's points from stored
// scores on either phone. So a streak is a PURE FUNCTION of
// (season seed, rival id, event index) — no Math.random, no clock, no mutable
// module state. Two devices, or the same device twice, always agree.
// ---------------------------------------------------------------------------

/**
 * The owner's "+5", in the unit the model actually speaks: a hot rival plays
 * like a golfer five OVERALL POINTS better. entrantForm is a line in OVR, so
 * that converts to FORM_PER_OVR × 5 strokes per round — the bonus is derived
 * from the form curve rather than hard-coded, so re-tuning the curve can never
 * silently change what "+5" means.
 */
export const STREAK_OVR_BONUS = 5;

/** "A few weeks": a streak runs 2–4 consecutive tour events (a major counts as
 *  one event, so a hot rival carries the bonus through all three of its
 *  rounds — which is exactly how a purple patch reads on a leaderboard). */
export const STREAK_MIN_EVENTS = 2;
export const STREAK_MAX_EVENTS = 4;

/**
 * Chance that a streak BEGINS for a given rival at a given event. Deliberately
 * small: at ~3 events per streak it covers ≈7% of (rival, event) pairs, which
 * is about four purple patches per sixteen-event season across the whole field
 * and leaves half the weeks with nobody hot at all. A hot streak has to read as
 * an event, not as the weather.
 *
 * It is also a CALIBRATION constant, not just a flavour one. Six of the ten
 * rivals are now contenders, so raising this raises the odds that one of THEM
 * is playing +5 in any given week — and a hot contender is worth about two
 * strokes off the winning total of a major. At this rate the major the player
 * actually plays averages ≈ −10, which is the number the owner signed off on.
 */
export const STREAK_START_CHANCE = 0.025;

/** A run of consecutive events one rival spends above their level. */
export interface HotStreak {
  /** Event index the streak began at (may be negative — see hotStreakAt). */
  start: number;
  /** Consecutive events it covers, STREAK_MIN_EVENTS..STREAK_MAX_EVENTS. */
  length: number;
}

/** Where a rival's round sits in the season, for the streak lookup. Absent
 *  outside the Tour Season (the AI tournament mode has no season timeline, so
 *  it simply never runs streaks). */
export interface TourFormContext {
  /** The season seed — the ONLY entropy a streak is allowed to use. */
  seasonSeed: number;
  /** 0-based index of the event in the season schedule. */
  eventIdx: number;
}

/** FNV-1a over the rival id, folded with the season seed and the event index.
 *  A string id (not a roster position) keeps a rival's streaks attached to the
 *  RIVAL, so re-ordering or re-rating the roster never reshuffles history. */
function streakHash(seasonSeed: number, rivalId: string, eventIdx: number): number {
  let h = (0x811c9dc5 ^ (seasonSeed | 0)) >>> 0;
  for (let i = 0; i < rivalId.length; i++) {
    h = Math.imul(h ^ rivalId.charCodeAt(i), 0x01000193) >>> 0;
  }
  // eventIdx can be negative (a streak that began before the season opened);
  // Math.imul keeps the mix well-defined either way.
  h = Math.imul(h ^ (eventIdx + 0x7fff), 0x27d4eb2d) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** The streak that STARTS at exactly `eventIdx`, or null. Two draws from one
 *  stream: does one begin, and how long does it run. */
function streakStartingAt(seasonSeed: number, rivalId: string, eventIdx: number): HotStreak | null {
  const rng = mulberry32(streakHash(seasonSeed, rivalId, eventIdx));
  if (rng() >= STREAK_START_CHANCE) return null;
  const span = STREAK_MAX_EVENTS - STREAK_MIN_EVENTS + 1;
  return { start: eventIdx, length: STREAK_MIN_EVENTS + Math.min(span - 1, Math.floor(rng() * span)) };
}

/**
 * The streak a rival is in the middle of at `eventIdx`, or null.
 *
 * Walks back over the only starts that could still reach this event — at most
 * STREAK_MAX_EVENTS of them, so the lookup is O(1) and needs no season state.
 * Starts BEFORE the season (negative indices) are allowed on purpose: form
 * carries over, so event 1 is as likely to catch a rival mid-run as event 12,
 * instead of the schedule opening with an artificially cold field.
 */
export function hotStreakAt(seasonSeed: number, rivalId: string, eventIdx: number): HotStreak | null {
  for (let s = eventIdx; s > eventIdx - STREAK_MAX_EVENTS; s--) {
    const w = streakStartingAt(seasonSeed, rivalId, s);
    if (w && s + w.length > eventIdx) return w;
  }
  return null;
}

/** Strokes per round a rival on a hot streak plays above their own level: the
 *  form of (their rating + STREAK_OVR_BONUS) minus the form of their rating. */
export function streakFormBonus(ovr: number): number {
  return entrantForm(ovr + STREAK_OVR_BONUS) - entrantForm(ovr);
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
 *
 * `tour` places the round in a season so a HOT STREAK can apply. It is added
 * OUTSIDE the rng, before the gaussian, so a streak never disturbs the seed
 * stream: the same seeds produce the same physics and the same week-to-week
 * wobble whether the rival is hot or not. Omit it (the AI tournament mode,
 * which has no season timeline) and no streak can ever fire.
 */
export function simulateEntrantRound(
  course: CourseData,
  courseId: string,
  golfer: Golfer,
  simSeed: number,
  shiftSeed: number,
  tour?: TourFormContext
): { total: number; toPar: number } {
  const a = simulateRound(course, golfer, simSeed, RULES.holesPerRound);
  const b = simulateRound(course, golfer, (simSeed ^ 0x85ebca6b) >>> 0, RULES.holesPerRound);
  const par = a.total - a.toPar;
  const ovr = entrantOvr(golfer);
  const rng = mulberry32(shiftSeed);
  const hot = tour ? hotStreakAt(tour.seasonSeed, golfer.id, tour.eventIdx) !== null : false;
  const form =
    entrantForm(ovr) +
    (hot ? streakFormBonus(ovr) : 0) -
    fieldEasingFor(courseId) +
    // Sigma stays keyed to the RATING, not the streak: catching fire makes a
    // rival better, it does not make them a metronome.
    gaussianOf(rng, 0, entrantSigma(ovr));
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
