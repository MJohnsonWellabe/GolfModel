import { describe, expect, it } from 'vitest';
import { AIController } from '../src/systems/AIController';
import { FireSystem } from '../src/systems/FireSystem';
import { OPPONENTS } from '../src/data/opponents';
import { mulberry32 } from '../src/utils/Random';
import { Golfer, HoleData } from '../src/core/types';
import { dist } from '../src/utils/Geometry';

/** Reachable-with-risk hole: pin ~275yd out, water guarding the direct line. */
const HOLE: HoleData = {
  number: 1,
  par: 4,
  yardage: 300,
  world: { width: 2000, height: 2000 },
  tee: { x: 1000, y: 1800 },
  green: { cx: 1000, cy: 1250, rx: 80, ry: 80 },
  slope: { angle: 0, strength: 0 },
  pin: { x: 1040, y: 1230 },
  fairway: [
    [
      [850, 1900],
      [1150, 1900],
      [1150, 1100],
      [850, 1100]
    ]
  ],
  hazards: [],
  aiTargets: [{ x: 1000, y: 1500 }]
};

const GOLFER: Golfer = {
  id: 'g',
  name: 'G',
  color: 0,
  stats: { drivingPower: 85, drivingAccuracy: 85, approach: 85, chipping: 85, putting: 85 }
};

const aggressive = { aggression: 0.95, layupBias: 0.1, pinHunting: 0.9 };
const conservative = { aggression: 0.1, layupBias: 0.9, pinHunting: 0.1 };

describe('AI personalities', () => {
  it('an aggressive AI goes for a stretch green a conservative one lays up on', () => {
    // 285yd pin, ~283yd rated carry: inside the aggressive reach window,
    // outside the conservative one.
    const hole = { ...HOLE, pin: { x: 1000, y: 1230 }, green: { ...HOLE.green, cy: 1230 } };
    const agg = new AIController(GOLFER, new FireSystem(), null, mulberry32(1), aggressive);
    const con = new AIController(GOLFER, new FireSystem(), null, mulberry32(1), conservative);
    const aTarget = agg.decide(hole.tee, 'tee', { angle: 0, speed: 0 }, hole).aimPoint;
    const cTarget = con.decide(hole.tee, 'tee', { angle: 0, speed: 0 }, hole).aimPoint;
    const aDist = dist(hole.tee, aTarget);
    const cDist = dist(hole.tee, cTarget);
    // Aggressive fires at (or near) the pin; conservative stays short of it
    expect(dist(aTarget, hole.pin)).toBeLessThan(60);
    expect(cDist).toBeLessThan(aDist - 20);
  });

  it('a low pin-hunting AI aims toward the fat of the green', () => {
    // From 150yd out, pin sits offset from the green centre
    const from = { x: 1000, y: 1530 };
    const con = new AIController(GOLFER, new FireSystem(), null, mulberry32(2), conservative);
    const agg = new AIController(GOLFER, new FireSystem(), null, mulberry32(2), aggressive);
    const cAim = con.decide(from, 'fairway', { angle: 0, speed: 0 }, HOLE).aimPoint;
    const aAim = agg.decide(from, 'fairway', { angle: 0, speed: 0 }, HOLE).aimPoint;
    const center = { x: HOLE.green.cx, y: HOLE.green.cy };
    expect(dist(cAim, center)).toBeLessThan(dist(aAim, center));
    expect(dist(aAim, HOLE.pin)).toBeLessThan(dist(cAim, HOLE.pin));
  });

  it('every shipped opponent produces a legal decision from the tee', () => {
    for (const opp of OPPONENTS) {
      const ai = new AIController(opp, new FireSystem(), null, mulberry32(3), opp.personality);
      const d = ai.decide(HOLE.tee, 'tee', { angle: 1, speed: 10 }, HOLE);
      expect(d.club.id).toBeTruthy();
      expect(Number.isFinite(d.aimAngle)).toBe(true);
      expect(d.swing.power).toBeGreaterThan(0);
    }
  });
});

describe('fire integration', () => {
  it('two all-perfect swings ignite and boost stats + perfect zone', () => {
    const fire = new FireSystem();
    const perfect = { power: 1, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' } as const;
    expect(fire.recordSwing(perfect)).toBe(false);
    expect(fire.recordSwing(perfect)).toBe(true);
    expect(fire.isOnFire).toBe(true);
    expect(fire.statBoost).toBeGreaterThan(0);
    expect(fire.perfectZoneMultiplier).toBeGreaterThan(1);
    // A missed band puts it out
    fire.recordSwing({ power: 1, powerQuality: 'miss', accuracy: 0.5, accuracyQuality: 'miss' });
    expect(fire.isOnFire).toBe(false);
  });
});
