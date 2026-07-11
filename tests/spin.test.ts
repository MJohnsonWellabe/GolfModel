import { describe, expect, it } from 'vitest';
import { PhysicsEngine } from '../src/systems/PhysicsEngine';
import { StrikeControl } from '../src/core/input/StrikeControl';
import { clubById } from '../src/data/clubs';
import { Golfer, HoleData } from '../src/core/types';

const HOLE: HoleData = {
  number: 1,
  par: 4,
  yardage: 400,
  world: { width: 3000, height: 3000 },
  tee: { x: 1500, y: 2800 },
  green: { cx: 1500, cy: 800, rx: 400, ry: 400 },
  slope: { angle: 0, strength: 0 },
  pin: { x: 1500, y: 800 },
  fairway: [
    [
      [1100, 2900],
      [1900, 2900],
      [1900, 100],
      [1100, 100]
    ]
  ],
  hazards: [],
  aiTargets: []
};

const GOLFER: Golfer = {
  id: 'g',
  name: 'G',
  color: 0,
  stats: { drivingPower: 85, drivingAccuracy: 85, approach: 85, chipping: 85, putting: 85 }
};

const engine = new PhysicsEngine(HOLE, null, () => 0.5);

function shoot(clubId: string, power: number, spin: { side: number; top: number }, launchMult = 1) {
  return engine.simulate({
    origin: { x: 1500, y: 2800 },
    aimAngle: -Math.PI / 2,
    swing: { power, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
    club: clubById(clubId),
    golfer: GOLFER,
    fireBoost: 0,
    lie: 'fairway',
    wind: { angle: 0, speed: 0 },
    hole: HOLE,
    preview: true,
    spin,
    launchMult
  });
}

describe('spin physics', () => {
  it('backspin reduces rollout, topspin extends it (monotonic)', () => {
    const back = shoot('pw', 0.9, { side: 0, top: -1 });
    const none = shoot('pw', 0.9, { side: 0, top: 0 });
    const top = shoot('pw', 0.9, { side: 0, top: 1 });
    const dist = (o: { finalPos: { y: number } }): number => 2800 - o.finalPos.y;
    expect(dist(back)).toBeLessThan(dist(none));
    expect(dist(none)).toBeLessThan(dist(top));
  });

  it('full wedge backspin onto the green sucks the ball backward', () => {
    // Green sized to catch the ~104yd wedge landing (y ≈ 2590)
    const greenHole: HoleData = { ...HOLE, green: { cx: 1500, cy: 2560, rx: 300, ry: 300 }, pin: { x: 1500, y: 2560 } };
    const greenEngine = new PhysicsEngine(greenHole, null, () => 0.5);
    const back = greenEngine.simulate({
      origin: { x: 1500, y: 2800 },
      aimAngle: -Math.PI / 2,
      swing: { power: 0.9, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
      club: clubById('pw'),
      golfer: GOLFER,
      fireBoost: 0,
      lie: 'fairway',
      wind: { angle: 0, speed: 0 },
      hole: greenHole,
      preview: true,
      spin: { side: 0, top: -1 }
    });
    const landIdx = back.path.findIndex((p, i) => i > 5 && p.z <= 0.001);
    const land = back.path[landIdx];
    expect(back.finalPos.y).toBeGreaterThan(land.y + 1); // rolled back toward the tee
  });

  // Side spin no longer curves the ball in the AIR — it flies straight and only
  // breaks sideways when it bites the green (playtest). These shots are aimed at
  // a green sized to catch the wedge landing so the on-green kick is exercised.
  const greenHole: HoleData = { ...HOLE, green: { cx: 1500, cy: 2560, rx: 340, ry: 340 }, pin: { x: 1500, y: 2560 } };
  const greenEngine = new PhysicsEngine(greenHole, null, () => 0.5);
  function shootGreen(clubId: string, power: number, spin: { side: number; top: number }) {
    return greenEngine.simulate({
      origin: { x: 1500, y: 2800 },
      aimAngle: -Math.PI / 2,
      swing: { power, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
      club: clubById(clubId),
      golfer: GOLFER,
      fireBoost: 0,
      lie: 'fairway',
      wind: { angle: 0, speed: 0 },
      hole: greenHole,
      preview: true,
      spin
    });
  }

  it('side spin does NOT curve the ball in the air (straight flight)', () => {
    // A shot that lands short of any green (on fairway) must not bend — the old
    // in-air curve is gone, so fade/straight/draw land at essentially the same x.
    const fade = shoot('7i', 0.9, { side: 1, top: 0 });
    const straight = shoot('7i', 0.9, { side: 0, top: 0 });
    const draw = shoot('7i', 0.9, { side: -1, top: 0 });
    expect(Math.abs(fade.finalPos.x - straight.finalPos.x)).toBeLessThan(1.5);
    expect(Math.abs(draw.finalPos.x - straight.finalPos.x)).toBeLessThan(1.5);
  });

  it('side spin breaks the ball sideways when it lands on the green', () => {
    const fade = shootGreen('pw', 0.9, { side: 1, top: 0 });
    const straight = shootGreen('pw', 0.9, { side: 0, top: 0 });
    const draw = shootGreen('pw', 0.9, { side: -1, top: 0 });
    // Aiming -y (north): +side kicks right of the line = +x on the bounce.
    expect(fade.finalPos.x).toBeGreaterThan(straight.finalPos.x + 3);
    expect(draw.finalPos.x).toBeLessThan(straight.finalPos.x - 3);
  });

  it('the green kick is visible but bounded (not cartoonish)', () => {
    const fade = shootGreen('pw', 0.9, { side: 1, top: 0 });
    const kickYd = Math.abs(fade.finalPos.x - 1500) / 2;
    expect(kickYd).toBeLessThan(26);
    expect(kickYd).toBeGreaterThan(2);
  });

  it('breaks to the aimed side even in a crosswind (kick follows the shot line)', () => {
    // A stiff left-to-right crosswind drifts the ball right in the air; the green
    // kick must still break in the SPIN direction relative to the AIM (right
    // swipe = right of the shot), not perpendicular to the wind-drifted landing
    // velocity — the "swipe right, breaks left" playtest bug.
    const wind = { angle: 0, speed: 16 }; // pushes +x
    const shot = (side: number) =>
      greenEngine.simulate({
        origin: { x: 1500, y: 2800 },
        aimAngle: -Math.PI / 2,
        swing: { power: 0.9, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
        club: clubById('pw'),
        golfer: GOLFER,
        fireBoost: 0,
        lie: 'fairway',
        wind,
        hole: greenHole,
        preview: true,
        spin: { side, top: 0 }
      });
    const right = shot(1);
    const none = shot(0);
    const left = shot(-1);
    // Relative to the SAME wind-drifted no-spin baseline, +side lands further
    // right and -side further left.
    expect(right.finalPos.x).toBeGreaterThan(none.finalPos.x + 3);
    expect(left.finalPos.x).toBeLessThan(none.finalPos.x - 3);
  });

  it('low trajectory cuts wind better than high (Phase 2 altitude wind)', () => {
    const windy = { angle: 0, speed: 15 }; // pure crosswind toward +x
    const shot = (mult: number) =>
      engine.simulate({
        origin: { x: 1500, y: 2800 },
        aimAngle: -Math.PI / 2,
        swing: { power: 0.9, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
        club: clubById('5i'),
        golfer: GOLFER,
        fireBoost: 0,
        lie: 'fairway',
        wind: windy,
        hole: HOLE,
        preview: true,
        launchMult: mult
      });
    const low = shot(0.72);
    const high = shot(1.25);
    expect(Math.abs(low.finalPos.x - 1500)).toBeLessThan(Math.abs(high.finalPos.x - 1500) * 0.8);
  });

  it('re-integrating with new spin mid-flight reproduces the flown prefix exactly', () => {
    const launch = engine.resolveLaunch({
      origin: { x: 1500, y: 2800 },
      aimAngle: -Math.PI / 2,
      swing: { power: 0.9, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
      club: clubById('7i'),
      golfer: GOLFER,
      fireBoost: 0,
      lie: 'fairway',
      wind: { angle: 1, speed: 8 },
      hole: HOLE,
      preview: true
    });
    const original = engine.integrateLaunch(launch, { side: 0, top: 0 }, 0);
    const CUT = 30;
    const reshaped = engine.integrateLaunch(launch, { side: 1, top: -0.5 }, CUT);
    for (let i = 0; i <= CUT && i < original.path.length; i++) {
      expect(reshaped.path[i]).toEqual(original.path[i]);
    }
    // ...and the tail actually diverges
    const last = Math.min(original.path.length, reshaped.path.length) - 1;
    expect(reshaped.path[last]).not.toEqual(original.path[last]);
  });
});

describe('StrikeControl', () => {
  it('maps drag offsets onto the clamped ball face', () => {
    const s = new StrikeControl();
    s.setFromOffset(15, 15, 30); // right + down half-radius
    expect(s.x).toBeCloseTo(0.5, 5);
    expect(s.y).toBeCloseTo(-0.5, 5); // screen down = below center
    s.setFromOffset(90, 0, 30); // beyond the rim clamps to the circle
    expect(s.x).toBeCloseTo(1, 5);
  });

  it('right strike draws (curves left = negative side), left strike fades', () => {
    const s = new StrikeControl();
    s.x = 1; // full right
    expect(s.shapeSpin.side).toBeLessThan(0); // draw
    s.x = -1; // full left
    expect(s.shapeSpin.side).toBeGreaterThan(0); // fade
    s.x = 0;
    expect(s.shapeSpin.side).toBe(0);
    expect(s.shapeSpin.top).toBe(0); // dot never sets top spin
  });

  it('strike height sets launch: bottom higher, top lower', () => {
    const s = new StrikeControl();
    expect(s.launchMult).toBe(1);
    s.y = -1; // bottom strike
    expect(s.launchMult).toBeGreaterThan(1);
    s.y = 1; // top strike
    expect(s.launchMult).toBeLessThan(1);
  });

  it('extreme strikes raise the risk multiplier', () => {
    const s = new StrikeControl();
    expect(s.riskMult).toBe(1);
    s.x = 1;
    expect(s.riskMult).toBeGreaterThan(1);
  });
});
