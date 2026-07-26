import { describe, expect, it } from 'vitest';
import { attributeShot, attributionTable } from '../src/systems/ShotAttribution';
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
  spin: SpinState = { side: 0, top: 0 },
  /** Where the player pointed. Defaults to a clean strike in dead air on THIS
   *  hole; pass one explicitly to model a player who aimed at a spot without
   *  allowing for what the ground there would do. */
  aimAt?: { x: number; y: number },
  /** Read the shot in FEET, as a putt is. */
  isPutt = false,
  /** The physics power a perfect strike would have delivered (see
   *  attributeShot's plannedPower). */
  plannedPower?: number
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
  // Where the player aimed: a clean strike in dead air, which is exactly what
  // the in-game aim line previews. Every number is measured against this.
  rng = mulberry32(SEED);
  const aimLaunch = engine.resolveLaunch({
    ...params,
    wind: { angle: 0, speed: 0 },
    spin: { side: 0, top: 0 },
    swing: { ...params.swing, accuracy: 0, powerQuality: 'perfect', accuracyQuality: 'perfect' }
  });
  rng = mulberry32(SEED);
  const aimPoint = aimAt ?? engine.integrateLaunch(aimLaunch, { side: 0, top: 0 }, 0).finalPos;
  return attributeShot(
    engine,
    params,
    spin,
    out.finalPos,
    aimPoint,
    () => (rng = mulberry32(SEED)),
    isPutt,
    plannedPower
  );
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

  it('never blames the LIE, because the aim already accounts for it', () => {
    // The owner's point, and the reason this was rewritten: the club and the
    // power were chosen FOR the sand. Telling him "sand cost 20 yd" is telling
    // him about a decision he already made. Only the things he could not fully
    // see are worth naming.
    const rough = shoot(openHole(), { lie: 'rough' });
    expect(rough.factors.map((f) => f.kind)).not.toContain('lie');
    const sand = shoot(openHole(), { lie: 'sand' });
    expect(sand.factors.map((f) => f.kind)).not.toContain('lie');
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
    // Reported on whichever axis actually moved — in this engine a mis-hit
    // spends itself mostly sideways.
    expect(strike!.label).toMatch(/^strike /);
    // And the conditions are not blamed for it: dead calm, off a tee.
    expect(a.factors.some((f) => f.kind === 'wind')).toBe(false);
  });

  it('says nothing at all about a clean, calm, flat shot that finished on the aim', () => {
    // Silence is a feature. A breakdown that always finds something to say
    // trains the player to ignore it.
    const a = shoot(openHole());
    expect(a.factors).toEqual([]);
    expect(a.missLabel).toBe('');
  });

  it('reports the miss against the AIM, in short/long and left/right', () => {
    const windy = shoot(openHole(), { wind: { angle: Math.PI / 2, speed: 20 } });
    // A 20mph wind straight down the line has to move the ball off the aim, and
    // the head line has to name it in terms a golfer uses.
    expect(Math.abs(windy.shortYd) + Math.abs(windy.rightYd)).toBeGreaterThan(5);
    expect(windy.missLabel, windy.missLabel).toMatch(/yd (short|long|left|right)/);
  });
});

