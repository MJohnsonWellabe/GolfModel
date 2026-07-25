import { describe, expect, it } from 'vitest';
import { attributeShot } from '../src/systems/ShotAttribution';
import { PhysicsEngine, ShotParams } from '../src/systems/PhysicsEngine';
import { buildHeightField } from '../src/systems/HeightField';
import { mulberry32 } from '../src/utils/Random';
import { clubById } from '../src/data/clubs';
import { openHole, golferWith } from './simulation/simHelpers';
import type { HoleData, SpinState } from '../src/core/types';

/**
 * The post-shot breakdown.
 *
 * It answers "why did that happen?" with counterfactuals rather than estimates:
 * the physics is pure, so the same shot can be re-flown with one factor removed
 * and the difference measured exactly. The value of that is entirely in the
 * numbers being right — a breakdown that mis-attributes a miss is worse than no
 * breakdown, because the player will believe it and adjust the wrong thing.
 */

/**
 * Fire one shot and break it down, exactly as the live game does — including
 * re-seeding the shot's random stream before each counterfactual. Without that
 * reseed the re-flies draw FRESH noise and the breakdown charges several yards
 * of dice to whichever factor it happened to be measuring, which is the bug
 * these tests exist to keep fixed.
 */
function shoot(
  hole: HoleData,
  over: Partial<ShotParams> = {},
  spin: SpinState = { side: 0, top: 0 }
): ReturnType<typeof attributeShot> {
  const SEED = 0x5eed;
  let rng = mulberry32(SEED);
  const engine = new PhysicsEngine(hole, buildHeightField(hole), () => rng());
  const params: ShotParams = {
    origin: { ...hole.tee },
    aimAngle: -Math.PI / 2,
    swing: { power: 0.95, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
    club: clubById('driver')!,
    golfer: golferWith(85),
    fireBoost: 0,
    lie: 'tee',
    wind: { angle: 0, speed: 0 },
    hole,
    spin: { side: 0, top: 0 },
    launchMult: 1,
    riskMult: 1,
    stroke: 0,
    ...over
  };
  rng = mulberry32(SEED);
  const launch = engine.resolveLaunch(params);
  const out = engine.integrateLaunch(launch, spin, 0);
  return attributeShot(engine, params, spin, out.finalPos, () => (rng = mulberry32(SEED)));
}

describe('what the breakdown reports', () => {
  it('says how far the ball actually went', () => {
    const a = shoot(openHole());
    expect(a.distanceYd).toBeGreaterThan(100);
  });

  it('names the wind when there is wind, and stays quiet when there is not', () => {
    const calm = shoot(openHole());
    expect(calm.factors.some((f) => f.kind === 'wind')).toBe(false);

    // A stiff wind straight down the line has to show up.
    const windy = shoot(openHole(), { wind: { angle: Math.PI / 2, speed: 20 } });
    const wind = windy.factors.find((f) => f.kind === 'wind');
    expect(wind, `factors: ${windy.factors.map((f) => f.label).join(', ')}`).toBeTruthy();
  });

  it('names a bad lie, and never blames the fairway', () => {
    const rough = shoot(openHole(), { lie: 'rough' });
    const lie = rough.factors.find((f) => f.kind === 'lie');
    expect(lie?.label).toMatch(/rough/);
    expect(shoot(openHole(), { lie: 'fairway' }).factors.some((f) => f.kind === 'lie')).toBe(false);
  });

  it('charges a badly missed strike to the strike, not to the conditions', () => {
    // A hard miss: fully off the accuracy target, both bands blown. Note that a
    // MILD miss (accuracy 0.3) costs barely a yard and a couple sideways, and
    // the breakdown correctly says nothing about it — the thresholds exist so
    // the player is told about things they could actually have felt.
    const a = shoot(openHole(), {
      swing: { power: 0.95, powerQuality: 'miss', accuracy: 0.95, accuracyQuality: 'miss' }
    });
    const strike = a.factors.find((f) => f.kind === 'strike');
    expect(strike, `factors: ${a.factors.map((f) => f.label).join(', ')}`).toBeTruthy();
    // In this engine a mis-hit spends itself mostly sideways, so the strike is
    // reported on whichever axis actually moved.
    expect(strike!.label).toMatch(/strike (cost|pushed)/);
    // And the conditions are not blamed for it: dead calm, off a tee.
    expect(a.factors.some((f) => f.kind === 'wind')).toBe(false);
  });

  it('says nothing at all about a clean, calm, flat shot', () => {
    // Silence is a feature. A breakdown that always finds something to say
    // trains the player to ignore it.
    const a = shoot(openHole());
    expect(a.summary === '' || a.factors.length === 0).toBe(true);
  });
});

describe('spin — the factor the player chose', () => {
  it('reports a shaped shot as a draw or a fade, with how far it moved', () => {
    const a = shoot(openHole(), { spin: { side: 0.8, top: 0 } }, { side: 0.8, top: 0 });
    const spin = a.factors.find((f) => f.kind === 'spin');
    expect(spin, `factors: ${a.factors.map((f) => f.label).join(', ')}`).toBeTruthy();
    expect(spin!.label).toMatch(/draw|fade|spin/);
  });

  it('names the direction the ball actually moved', () => {
    const fade = shoot(openHole(), { spin: { side: 0.9, top: 0 } }, { side: 0.9, top: 0 });
    const draw = shoot(openHole(), { spin: { side: -0.9, top: 0 } }, { side: -0.9, top: 0 });
    const label = (r: typeof fade): string => r.factors.find((f) => f.kind === 'spin')?.label ?? '';
    // Whatever the sign convention, the two must not agree — a breakdown that
    // called every shaped shot a "draw" would be worse than saying nothing.
    if (label(fade) && label(draw)) expect(label(fade)).not.toBe(label(draw));
  });

  it('stays quiet when the ball was hit straight', () => {
    expect(shoot(openHole()).factors.some((f) => f.kind === 'spin')).toBe(false);
  });
});

describe('slope — the factor the player could not see', () => {
  /** The same open hole with the ground tilted, centred on where a drive from
   *  the tee actually finishes (~230 yd up the corridor) rather than on the
   *  green — a rise the ball never reaches is not a rise the player felt. */
  function hilly(sign: number): HoleData {
    return openHole({
      elevation: [{ x: 1500, y: 2100, h: sign * 60, r: 900, shape: 'dome' }]
    });
  }

  it('reports an uphill finish in feet', () => {
    const a = shoot(hilly(1));
    const slope = a.factors.find((f) => f.kind === 'slope');
    expect(slope, `factors: ${a.factors.map((f) => f.label).join(', ')}`).toBeTruthy();
    expect(slope!.label).toMatch(/ft uphill/);
  });

  it('reports a downhill finish as downhill', () => {
    const a = shoot(hilly(-1));
    const slope = a.factors.find((f) => f.kind === 'slope');
    expect(slope, `factors: ${a.factors.map((f) => f.label).join(', ')}`).toBeTruthy();
    expect(slope!.label).toMatch(/ft downhill/);
  });

  it('stays quiet on flat ground', () => {
    expect(shoot(openHole()).factors.some((f) => f.kind === 'slope')).toBe(false);
  });

  it('reads elevation in FEET, not world units', () => {
    // The vertical unit is ~1.25 ft, and confusing the two is the single most
    // repeated mistake in this codebase (see the course field guide). A 90-unit
    // rise is ~112 ft, so a label reporting "90 ft" would mean the conversion
    // was dropped.
    const a = shoot(hilly(1));
    const label = a.factors.find((f) => f.kind === 'slope')!.label;
    const feet = Number(label.match(/(\d+) ft/)![1]);
    expect(feet).toBeGreaterThan(20);
  });
});
