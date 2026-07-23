import { SWING } from '../config';
import { clamp } from '../utils/Geometry';
import { Band, SwingResult } from '../core/types';

/**
 * Pure swing-outcome model: timing error → SwingResult. This is the single
 * source of truth for how the swing meter's two clicks (power, accuracy) become
 * physics inputs — shared by the live DOM meter (src/slice3d/meter3d.ts, which
 * delegates every band/outcome call here) and the headless difficulty simulator
 * (src/systems/SkillSimulator.ts). Keeping the math in one pure module is what
 * lets the sim tune the difficulty curve with the EXACT numbers the live game
 * uses, instead of a drifting copy.
 *
 * No DOM, no rendering, no randomness in the low-level functions — callers pass
 * their own rng where a draw is needed (the miss power-jitter).
 */

/** Fixed accuracy target (fraction of the bar). */
export const ACCURACY_TARGET = 0.08;

export interface SwingCtx {
  /** Governing stat 0..100 (sizes the perfect + good bands). */
  stat: number;
  /** Intended power as a physics fraction (non-putt) or bar fraction (putt). */
  powerTarget: number;
  isPutt: boolean;
  /** Extra band multiplier (fire system); defaults 1. */
  perfectMult?: number;
  /** Difficulty multiplier from lie + club (<1 shrinks the zone); default 1. */
  difficultyMult?: number;
}

/** Raw (linear) normalized signed offset of the accuracy cursor from its target,
 *  in [-1, 1]. The convex/harsher shaping is applied separately in
 *  {@link shapeAccuracyOffset} so this primitive stays a plain geometric map. */
export function normalizedAccuracyOffset(cursor: number, target = ACCURACY_TARGET): number {
  const room = cursor >= target ? 1 - target : target;
  return clamp((cursor - target) / Math.max(0.001, room), -1, 1);
}

/** Where the power target sits on the bar (0..1). */
export function targetBar(ctx: SwingCtx): number {
  return ctx.isPutt ? ctx.powerTarget : ctx.powerTarget * SWING.fullPowerMark;
}

/** Perfect-band HALF-width for a context. Appendix A: scales with the governing
 *  stat on a ^1.5 curve, times the fire/lie/perk multipliers. */
export function perfectHalf(ctx: SwingCtx): number {
  const t = Math.pow(clamp(ctx.stat, 0, 100) / 100, 1.5);
  const half = SWING.perfectBandMin + t * (SWING.perfectBandMax - SWING.perfectBandMin);
  return half * (ctx.perfectMult ?? 1) * (ctx.difficultyMult ?? 1);
}

/** Good-band HALF-width for a context (same stat curve, wider floor/ceiling). */
export function goodHalf(ctx: SwingCtx): number {
  const t = Math.pow(clamp(ctx.stat, 0, 100) / 100, 1.5);
  const half = SWING.goodBandMin + t * (SWING.goodBand - SWING.goodBandMin);
  return half * (ctx.perfectMult ?? 1) * (ctx.difficultyMult ?? 1);
}

/** Classify a locked cursor against its target given precomputed band widths. */
export function bandFor(cursor: number, target: number, pHalf: number, gHalf: number): Band {
  const d = Math.abs(cursor - target);
  if (d <= pHalf) return 'perfect';
  if (d <= gHalf) return 'good';
  return 'miss';
}

/** Delivered physics power (non-putt) or bar fraction (putt) for a locked power
 *  cursor + its band. Perfect → exactly the target; short → convex distance
 *  loss (powerShortExp); overswing → capped bonus. */
export function deliveredPower(ctx: SwingCtx, lockedCursor: number, band: Band): number {
  const t = targetBar(ctx);
  const c = lockedCursor;
  if (ctx.isPutt) {
    if (band === 'perfect') return ctx.powerTarget;
    const errCap = t * SWING.puttGoodErrorFrac;
    return clamp(t + clamp(c - t, -errCap, errCap), 0.03, 1);
  }
  if (band === 'perfect') return ctx.powerTarget;
  if (c <= t) {
    // Short of the target — proportionally weaker (owner: short = less). The
    // shortfall is raised to powerShortExp so a slightly-short swing barely
    // loses distance while a badly-short one loses a lot (convex, smooth).
    const frac = t <= 0 ? 0 : clamp(c / t, 0, 1); // 1 at target, 0 at bar start
    const shaped = 1 - Math.pow(1 - frac, SWING.powerShortExp); // convex when exp>1
    const delivered = shaped * (t / SWING.fullPowerMark);
    return clamp(delivered, 0.1, 1.08);
  }
  // Past the target — overswing ADDS distance, capped so it can't run away.
  return clamp(ctx.powerTarget + SWING.overswingBonus * (c - t), 0.1, 1.2);
}

/** Apply the difficulty curve to a raw normalized offset: `gain · |raw|^exp`,
 *  sign preserved, clamped to [-1, 1]. Identity when exp = gain = 1. */
export function shapeAccuracyOffset(raw: number): number {
  const s = Math.sign(raw);
  const shaped = SWING.accuracyCurveGain * Math.pow(Math.abs(raw), SWING.accuracyCurveExp);
  return clamp(s * shaped, -1, 1);
}

/** Signed start-line offset delivered for a locked accuracy cursor + band. A
 *  perfect click launches dead on-line (0); otherwise the raw offset is negated
 *  (player-meter convention: cursor-right → ball-left) and run through the
 *  difficulty curve. */
export function accuracyOffsetSigned(cursor: number, band: Band): number {
  if (band === 'perfect') return 0;
  return shapeAccuracyOffset(-normalizedAccuracyOffset(cursor));
}

/**
 * Resolve a full user swing from two locked cursor positions (sim convenience;
 * the live meter drives the same primitives click-by-click). `rng` supplies the
 * miss power-jitter draw so a sim run is deterministic; pass Math.random for the
 * live-equivalent behavior.
 */
export function resolveUserSwing(
  ctx: SwingCtx,
  powerCursor: number,
  accuracyCursor: number,
  rng: () => number
): SwingResult {
  const pHalf = perfectHalf(ctx);
  const gHalf = goodHalf(ctx);
  const powerBand = bandFor(powerCursor, targetBar(ctx), pHalf, gHalf);
  const accBand = bandFor(accuracyCursor, ACCURACY_TARGET, pHalf, gHalf);
  let power = deliveredPower(ctx, powerCursor, powerBand);
  if (accBand === 'miss') power *= 0.82 + rng() * 0.12;
  return {
    power,
    powerQuality: powerBand,
    accuracy: accuracyOffsetSigned(accuracyCursor, accBand),
    accuracyQuality: accBand
  };
}
