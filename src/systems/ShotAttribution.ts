/**
 * "Why didn't it go where I aimed?"
 *
 * THE QUESTION THIS ANSWERS
 * -------------------------
 * `docs/vision/03_PLAYER_EXPERIENCE.md` sets the bar: the player should think
 * "I can do that better", not "I do not know what happened". The useful question
 * is not "how good was that shot in the abstract" — it is **what did I fail to
 * account for**. The player already chose a club and an aim point knowing their
 * lie; what they want to know is which of the things they cannot fully see —
 * wind, slope, their own strike, the spin they put on it — moved the ball off
 * that aim, and by how much.
 *
 * So every number here is measured **against the aim point**, not against some
 * idealised version of the shot. That distinction is the whole feature:
 *
 *   - reporting "sand cost 20 yd" is noise, because the club and the power were
 *     chosen FOR the sand — the aim already accounts for it;
 *   - reporting "wind 14 short, 9 right" is a lesson, because next time the
 *     player can aim into it.
 *
 * THE METHOD
 * ----------
 * Counterfactuals, not estimates. The physics is pure, so the same shot can be
 * re-flown with one factor removed and the difference measured exactly. Each
 * factor's contribution is the gap between the real result and the result
 * without it, resolved ALONG the aim line (short/long) and ACROSS it
 * (left/right).
 *
 * Two things are essential, and both were once wrong:
 *
 *   1. the random stream must be RE-SEEDED before every re-fly, or the
 *      difference measures a fresh roll of the dice as well as the factor;
 *   2. factors are compared against a re-flown BASELINE, so each number and its
 *      counterfactual travel the same code path.
 */

import type { PhysicsEngine, ResolvedLaunch, ShotParams } from './PhysicsEngine';
import type { Point, SpinState } from '../core/types';
import { PX_PER_YARD } from '../config';

export interface AttributionFactor {
  kind: 'strike' | 'wind' | 'spin' | 'slope';
  /** Yards this factor pushed the ball SHORT of the aim (+) or past it (−). */
  short: number;
  /** Yards this factor pushed the ball RIGHT of the aim line (+) or left (−). */
  right: number;
  /** What did it, on its own: 'wind', 'strike', '11 ft downhill'. */
  noun: string;
  /** Human-readable line, already phrased for display. */
  label: string;
}

export interface ShotAttribution {
  /** Actual carry+roll distance from the ball, yards. */
  distanceYd: number;
  /** Total miss versus the aim point: yards short (+) / past (−). */
  shortYd: number;
  /** Total miss versus the aim point: yards right (+) / left (−). */
  rightYd: number;
  /** One line naming the total miss, or '' when it finished on the aim. */
  missLabel: string;
  factors: AttributionFactor[];
  /** One-line summary, or '' when nothing was worth saying. */
  summary: string;
}

/** Below this a factor is noise, and saying it would be worse than silence. */
const MIN_YARDS = 4;
/** Below this the ball effectively finished where it was aimed. */
const MIN_MISS = 5;
/** Below this the ground is flat enough that mentioning it is noise. */
const MIN_CLIMB_FT = 8;

function yd(px: number): number {
  return px / PX_PER_YARD;
}

/**
 * Break a shot down against the aim point. `params` must be the EXACT parameters
 * the live shot used, so each counterfactual differs in one variable only.
 */
