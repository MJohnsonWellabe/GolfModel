import { describe, expect, it } from 'vitest';
import { PX_PER_YARD } from '../src/config';
import { PhysicsEngine, effectiveCarryYards } from '../src/systems/PhysicsEngine';
import { clubById } from '../src/data/clubs';
import { Golfer, HoleData, SwingResult, Wind } from '../src/core/types';

/** Flat-stat golfer so carries are easy to reason about. */
const GOLFER: Golfer = {
  id: 'test',
  name: 'Test',
  color: 0xffffff,
  look: { skin: 0, shirt: 0, hat: null, hair: null },
  stats: {
    drivingPower: 80,
    drivingAccuracy: 80,
    approach: 80,
    chipping: 80,
    putting: 80
  }
};

/**
 * Synthetic hole, laid out north–south (tee at the bottom, pin at the top):
 * - green: 100px-radius circle at (1000, 300), dead flat
 * - island water: a band overlapping the green (green must win)
 * - creek: crosses the fairway at y 1450..1550
 * - trees: a stand short-right of the green landing zone
 */
const HOLE: HoleData = {
  number: 1,
  par: 4,
  yardage: 400,
  world: { width: 2000, height: 2000 },
  tee: { x: 1000, y: 1800 },
  green: { cx: 1000, cy: 300, rx: 100, ry: 100 },
  slope: { angle: 0, strength: 0 },
  pin: { x: 1000, y: 300 },
  fairway: [
    [
      [800, 200],
      [1200, 200],
      [1200, 1900],
      [800, 1900]
    ]
  ],
  hazards: [
    {
      type: 'water',
      polygon: [
        [850, 150],
        [1150, 150],
        [1150, 450],
        [850, 450]
      ]
    },
    {
      type: 'water',
      polygon: [
        [700, 1450],
        [1300, 1450],
        [1300, 1550],
        [700, 1550]
      ]
    },
    {
      type: 'bunker',
      polygon: [
        [1150, 500],
        [1250, 500],
        [1250, 600],
        [1150, 600]
      ]
    }
  ],
  aiTargets: []
};

const NO_WIND: Wind = { angle: 0, speed: 0 };
const PERFECT = (power: number): SwingResult => ({
  power,
  powerQuality: 'perfect',
  accuracy: 0,
  accuracyQuality: 'perfect'
});

const engine = new PhysicsEngine(HOLE);

describe('surfaceAt priority', () => {
  it('an island green reads as green, not the water under it', () => {
    expect(engine.surfaceAt(1000, 300)).toBe('green');
  });

  it('fringe ring sits just outside the green even over water', () => {
    expect(engine.surfaceAt(1000, 410)).toBe('fringe');
  });

  it('water applies outside green + fringe', () => {
    expect(engine.surfaceAt(880, 170)).toBe('water');
  });

  it('bunker, fairway and rough classify by polygon', () => {
    expect(engine.surfaceAt(1200, 550)).toBe('sand');
    expect(engine.surfaceAt(1000, 1000)).toBe('fairway');
    expect(engine.surfaceAt(300, 1000)).toBe('rough');
  });
});

