import { CourseData, Golfer } from '../core/types';
import { RoundSimResult, simulateRound, UserSwingModel } from './RoundSimulator';

/**
 * Headless DIFFICULTY-CALIBRATION simulator: a grid of modeled USERS (a timing
 * σ) × GOLFERS (a uniform stat) played over every course, many seeds each, so
 * the swing curve can be tuned against concrete score targets. It reuses the
 * RoundSimulator hole loop verbatim (the AI still picks club/aim/powerTarget);
 * only the swing execution is swapped for the user's error model. Everything is
 * seeded through mulberry32, so a grid is byte-reproducible.
 *
 * The whole module is a balancing INSTRUMENT — it is never imported by the live
 * game (RoundSimulator's userModel option is opt-in and defaults off).
 */

/** A modeled user skill tier: how steady the two meter clicks are. */
export interface UserTier extends UserSwingModel {
  name: string;
}

/** A golfer skill tier: uniform stats (every category equal) at this level. */
export interface GolferTier {
  name: string;
  stat: number;
}

/** Uniform golfer (every stat equal) — the sim's stat-controlled test subject,
 *  matching tests/simulation golferWith(). */
export function uniformGolfer(stat: number): Golfer {
  return {
    id: `sim${stat}`,
    name: `Sim ${stat}`,
    color: 0,
    stats: {
      drivingPower: stat,
      drivingAccuracy: stat,
      approach: stat,
      chipping: stat,
      putting: stat
    }
  };
}

/**
 * USER TIERS — a modeled player's 1σ meter-timing error (fraction of the bar).
 * RECALIBRATED against real play (owner ground truth, 2026-07): at the shipped
 * constants an Expert with a good golfer shoots −2/−3 and is not punished for a
 * bad round. The prior σ ladder (.062/.04/.023/.012) ran the sim harder & wider
 * than reality — its "Expert" (.012) only flushed ~85% of strokes (a strong
 * amateur) and landed ≈ −1. The recalibrated ladder:
 *  - Expert (.008): the OWNER — ~97% perfect strokes (near-all-perfect flush),
 *    yields −2/−3 with a good golfer under the calibrated (light) wind.
 *  - Good (.016):   straddles perfect/good — a strong club player.
 *  - Average (.028):mostly good clicks, regular misses.
 *  - Novice (.045): good/miss mix, perfect is occasional.
 * (Still DEFAULTS; the runner prints the realized band mix so the mapping stays
 *  verifiable under whatever swing constants are in force.)
 */
export const USER_TIERS: UserTier[] = [
  { name: 'Novice', sigmaPower: 0.045, sigmaAcc: 0.045 },
  { name: 'Average', sigmaPower: 0.028, sigmaAcc: 0.028 },
  { name: 'Good', sigmaPower: 0.016, sigmaAcc: 0.016 },
  { name: 'Expert', sigmaPower: 0.008, sigmaAcc: 0.008 }
];

/** GOLFER TIERS — uniform stats spanning ~55 → 100. */
export const GOLFER_TIERS: GolferTier[] = [
  { name: 'Bad', stat: 62 }, // amateur, below the named roster
  { name: 'Mid', stat: 76 }, // ~a returning weekend player
  { name: 'Good', stat: 88 }, // ~Phil (roster "good")
  { name: 'Elite', stat: 96 } // ~Tiger (roster ceiling)
];

export interface RoundRecord {
  toPar: number;
  firPct: number; // fairways hit / fairway chances (par 4/5 tee shots)
  girPct: number;
  puttsPerHole: number;
  penalties: number;
  onePuttPct: number; // holes holed with exactly one putt
  threePuttPct: number; // holes with 3+ putts
}

export interface CellStats {
  n: number;
  medianToPar: number;
  /** Good round (10th percentile toPar — lower is better). */
  p10ToPar: number;
  /** Bad round (90th percentile toPar). */
  p90ToPar: number;
  meanToPar: number;
  meanFir: number;
  meanGir: number;
  meanPutts: number;
  meanPenalties: number;
  meanOnePuttPct: number;
  meanThreePuttPct: number;
  /** Realized swing band mix across every stroke in the cell (verification). */
  band: { perfect: number; good: number; miss: number };
  puttBand: { perfect: number; good: number; miss: number };
}

/** Linear-interpolated percentile of a numeric sample (p in [0,1]). */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/** Normalize a raw band tally to fractions summing to 1. */
function normBand(b: { perfect: number; good: number; miss: number }): {
  perfect: number;
  good: number;
  miss: number;
} {
  const t = b.perfect + b.good + b.miss || 1;
  return { perfect: b.perfect / t, good: b.good / t, miss: b.miss / t };
}

function roundRecord(r: RoundSimResult): RoundRecord {
  let firHit = 0;
  let firChances = 0;
  let gir = 0;
  let putts = 0;
  let penalties = 0;
  let onePutt = 0;
  let threePutt = 0;
  for (const h of r.holes) {
    if (h.fairwayHit !== null) {
      firChances++;
      if (h.fairwayHit) firHit++;
    }
    if (h.gir) gir++;
    putts += h.putts;
    if (h.holed && h.putts === 1) onePutt++;
    if (h.putts >= 3) threePutt++;
    // Blow-up proxy: a hole that never holed hit the stroke cap (RULES.maxStrokes)
    // — the dominant driver of a bad round's p90 tail. Surfaced as `penalties`.
    if (!h.holed) penalties++;
  }
  return {
    toPar: r.toPar,
    firPct: firChances ? (100 * firHit) / firChances : NaN,
    girPct: (100 * gir) / r.holes.length,
    puttsPerHole: putts / r.holes.length,
    penalties,
    onePuttPct: (100 * onePutt) / r.holes.length,
    threePuttPct: (100 * threePutt) / r.holes.length
  };
}