export function attributeShot(
  engine: PhysicsEngine,
  params: ShotParams,
  spin: SpinState,
  actualFinal: Point,
  /** Where the player was aiming — the reference every number is measured from. */
  aimPoint: Point,
  /**
   * Re-seed the engine's randomness to the state the ACTUAL shot resolved from.
   * Without it, `resolveLaunch` draws fresh noise on every re-fly and the
   * differences measure the dice as much as the factor — which is how a
   * dead-calm shot once reported "wind took 6 yd".
   */
  reseed?: () => void
): ShotAttribution {
  const origin = params.origin;

  // The aim line: `along` runs down the shot, `right` across it.
  const ax = Math.cos(params.aimAngle);
  const ay = Math.sin(params.aimAngle);
  const resolve = (p: Point): { along: number; right: number } => ({
    along: yd((p.x - origin.x) * ax + (p.y - origin.y) * ay),
    right: yd((p.x - origin.x) * ay - (p.y - origin.y) * ax)
  });

  const flyTo = (over: Partial<ShotParams>, withSpin: SpinState = spin): Point => {
    try {
      reseed?.();
      const launch: ResolvedLaunch = engine.resolveLaunch({ ...params, ...over });
      return engine.integrateLaunch(launch, withSpin, 0).finalPos;
    } catch {
      return actualFinal; // a counterfactual that will not resolve simply says nothing
    }
  };

  const aim = resolve(aimPoint);
  const actual = resolve(actualFinal);
  const distanceYd = Math.hypot(actualFinal.x - origin.x, actualFinal.y - origin.y) / PX_PER_YARD;

  // TOTAL MISS versus where the player pointed.
  const shortYd = aim.along - actual.along;
  const rightYd = actual.right - aim.right;

  // BASELINE: the same shot re-flown with nothing removed.
  const baseline = resolve(flyTo({}));

  const factors: AttributionFactor[] = [];
  /** What removing a factor changes — i.e. what that factor DID. */
  const did = (without: Point): { short: number; right: number } => {
    const w = resolve(without);
    return { short: w.along - baseline.along, right: baseline.right - w.right };
  };
  const push = (kind: AttributionFactor['kind'], c: { short: number; right: number }, noun: string): void => {
    if (Math.abs(c.short) < MIN_YARDS && Math.abs(c.right) < MIN_YARDS) return;
    const bits: string[] = [];
    if (Math.abs(c.short) >= MIN_YARDS) bits.push(`${Math.round(Math.abs(c.short))} ${c.short > 0 ? 'short' : 'long'}`);
    if (Math.abs(c.right) >= MIN_YARDS) bits.push(`${Math.round(Math.abs(c.right))} ${c.right > 0 ? 'right' : 'left'}`);
    factors.push({ kind, short: c.short, right: c.right, noun, label: `${noun} ${bits.join(', ')}` });
  };

  // WIND — the thing players most often fail to allow for.
  push('wind', did(flyTo({ wind: { ...params.wind, speed: 0 } })), 'wind');

  // STRIKE — their own execution. Same club, same power target, same lie: this
  // isolates the TIMING, not the quality of the decision.
  push(
    'strike',
    did(flyTo({ swing: { ...params.swing, accuracy: 0, powerQuality: 'perfect', accuracyQuality: 'perfect' } })),
    'strike'
  );

  // SPIN — the shape they chose, which they may not have allowed for.
  const shaped =
    Math.abs(spin.side) > 0.01 ||
    Math.abs(spin.top) > 0.01 ||
    Math.abs(params.spin?.side ?? 0) > 0.01 ||
    Math.abs(params.spin?.top ?? 0) > 0.01;
  if (shaped) push('spin', did(flyTo({ spin: { side: 0, top: 0 } }, { side: 0, top: 0 })), 'spin');

  // SLOPE / GROUND — by RESIDUAL, not by counterfactual.
  //
  // The terrain cannot be lifted out from under a shot without rebuilding the
  // engine. But the factors above are measured against a re-flown baseline of
  // the same shot, so whatever is left over when they are subtracted from the
  // total miss is exactly what the GROUND did — the elevation the ball flew
  // into, and the run-out it got when it landed.
  //
  // This is also what makes the breakdown add up. It is presented as a table of
  // contributions, and a table whose rows do not account for its header is a
  // table that teaches the player the wrong lesson. (Rows under the noise floor
  // are still dropped rather than shown, so the sum is exact only to within one
  // such row — a player cannot feel three yards, and saying it is worse than
  // silence.)
  const climbFt = (engine.groundAt(actualFinal.x, actualFinal.y) - engine.groundAt(origin.x, origin.y)) * 1.25;
  const residual = {
    short: shortYd - factors.reduce((s, f) => s + f.short, 0),
    right: rightYd - factors.reduce((s, f) => s + f.right, 0)
  };
  const groundNoun =
    Math.abs(climbFt) >= MIN_CLIMB_FT ? `${Math.round(Math.abs(climbFt))} ft ${climbFt > 0 ? 'uphill' : 'downhill'}` : 'ground';
  push('slope', residual, groundNoun);

  const missBits: string[] = [];
  if (Math.abs(shortYd) >= MIN_MISS) missBits.push(`${Math.round(Math.abs(shortYd))} yd ${shortYd > 0 ? 'short' : 'long'}`);
  if (Math.abs(rightYd) >= MIN_MISS) missBits.push(`${Math.round(Math.abs(rightYd))} yd ${rightYd > 0 ? 'right' : 'left'}`);
  const missLabel = missBits.join(' · ');

  return {
    distanceYd,
    shortYd,
    rightYd,
    missLabel,
    factors,
    summary: [missLabel, ...factors.map((f) => f.label)].filter(Boolean).join(' · ')
  };
}