describe('spin — the factor the player chose', () => {
  it('reports a shaped shot as a draw or a fade, with how far it moved', () => {
    const a = shoot(openHole(), { spin: { side: 0.8, top: 0 } }, { side: 0.8, top: 0 });
    const spin = a.factors.find((f) => f.kind === 'spin');
    expect(spin, `factors: ${a.factors.map((f) => f.label).join(', ')}`).toBeTruthy();
    expect(spin!.label).toMatch(/^spin /);
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

describe('slope — the ground, measured as what is left over', () => {
  /** The same open hole with the ground tilted, centred on where a drive from
   *  the tee actually finishes (~230 yd up the corridor) rather than on the
   *  green — a rise the ball never reaches is not a rise the player felt. */
  function hilly(sign: number): HoleData {
    return openHole({
      elevation: [{ x: 1500, y: 2100, h: sign * 60, r: 900, shape: 'dome' }]
    });
  }

  /**
   * Where a player who did NOT allow for the slope would aim: the spot the
   * same shot finishes on flat ground.
   *
   * This is the whole point of the feature. Aiming at the spot the ball reaches
   * ON THIS terrain and then reporting the terrain would be reporting something
   * the player already accounted for — the same mistake as blaming the lie.
   */
  const flatLanding = shoot(openHole()).factors.length >= 0 ? flatAim() : flatAim();
  function flatAim(): { x: number; y: number } {
    const SEED = 0x5eed;
    let rng = mulberry32(SEED);
    const hole = openHole();
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
      stroke: 0
    };
    rng = mulberry32(SEED);
    const launch = engine.resolveLaunch(params);
    rng = mulberry32(SEED);
    return engine.integrateLaunch(launch, { side: 0, top: 0 }, 0).finalPos;
  }

  it('names the elevation when the ground is what moved the ball', () => {
    const a = shoot(hilly(1), {}, { side: 0, top: 0 }, flatLanding);
    const slope = a.factors.find((f) => f.kind === 'slope');
    expect(slope, `factors: ${a.factors.map((f) => f.label).join(', ')}`).toBeTruthy();
    expect(slope!.noun).toMatch(/ft uphill/);
  });

  it('reports a downhill finish as downhill', () => {
    const a = shoot(hilly(-1), {}, { side: 0, top: 0 }, flatLanding);
    const slope = a.factors.find((f) => f.kind === 'slope');
    expect(slope, `factors: ${a.factors.map((f) => f.label).join(', ')}`).toBeTruthy();
    expect(slope!.noun).toMatch(/ft downhill/);
  });

  it('uphill costs distance and downhill gains it', () => {
    const up = shoot(hilly(1), {}, { side: 0, top: 0 }, flatLanding);
    const down = shoot(hilly(-1), {}, { side: 0, top: 0 }, flatLanding);
    expect(up.shortYd, `uphill ${up.shortYd.toFixed(1)}`).toBeGreaterThan(0);
    expect(down.shortYd, `downhill ${down.shortYd.toFixed(1)}`).toBeLessThan(0);
  });

  it('reads elevation in FEET, not world units', () => {
    // The vertical unit is ~1.5 ft, and confusing the two is the single most
    // repeated mistake in this codebase (see the course field guide). A 90-unit
    // rise is ~135 ft, so a label reporting "90 ft" would mean the conversion
    // was dropped.
    const a = shoot(hilly(1), {}, { side: 0, top: 0 }, flatLanding);
    const noun = a.factors.find((f) => f.kind === 'slope')!.noun;
    const feet = Number(noun.match(/(\d+) ft/)![1]);
    expect(feet).toBeGreaterThan(20);
  });

  it('says nothing when the ball finished where it was aimed', () => {
    // Flat ground, dead air, pure strike: there is no residual, so there is
    // nothing to report. Inventing a line here would be the worst outcome —
    // the player would adjust for a problem that does not exist.
    expect(shoot(openHole()).factors.some((f) => f.kind === 'slope')).toBe(false);
  });
});

describe('the table the player actually reads', () => {
  /** A miss with something in both columns: a hard strike miss in a crosswind. */
  function messy(): ReturnType<typeof attributeShot> {
    return shoot(openHole(), {
      wind: { angle: 0, speed: 18 },
      swing: { power: 0.95, powerQuality: 'miss', accuracy: 0.95, accuracyQuality: 'miss' }
    });
  }

  it('splits into a distance column and a line column', () => {
    const t = attributionTable(messy());
    expect(t.dist.length + t.side.length, JSON.stringify(t)).toBeGreaterThan(0);
    // Nothing under the noise floor gets a line in either column.
    for (const e of [...t.dist, ...t.side]) expect(Math.abs(e.yards)).toBeGreaterThanOrEqual(4);
  });

  it('the rows account for the header, to within the noise floor', () => {
    // A table whose rows do not add up to its total teaches the wrong lesson,
    // and it is why the ground is measured as a RESIDUAL rather than skipped.
    //
    // Exact equality is the wrong bar: anything under a few yards is dropped
    // rather than shown, deliberately, because a player cannot feel it. So the
    // rows must account for the total to within that floor — a gap wider than
    // one dropped row means a real contribution went missing.
    const a = messy();
    const t = attributionTable(a);
    const sumShort = a.factors.reduce((s, f) => s + f.short, 0);
    const sumRight = a.factors.reduce((s, f) => s + f.right, 0);
    expect(Math.abs(sumShort - a.shortYd), `${sumShort.toFixed(2)} vs ${a.shortYd.toFixed(2)}`).toBeLessThan(4);
    expect(Math.abs(sumRight - a.rightYd), `${sumRight.toFixed(2)} vs ${a.rightYd.toFixed(2)}`).toBeLessThan(4);
    expect(t.head.dist || t.head.side).toBeTruthy();
  });

  it('reads the way a golfer would say it', () => {
    const t = attributionTable(messy());
    for (const e of t.dist) expect(e.text, e.text).toMatch(/^[+−]\d+ yd \S/);
    for (const e of t.side) expect(e.text, e.text).toMatch(/^[←→] \d+ yd \S/);
    if (t.head.dist) expect(t.head.dist).toMatch(/^\d+ yd (short|long)$/);
    if (t.head.side) expect(t.head.side).toMatch(/^\d+ yd (right|left)$/);
  });

  it('a putt is the same breakdown in FEET, with a floor a putt can clear', () => {
    // Putts were excluded outright. They are the shot where this feature is
    // worth MOST — how much break you failed to play — and the only thing that
    // actually differs is scale: a four-YARD floor silences every putt ever
    // struck, which is why excluding them looked reasonable.
    const miss = {
      swing: { power: 0.95, powerQuality: 'miss' as const, accuracy: 0.9, accuracyQuality: 'miss' as const }
    };
    const inYards = shoot(openHole(), miss);
    const inFeet = shoot(openHole(), miss, { side: 0, top: 0 }, undefined, true);
    expect(inYards.unit).toBe('yd');
    expect(inFeet.unit).toBe('ft');
    // Same shot, three times the number — and the wording follows the unit.
    expect(Math.abs(inFeet.shortYd)).toBeCloseTo(Math.abs(inYards.shortYd) * 3, 4);
    const t = attributionTable(inFeet);
    for (const e of [...t.dist, ...t.side]) expect(e.text, e.text).toMatch(/ ft /);
    if (t.head.dist) expect(t.head.dist).toMatch(/ ft /);
  });

  it('names a putt\'s residual THE BREAK, which is what a golfer calls it', () => {
    const a = shoot(
      openHole(),
      { swing: { power: 0.95, powerQuality: 'miss', accuracy: 0.9, accuracyQuality: 'miss' } },
      { side: 0, top: 0 },
      undefined,
      true
    );
    const ground = a.factors.find((f) => f.kind === 'slope');
    if (ground) expect(ground.noun).toBe('the break');
  });

  it('names a strike miss by what the player felt', () => {
    const t = attributionTable(messy());
    const causes = [...t.dist, ...t.side].map((e) => e.cause);
    // Never the bare word "strike": a golfer knows it as an over-swing, an
    // under-swing or a mishit.
    expect(causes).not.toContain('strike');
  });

  it('leads with the biggest number in each column', () => {
    const t = attributionTable(messy());
    for (const col of [t.dist, t.side]) {
      for (let i = 1; i < col.length; i++) {
        expect(Math.abs(col[i - 1].yards)).toBeGreaterThanOrEqual(Math.abs(col[i].yards));
      }
    }
  });
});

describe('direction and cause read the way the player saw them (owner pass 6)', () => {
  it('a push to the RIGHT reads right, with a right-pointing arrow', () => {
    // The physics rotates a positive accuracy error by a POSITIVE angle
    // (dir = aimAngle + error), and a positive rotation lands screen-right at
    // every yaw — so a hard positive-accuracy miss must read RIGHT. The
    // original cross product was backwards and mirrored every arrow (owner:
    // "it is getting directional misses wrong").
    const a = shoot(openHole(), {
      swing: { power: 0.95, powerQuality: 'perfect', accuracy: 0.95, accuracyQuality: 'miss' }
    });
    expect(a.rightYd, `total lateral ${a.rightYd.toFixed(1)}`).toBeGreaterThan(0);
    expect(a.missLabel).toMatch(/right/);
    const t = attributionTable(a);
    const mishit = t.side.find((e) => e.cause === 'mishit');
    expect(mishit, `side: ${t.side.map((e) => e.text).join(' | ')}`).toBeTruthy();
    expect(mishit!.text.startsWith('→'), mishit!.text).toBe(true);
    // ...and the mirror image reads left.
    const b = shoot(openHole(), {
      swing: { power: 0.95, powerQuality: 'perfect', accuracy: -0.95, accuracyQuality: 'miss' }
    });
    expect(b.rightYd).toBeLessThan(0);
    expect(b.missLabel).toMatch(/left/);
  });

  it('an under-hit strike is an UNDER-swing that LOST yards — never a gain', () => {
    // The player delivered 0.7 where a perfect strike would have delivered
    // 0.95: the strike row must say under-swing with a minus sign. This read
    // "+N yd under-swing" before — an underswing that appeared to ADD distance
    // (owner report, verbatim).
    const a = shoot(
      openHole(),
      { swing: { power: 0.7, powerQuality: 'miss', accuracy: 0, accuracyQuality: 'perfect' } },
      { side: 0, top: 0 },
      undefined,
      false,
      0.95
    );
    const t = attributionTable(a);
    const strike = t.dist.find((e) => /swing/.test(e.cause));
    expect(strike, `dist: ${t.dist.map((e) => e.text).join(' | ')}`).toBeTruthy();
    expect(strike!.cause).toBe('under-swing');
    expect(strike!.yards).toBeLessThan(0);
    expect(strike!.text.startsWith('−'), strike!.text).toBe(true);
  });

  it("the planned power keeps an under-swing OUT of the ground's residual", () => {
    // Same shot, with and without the planned power: with it, the strike
    // carries the shortfall and the ground residual shrinks to noise.
    const with_ = shoot(
      openHole(),
      { swing: { power: 0.7, powerQuality: 'miss', accuracy: 0, accuracyQuality: 'perfect' } },
      { side: 0, top: 0 },
      undefined,
      false,
      0.95
    );
    const strike = with_.factors.find((f) => f.kind === 'strike');
    const ground = with_.factors.find((f) => f.kind === 'slope');
    expect(strike, `factors: ${with_.factors.map((f) => f.label).join(', ')}`).toBeTruthy();
    expect(Math.abs(strike!.short)).toBeGreaterThan(Math.abs(ground?.short ?? 0));
  });
});
