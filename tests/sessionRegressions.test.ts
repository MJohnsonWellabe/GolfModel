import { describe, expect, it } from 'vitest';
import { PhysicsEngine } from '../src/systems/PhysicsEngine';
import { drawWind } from '../src/systems/RoundSimulator';
import { collectTreeBlobs } from '../src/systems/treeField';
import { shouldShowPuttGrid, CHIP_GRID_YDS } from '../src/core/puttAids';
import { clubById } from '../src/data/clubs';
import { mulberry32 } from '../src/utils/Random';
import { Golfer, HoleData, SwingResult, Wind } from '../src/core/types';

const GOLFER: Golfer = {
  id: 't', name: 'T', color: 0, look: { skin: 0, shirt: 0, hat: null, hair: null },
  stats: { drivingPower: 80, drivingAccuracy: 80, approach: 80, chipping: 80, putting: 80 }
};
const NO_WIND: Wind = { angle: 0, speed: 0 };
const PERFECT = (power: number): SwingResult => ({
  power, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect'
});

const OPEN: HoleData = {
  number: 1, par: 4, yardage: 400, world: { width: 2000, height: 2000 },
  tee: { x: 1000, y: 1800 }, green: { cx: 1000, cy: 100, rx: 60, ry: 60 },
  slope: { angle: 0, strength: 0 }, pin: { x: 1000, y: 100 },
  fairway: [[[600, 0], [1400, 0], [1400, 1900], [600, 1900]]],
  hazards: [], aiTargets: []
};

const landingOf = (out: { path: { x: number; y: number; z: number }[]; finalPos: { x: number; y: number } }) =>
  out.path.find((p, i) => i > 3 && p.z <= 0.001) ?? { ...out.finalPos, z: 0 };

// ---------------------------------------------------------------------------
// Backspin on a WOOD must not check the ball up. Woods keep a spinKeep floor of
// 0.4 and are exempt from the green/fringe backspin bite, so a driven wood
// still releases forward — an iron with the same backspin bites and stops.
// ---------------------------------------------------------------------------
describe('wood backspin does not stop the ball dead', () => {
  // A flat hole whose whole landing area is green, so the iron's green/fringe
  // backspin bite is in play for the comparison.
  const GREENFIELD: HoleData = {
    ...OPEN, green: { cx: 1000, cy: 900, rx: 560, ry: 900 }, pin: { x: 1000, y: 100 }, hazards: []
  };
  const shot = (clubId: string) => {
    const eng = new PhysicsEngine(GREENFIELD);
    return eng.simulate({
      origin: { x: 1000, y: 1800 }, aimAngle: -Math.PI / 2, swing: PERFECT(1),
      club: clubById(clubId), golfer: GOLFER, fireBoost: 0, lie: 'tee',
      wind: NO_WIND, hole: GREENFIELD, preview: true, spin: { side: 0, top: -1 }
    });
  };

  it('a driver with heavy backspin still releases forward', () => {
    const drv = shot('driver');
    const land = landingOf(drv);
    const releaseFwd = land.y - drv.finalPos.y; // +ve = rolled on toward the pin
    expect(releaseFwd).toBeGreaterThan(15);
  });

  it('the same backspin bites (checks up) far harder on an iron', () => {
    const drvFwd = (() => { const o = shot('driver'); return landingOf(o).y - o.finalPos.y; })();
    const ironFwd = (() => { const o = shot('7i'); return landingOf(o).y - o.finalPos.y; })();
    expect(drvFwd).toBeGreaterThan(ironFwd);
  });
});

// ---------------------------------------------------------------------------
// Per-course wind floor: a links course's minWind must be respected so it is
// never dead calm. Shared draw used by both the sim and the live round.
// ---------------------------------------------------------------------------
describe('drawWind respects the course wind band', () => {
  it('floors at minWind and never exceeds maxWind (Port Johnson 20..30)', () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 400; i++) {
      const w = drawWind(rng, 20, 30);
      expect(w.speed).toBeGreaterThanOrEqual(20);
      expect(w.speed).toBeLessThanOrEqual(30);
    }
  });

  it('defaults to the calm 2..20 band when no course override is given', () => {
    const rng = mulberry32(777);
    for (let i = 0; i < 400; i++) {
      const w = drawWind(rng);
      expect(w.speed).toBeGreaterThanOrEqual(2);
      expect(w.speed).toBeLessThanOrEqual(20);
    }
  });
});