// ---------------------------------------------------------------------------
// PRESENTATION
//
// The breakdown reads as a two-column table: what moved the ball UP AND DOWN
// the aim line on the left, what moved it ACROSS on the right, each column
// biggest-first, with the total miss as the header.
//
//     16 yards long        │  12 yards left
//     +8 yds 11 ft downhill│  ← 6 yds mishit
//     +8 yds wind          │  ← 8 yds wind
//     −2 yds under-swing   │  → 2 yds spin
//
// The two columns are INDEPENDENT lists, not one row per factor: wind that cost
// nothing in distance should not take up a line in the distance column. Pairing
// them row-wise is just layout.
//
// Pure formatting, so the wording is testable and the renderer stays a renderer.
// ---------------------------------------------------------------------------

export interface AttributionEntry {
  /** Signed yards. Distance column: + is PAST the aim, − is short of it.
   *  Lateral column: + is RIGHT of the aim line, − is left. */
  yards: number;
  /** What did it: 'wind', 'spin', 'over-swing', '11 ft downhill'. */
  cause: string;
  /** The cell as it should read, e.g. '+8 yds wind' or '← 6 yds mishit'. */
  text: string;
}

export interface AttributionTable {
  /** The total miss, split the same two ways. Either may be ''. */
  head: { dist: string; side: string };
  dist: AttributionEntry[];
  side: AttributionEntry[];
}

/** What the strike did, named by what the player would have felt. */
function strikeCause(kind: AttributionFactor['kind'], yards: number, lateral: boolean): string {
  if (kind !== 'strike') return kind === 'slope' ? '' : kind;
  if (lateral) return 'mishit';
  return yards < 0 ? 'over-swing' : 'under-swing';
}

export function attributionTable(a: ShotAttribution): AttributionTable {
  const dist: AttributionEntry[] = [];
  const side: AttributionEntry[] = [];

  for (const f of a.factors) {
    // `short` is yards SHORT; the column reads in yards gained, so it flips.
    const gained = -f.short;
    if (Math.abs(gained) >= MIN_YARDS) {
      const cause = f.kind === 'slope' ? f.noun : strikeCause(f.kind, gained, false);
      dist.push({
        yards: gained,
        cause,
        text: `${gained > 0 ? '+' : '−'}${Math.round(Math.abs(gained))} yds ${cause}`.trim()
      });
    }
    if (Math.abs(f.right) >= MIN_YARDS) {
      const cause = f.kind === 'slope' ? f.noun : strikeCause(f.kind, f.right, true);
      side.push({
        yards: f.right,
        cause,
        text: `${f.right < 0 ? '←' : '→'} ${Math.round(Math.abs(f.right))} yds ${cause}`.trim()
      });
    }
  }

  // Biggest lesson first. A player scanning this on the tee reads the top line.
  dist.sort((x, y) => Math.abs(y.yards) - Math.abs(x.yards));
  side.sort((x, y) => Math.abs(y.yards) - Math.abs(x.yards));

  return {
    head: {
      dist:
        Math.abs(a.shortYd) >= MIN_MISS
          ? `${Math.round(Math.abs(a.shortYd))} yards ${a.shortYd > 0 ? 'short' : 'long'}`
          : '',
      side:
        Math.abs(a.rightYd) >= MIN_MISS
          ? `${Math.round(Math.abs(a.rightYd))} yards ${a.rightYd > 0 ? 'right' : 'left'}`
          : ''
    },
    dist,
    side
  };
}