export interface RunOpts {
  /** Rounds per course per cell (each round = one course's 3 holes). */
  roundsPerCourse: number;
  /** Seed base; each (userIdx, golferIdx, courseIdx, round) gets a distinct seed. */
  seedBase?: number;
  /** CALIBRATION WIND BAND (mph) the sim models as "typical playing conditions",
   *  overriding each course's own band. The instrument's original default —
   *  every course's fallback of 2..20mph on EVERY hole — models a constant stiff
   *  breeze (mean 11mph) that cost the modeled expert ~1 full stroke and fattened
   *  the score tails, running the sim harder & wider than the owner's real play.
   *  A light band (calibrated 2026-07) reproduces the owner's −2/−3 expert round.
   *  Undefined on either side → that course's own min/max (the pre-calibration
   *  behavior), so existing non-grid callers are unaffected. */
  windMin?: number;
  windMax?: number;
}

/**
 * Simulate one grid cell (a user tier × a golfer stat) across every course,
 * pooling all rounds. Returns the score distribution summary plus the realized
 * swing-band mix (a cross-check that the σ tier still lands where intended under
 * the current constants).
 */
export function runCell(
  courses: CourseData[],
  user: UserSwingModel,
  golferStat: number,
  opts: RunOpts,
  userIdx = 0,
  golferIdx = 0
): CellStats {
  const golfer = uniformGolfer(golferStat);
  const seedBase = opts.seedBase ?? 900_000;
  const toPars: number[] = [];
  let sumFir = 0;
  let firCells = 0;
  let sumGir = 0;
  let sumPutts = 0;
  let sumPen = 0;
  let sumOne = 0;
  let sumThree = 0;
  const records: RoundRecord[] = [];
  const band = { perfect: 0, good: 0, miss: 0 };
  const puttBand = { perfect: 0, good: 0, miss: 0 };
  const onSwing = (info: { isPutt: boolean; powerQuality: string; accuracyQuality: string }): void => {
    // A stroke's overall band is the WORSE of its two clicks (a good-power /
    // miss-accuracy swing plays as a miss). Putts tallied separately.
    const q =
      info.powerQuality === 'miss' || info.accuracyQuality === 'miss'
        ? 'miss'
        : info.powerQuality === 'good' || info.accuracyQuality === 'good'
          ? 'good'
          : 'perfect';
    const bucket = info.isPutt ? puttBand : band;
    bucket[q as 'perfect' | 'good' | 'miss']++;
  };
  for (let ci = 0; ci < courses.length; ci++) {
    for (let s = 0; s < opts.roundsPerCourse; s++) {
      const seed =
        seedBase +
        userIdx * 97_003 +
        golferIdx * 31_013 +
        ci * 7_919 +
        s * 101;
      const r = simulateRound(courses[ci], golfer, seed, undefined, false, user, onSwing, {
        windMin: opts.windMin,
        windMax: opts.windMax
      });
      const rec = roundRecord(r);
      records.push(rec);
      toPars.push(rec.toPar);
      if (!Number.isNaN(rec.firPct)) {
        sumFir += rec.firPct;
        firCells++;
      }
      sumGir += rec.girPct;
      sumPutts += rec.puttsPerHole;
      sumPen += rec.penalties;
      sumOne += rec.onePuttPct;
      sumThree += rec.threePuttPct;
    }
  }
  toPars.sort((a, b) => a - b);
  const n = records.length;
  return {
    n,
    medianToPar: percentile(toPars, 0.5),
    p10ToPar: percentile(toPars, 0.1),
    p90ToPar: percentile(toPars, 0.9),
    meanToPar: toPars.reduce((a, b) => a + b, 0) / n,
    meanFir: firCells ? sumFir / firCells : NaN,
    meanGir: sumGir / n,
    meanPutts: sumPutts / n,
    meanPenalties: sumPen / n,
    meanOnePuttPct: sumOne / n,
    meanThreePuttPct: sumThree / n,
    band: normBand(band),
    puttBand: normBand(puttBand)
  };
}

export interface GridResult {
  users: UserTier[];
  golfers: GolferTier[];
  /** cells[userIdx][golferIdx]. */
  cells: CellStats[][];
}

/** Run the full user × golfer grid over every course. */
export function runGrid(
  courses: CourseData[],
  opts: RunOpts,
  users: UserTier[] = USER_TIERS,
  golfers: GolferTier[] = GOLFER_TIERS
): GridResult {
  const cells: CellStats[][] = [];
  for (let ui = 0; ui < users.length; ui++) {
    const row: CellStats[] = [];
    for (let gi = 0; gi < golfers.length; gi++) {
      row.push(runCell(courses, users[ui], golfers[gi].stat, opts, ui, gi));
    }
    cells.push(row);
  }
  return { users, golfers, cells };
}