// ---------------------------------------------------------------------------
// Aim-line accuracy: a recovery shot (stroke >= 1) uses the smaller
// treeRecoveryMult canopy, so a ball the tee shot would clip threads past once
// you're already in the trees — the aim preview forwards ctx.strokes into the
// same simulate() so the drawn line matches the real shot.
// ---------------------------------------------------------------------------
describe('stroke count shrinks the tree hitbox (preview accuracy)', () => {
  it('a recovery shot clears a trunk that stops the tee shot', () => {
    // Natural landing with no trees.
    const openLand = landingOf(new PhysicsEngine(OPEN).simulate({
      origin: { x: 1000, y: 1800 }, aimAngle: -Math.PI / 2, swing: PERFECT(1),
      club: clubById('7i'), golfer: GOLFER, fireBoost: 0, lie: 'tee', wind: NO_WIND, hole: OPEN, preview: true
    }));
    const treeY = openLand.y + 20;
    // Trunk radius is deterministic from the polygon centroid; place the trunk
    // 0.7r off the flight line so the full (0.95r) hitbox catches it but the
    // recovery (0.52r) hitbox does not.
    const probe: HoleData = { ...OPEN, hazards: [{ type: 'trees', polygon: [[994, treeY - 6], [1006, treeY - 6], [1006, treeY + 6], [994, treeY + 6]] }] };
    const r = collectTreeBlobs(probe)[0].r;
    const cx = 1000 + 0.7 * r;
    const hole: HoleData = { ...OPEN, hazards: [{ type: 'trees', polygon: [[cx - 6, treeY - 6], [cx + 6, treeY - 6], [cx + 6, treeY + 6], [cx - 6, treeY + 6]] }] };
    const eng = new PhysicsEngine(hole);
    const fire = (stroke: number) => eng.simulate({
      origin: { x: 1000, y: 1800 }, aimAngle: -Math.PI / 2, swing: PERFECT(1),
      club: clubById('7i'), golfer: GOLFER, fireBoost: 0, lie: 'tee', wind: NO_WIND, hole, preview: true, stroke
    });
    const tee = fire(0);
    const recovery = fire(1);
    // The tee shot is stopped short by the trunk; the recovery threads past and
    // finishes meaningfully further up the hole (smaller y = closer to the pin).
    expect(tee.finalPos.y - recovery.finalPos.y).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// Firm beach / links waste sand plays firm — a ball runs across it — while a
// scoring bunker still plugs the ball dead. Lets a course be "mostly sand" off
// the fairway without becoming unfinishable.
// ---------------------------------------------------------------------------
describe('beach/waste sand runs; scoring bunkers plug', () => {
  // A ball rolling along the ground crosses from fairway into a sand band that
  // sits between it and the pin. A scoring bunker stops it dead at the edge; a
  // firm beach / waste lets it run on into the sand.
  const rollThrough = (flags: { beach?: boolean; waste?: boolean }): number => {
    const hole: HoleData = {
      ...OPEN, green: { cx: 1000, cy: 100, rx: 40, ry: 40 }, pin: { x: 1000, y: 100 },
      // Fairway only by the green — the ball rolls over ROUGH into the sand band,
      // so the band reads as sand (a beach yields to fairway, never eats a
      // landing area, so it must sit over rough to read as shore sand).
      fairway: [[[900, 0], [1100, 0], [1100, 300], [900, 300]]],
      hazards: [{ type: 'bunker', ...flags, polygon: [[700, 700], [1300, 700], [1300, 1000], [700, 1000]] }]
    };
    const eng = new PhysicsEngine(hole);
    // A firm putt from just short of the sand band, struck hard at the far pin so
    // it reaches the band edge with real pace: a scoring bunker halts it at the
    // edge, firm sand lets it run on into the band.
    const out = eng.simulate({
      origin: { x: 1000, y: 1080 }, aimAngle: -Math.PI / 2, swing: PERFECT(1),
      club: clubById('putter'), golfer: GOLFER, fireBoost: 0, lie: 'fairway', wind: NO_WIND, hole, preview: true
    });
    return 1080 - out.finalPos.y; // forward travel toward the pin (px)
  };

  it('a firm beach lets the ball run further than a scoring bunker halts it', () => {
    const scoring = rollThrough({});
    const beach = rollThrough({ beach: true });
    const waste = rollThrough({ waste: true });
    // The scoring bunker arrests the ball at/near the sand edge (~y1000, ~120px);
    // the firm surfaces carry it deep into the band.
    expect(beach).toBeGreaterThan(scoring + 40);
    expect(waste).toBeGreaterThan(scoring + 40);
    // beach and waste share the firm-sand physics, so they behave the same.
    expect(Math.abs(beach - waste)).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// Greenside chip shows the putting-read grid.
// ---------------------------------------------------------------------------
describe('shouldShowPuttGrid', () => {
  it('is always on for a putt', () => {
    expect(shouldShowPuttGrid({ isPutting: true, isAI: false, lie: 'green', toPinYds: 40 })).toBe(true);
  });
  it('is on for a human short greenside chip inside the threshold', () => {
    expect(shouldShowPuttGrid({ isPutting: false, isAI: false, lie: 'fringe', toPinYds: CHIP_GRID_YDS - 1 })).toBe(true);
  });
  it('is off for a chip beyond the threshold', () => {
    expect(shouldShowPuttGrid({ isPutting: false, isAI: false, lie: 'fringe', toPinYds: CHIP_GRID_YDS + 1 })).toBe(false);
  });
  it('is off from the tee and off for the AI', () => {
    expect(shouldShowPuttGrid({ isPutting: false, isAI: false, lie: 'tee', toPinYds: 2 })).toBe(false);
    expect(shouldShowPuttGrid({ isPutting: false, isAI: true, lie: 'fringe', toPinYds: 2 })).toBe(false);
  });
});