describe('simulate', () => {
  it('a perfect straight iron carries its rated distance with no wind', () => {
    const club = clubById('7i');
    const carryYds = effectiveCarryYards(club, GOLFER, 0, 'tee');
    const outcome = engine.simulate({
      origin: { x: 1000, y: 1800 },
      aimAngle: -Math.PI / 2, // straight up the fairway
      swing: PERFECT(0.6),
      club,
      golfer: GOLFER,
      fireBoost: 0,
      lie: 'tee',
      wind: NO_WIND,
      hole: HOLE,
      preview: true
    });
    const travelled = 1800 - outcome.finalPos.y;
    const carryPx = carryYds * 0.6 * PX_PER_YARD;
    // Lands at ~carry then bounces/rolls a bit further — never shorter, never wildly long
    expect(travelled).toBeGreaterThanOrEqual(carryPx * 0.95);
    expect(travelled).toBeLessThan(carryPx * 1.5);
    expect(Math.abs(outcome.finalPos.x - 1000)).toBeLessThan(1); // dead straight
    expect(outcome.waterPenalty).toBe(false);
  });

  it('a ball down into the creek takes a penalty and drops on dry land', () => {
    const club = clubById('7i');
    const carryYds = effectiveCarryYards(club, GOLFER, 0, 'tee');
    // Aim the carry into the middle of the creek band (y = 1500)
    const power = 300 / PX_PER_YARD / carryYds;
    const outcome = engine.simulate({
      origin: { x: 1000, y: 1800 },
      aimAngle: -Math.PI / 2,
      swing: PERFECT(power),
      club,
      golfer: GOLFER,
      fireBoost: 0,
      lie: 'tee',
      wind: NO_WIND,
      hole: HOLE,
      preview: true
    });
    expect(outcome.waterPenalty).toBe(true);
    expect(outcome.surface).not.toBe('water');
    // Drop point is on the near (tee) side of the creek
    expect(outcome.finalPos.y).toBeGreaterThan(1550);
  });

  it('a straight putt at the cup with matching pace drops', () => {
    const putter = clubById('putter');
    const carryYds = effectiveCarryYards(putter, GOLFER, 0, 'green');
    const origin = { x: 1000, y: 350 }; // 50px = 25yd... a long but flat putt
    const power = 50 / PX_PER_YARD / carryYds;
    const outcome = engine.simulate({
      origin,
      aimAngle: -Math.PI / 2,
      swing: PERFECT(power),
      club: putter,
      golfer: GOLFER,
      fireBoost: 0,
      lie: 'green',
      wind: NO_WIND,
      hole: HOLE,
      preview: true
    });
    expect(outcome.holed).toBe(true);
    expect(outcome.finalPos).toEqual(HOLE.pin);
  });

  it('a putt blasted well past the cup lips out (too fast to capture)', () => {
    const putter = clubById('putter');
    const carryYds = effectiveCarryYards(putter, GOLFER, 0, 'green');
    const outcome = engine.simulate({
      origin: { x: 1000, y: 350 },
      aimAngle: -Math.PI / 2,
      swing: PERFECT(Math.min(1, (140 / PX_PER_YARD) / carryYds)),
      club: putter,
      golfer: GOLFER,
      fireBoost: 0,
      lie: 'green',
      wind: NO_WIND,
      hole: HOLE,
      preview: true
    });
    expect(outcome.holed).toBe(false);
    expect(outcome.finalPos.y).toBeLessThan(300); // rolled past the hole
  });
});

describe('perfect-click residual dispersion (difficulty pass)', () => {
  // Open hole, no hazards near the landing zone, so spread isn't clamped.
  const OPEN: HoleData = {
    ...HOLE,
    green: { cx: 1000, cy: 100, rx: 60, ry: 60 },
    pin: { x: 1000, y: 100 },
    fairway: [[[600, 0], [1400, 0], [1400, 1900], [600, 1900]]],
    hazards: []
  };
  const openEngine = new PhysicsEngine(OPEN);

  const spread = (clubId: string, power: number): number => {
    const club = clubById(clubId);
    const xs: number[] = [];
    for (let i = 0; i < 200; i++) {
      const o = openEngine.simulate({
        origin: { x: 1000, y: 1800 },
        aimAngle: -Math.PI / 2,
        swing: PERFECT(power),
        club,
        golfer: GOLFER,
        fireBoost: 0,
        lie: 'tee',
        wind: NO_WIND,
        hole: OPEN
        // no preview → residual dispersion applies
      });
      xs.push(o.finalPos.x);
    }
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  };

  it('a perfect driver no longer flies dead straight', () => {
    expect(spread('driver', 0.7)).toBeGreaterThan(1); // >1px lateral scatter
  });

  it('a perfect wedge disperses less (in absolute terms) than a perfect driver', () => {
    expect(spread('pw', 0.7)).toBeLessThan(spread('driver', 0.7));
  });
});

describe('effectiveCarryYards', () => {
  it('scales with the governing stat and the lie', () => {
    const iron = clubById('7i');
    const fromFairway = effectiveCarryYards(iron, GOLFER, 0, 'fairway');
    const fromRough = effectiveCarryYards(iron, GOLFER, 0, 'rough');
    const fromSand = effectiveCarryYards(iron, GOLFER, 0, 'sand');
    // statMult = 0.259 + (approach/100) * 0.926 (GDD Appendix A carry table)
    expect(fromFairway).toBeCloseTo(160 * (0.259 + 0.8 * 0.926));
    expect(fromRough).toBeCloseTo(fromFairway * 0.75);
    expect(fromSand).toBeCloseTo(fromFairway * 0.55);
  });

  it('fire boost raises the effective stat', () => {
    const iron = clubById('7i');
    expect(effectiveCarryYards(iron, GOLFER, 5, 'fairway')).toBeGreaterThan(
      effectiveCarryYards(iron, GOLFER, 0, 'fairway')
    );
  });
});
