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
  // Top edge sits clear of the green's fringe-margin ring (green rx/ry 100 +
  // FRINGE_MARGIN 32 = 132, so the ring's far edge is y=432) — a real fairway
  // ribbon narrows well before the green; a rectangle flush against the green
  // like this hole used to have would (correctly, post-fix) always read as
  // fairway instead of fringe right at the collar, which isn't realistic.
  fairway: [
    [
      [800, 450],
      [1200, 450],
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
    },
    {
      // Beach band spanning rough (x<800) and fairway (x>800): the beach reads
      // as sand ONLY over the rough; the maintained fairway wins the overlap.
      type: 'bunker',
      beach: true,
      polygon: [
        [600, 900],
        [900, 900],
        [900, 1000],
        [600, 1000]
      ]
    },
    {
      // Beach band overlapping the island water: the sea always wins, so this
      // reads as water, never sand.
      type: 'bunker',
      beach: true,
      polygon: [
        [860, 160],
        [1000, 160],
        [1000, 260],
        [860, 260]
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

  it('fairway wins over the fringe margin — a ball on the fairway near the green is never "just off the green"', () => {
    // Regression: the fringe margin used to be checked BEFORE the fairway
    // loop, so any fairway ribbon within FRINGE_MARGIN (16yd) of the green
    // was misclassified 'fringe' — and autoSelectClub arms the putter for
    // fringe within 35yd of the pin, so the game handed the player a putter
    // while plainly standing in the fairway ("putter in my hand when I'm off
    // the green"). Build a hole where the fairway ribbon deliberately runs
    // right up to (and past) the green, exactly like a real approach.
    const approachHole: HoleData = {
      ...HOLE,
      fairway: [[[900, 200], [1100, 200], [1100, 1900], [900, 1900]]],
      hazards: [] // isolate the fringe/fairway precedence from HOLE's water rectangle
    };
    const approachEngine = new PhysicsEngine(approachHole);
    // Within the fringe margin (green edge y=400, margin reaches y=432) AND
    // inside the fairway ribbon (x900-1100) → fairway wins.
    expect(approachEngine.surfaceAt(1000, 410)).toBe('fairway');
    // Same margin ring (130px from the green center, just inside the 132px
    // reach), but OUTSIDE the fairway ribbon (x870 < the 900-1100 strip) →
    // still the protective fringe collar, unchanged from before this fix.
    expect(approachEngine.surfaceAt(870, 300)).toBe('fringe');
  });

  it('a green-side beach/waste bunker wins over the fringe margin — a ball in sand is never "just off the green"', () => {
    // Regression: the fringe-margin check excluded fairway polygons but not
    // beach/waste bunker polygons, so a green-side waste/beach bunker within
    // FRINGE_MARGIN misclassified as 'fringe' — and autoSelectClub arms the
    // putter for fringe within 35yd of the pin, handing the player a putter
    // while standing in sand ("putter in my hand when I'm in the bunker").
    const bunkerHole: HoleData = {
      ...HOLE,
      fairway: [],
      hazards: [{ type: 'bunker', waste: true, polygon: [[900, 350], [1100, 350], [1100, 432], [900, 432]] }]
    };
    const bunkerEngine = new PhysicsEngine(bunkerHole);
    // Inside the fringe margin ring (green edge y=400, margin reaches y=432)
    // AND inside the waste bunker → sand wins, not fringe.
    expect(bunkerEngine.surfaceAt(1000, 410)).toBe('sand');
    // Same margin ring, outside the bunker → still the protective fringe collar.
    expect(bunkerEngine.surfaceAt(870, 300)).toBe('fringe');

    const beachHole: HoleData = {
      ...HOLE,
      fairway: [],
      hazards: [{ type: 'bunker', beach: true, polygon: [[900, 350], [1100, 350], [1100, 432], [900, 432]] }]
    };
    expect(new PhysicsEngine(beachHole).surfaceAt(1000, 410)).toBe('sand');
  });

  it('water applies outside green + fringe', () => {
    expect(engine.surfaceAt(880, 170)).toBe('water');
  });

  it('bunker, fairway and rough classify by polygon', () => {
    expect(engine.surfaceAt(1200, 550)).toBe('sand');
    expect(engine.surfaceAt(1000, 1000)).toBe('fairway');
    expect(engine.surfaceAt(300, 1000)).toBe('rough');
  });

  it('a beach band reads as sand over rough but loses to fairway and water', () => {
    // Over rough → the shore reads as sand.
    expect(engine.surfaceAt(650, 950)).toBe('sand');
    // Same band over the maintained fairway → still fairway (beach never eats
    // a landing area).
    expect(engine.surfaceAt(850, 950)).toBe('fairway');
    // A beach drawn over the water → the sea wins.
    expect(engine.surfaceAt(900, 200)).toBe('water');
  });

  it('water penalizes a ROUGH band just OUTSIDE the polygon (the wobble-painted blue)', () => {
    // The bake paints blue up to ~20px past the water polygon, so a ball
    // resting in that band over ROUGH read as land (playtest Timberline h3:
    // "landed on blue, no penalty, played off it"). The collision carries a
    // WATER_EDGE_MARGIN (~12px) that upgrades ONLY rough. The creek spans
    // x 700..1300, y 1450..1550; the fairway is x 800..1200, so x=750 near the
    // creek edge is rough.
    expect(engine.surfaceAt(750, 1445)).toBe('water'); // ~5px outside, over rough → water
    // ...but well clear of the shore is dry, no false penalties.
    expect(engine.surfaceAt(750, 1430)).toBe('rough'); // ~20px outside → land
    // A FAIRWAY lie hugging the water stays playable — the margin never eats a
    // maintained surface (a fairway can run right along a pond).
    expect(engine.surfaceAt(1000, 1442)).toBe('fairway'); // 8px outside but on fairway
  });
});

describe('bunker dead-stop', () => {
  it('a ball that lands in a bunker plugs and never rolls out', () => {
    // A hole whose whole landing zone is one big bunker (green kept far away).
    const sandHole: HoleData = {
      ...HOLE,
      green: { cx: 1000, cy: 100, rx: 40, ry: 40 },
      pin: { x: 1000, y: 100 },
      hazards: [{ type: 'bunker', polygon: [[700, 400], [1300, 400], [1300, 1700], [700, 1700]] }]
    };
    const e = new PhysicsEngine(sandHole);
    const out = e.simulate({
      origin: { x: 1000, y: 1800 },
      aimAngle: -Math.PI / 2,
      swing: PERFECT(0.6),
      club: clubById('7i'),
      golfer: GOLFER,
      fireBoost: 0,
      lie: 'tee',
      wind: NO_WIND,
      hole: sandHole
    });
    // It came to rest in the sand…
    expect(e.surfaceAt(out.finalPos.x, out.finalPos.y)).toBe('sand');
    // …right where it first touched down (no bounce/roll out of the trap).
    const landIdx = out.path.findIndex((p, i) => i > 3 && p.z <= 0.001);
    const land = out.path[landIdx];
    const rolled = Math.hypot(out.finalPos.x - land.x, out.finalPos.y - land.y);
    expect(rolled).toBeLessThan(2);
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
    // statMult = 0.259 + (approach/100) * 0.926 (GDD Appendix A carry table).
    // 7i is an iron, so the woods-only driveDistanceScale does not apply here.
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
