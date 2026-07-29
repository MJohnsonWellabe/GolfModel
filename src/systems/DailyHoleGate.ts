/**
 * The difficulty oracle for generated holes.
 *
 * A generator that ships whatever it drew is a content firehose pointed at the
 * player. This module is the thing that makes generated holes acceptable: every
 * candidate is PLAYED, hundreds of times, by the same headless simulator the
 * balance gates use, and only holes that land in a human band are served.
 *
 * The band (`bandForPar`) is not about taste — it rejects the three ways a
 * generated hole is actually bad:
 *
 *   - **unfair**: casual players blow up on it (triple bogey or worse) too
 *     often, or average far over par;
 *   - **pointless**: nobody can miss, so the score carries no information —
 *     the band has a difficulty FLOOR as well as a ceiling, because a daily
 *     that everybody pars is not worth the share button (owner: dailies should
 *     be "harder to score AND dramatic");
 *   - **broken**: the ball cannot reach the green, so par is unreachable — the
 *     failure mode a purely geometric validator misses entirely, because the
 *     geometry looks fine.
 *
 * Costs a few hundred simulated rounds per candidate, which is milliseconds of
 * pure arithmetic — cheap enough to run in the browser on the day's first
 * launch, and cheap enough to reject a lot of candidates.
 */

import { simulateHole } from './RoundSimulator';
import { uniformGolfer } from './SkillSimulator';
import { mulberry32 } from '../utils/Random';
import { bandForPar } from './DailyHole';
import type { CourseData, HoleData } from '../core/types';

export interface HoleGrade {
  ok: boolean;
  meanToPar: number;
  blowupRate: number;
  parRate: number;
  /** Populated when ok is false: which band rule the hole failed. */
  reason?: string;
}

/** Rounds simulated per candidate. Enough for the rates to be stable at the
 *  resolution the band cares about, cheap enough to reject many candidates. */
const SAMPLES = 140;

/** Casual skill — the player the band protects. */
const CASUAL_STAT = 72;

/**
 * Play a candidate hole many times and grade it. Deterministic: the same hole
 * always grades the same, so a player and the server agree on which holes pass.
 */
export function gradeHole(course: CourseData, holeIdx = 0): HoleGrade {
  const hole: HoleData = course.holes[holeIdx];
  const golfer = uniformGolfer(CASUAL_STAT);
  let sum = 0;
  let blowups = 0;
  let pars = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const rng = mulberry32(9001 + i * 7919);
    const r = simulateHole(hole, golfer, {
      rng,
      windMin: course.minWind ?? 2,
      windMax: course.maxWind ?? 20,
      bounded: true
    });
    const toPar = r.strokes - hole.par;
    sum += toPar;
    if (toPar >= 3) blowups++;
    if (toPar <= 0) pars++;
  }
  const meanToPar = sum / SAMPLES;
  const blowupRate = blowups / SAMPLES;
  const parRate = pars / SAMPLES;

  // PER-PAR band: a brutal par 5 must not be judged by a par 3's yardstick.
  // One band for all three shapes is what made every dramatic candidate look
  // "too hard" and left the daily hole a fairway and three bunkers.
  const band = bandForPar(hole.par);
  let reason: string | undefined;
  if (meanToPar > band.maxMeanToPar) reason = `too hard for a par ${hole.par} (mean +${meanToPar.toFixed(2)})`;
  else if (meanToPar < band.minMeanToPar) reason = `too easy (mean ${meanToPar.toFixed(2)})`;
  else if (blowupRate > band.maxBlowupRate) reason = `punishing (${Math.round(blowupRate * 100)}% blow up)`;
  else if (parRate < band.minParRate) reason = `par unreachable (${Math.round(parRate * 100)}% par or better)`;
  else if (parRate > band.maxParRate) reason = `a formality (${Math.round(parRate * 100)}% par or better)`;

  return { ok: !reason, meanToPar, blowupRate, parRate, reason };
}
