import { describe, expect, it } from 'vitest';
import redhollowJson from '../../src/data/courses/redhollow.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { resolveTheme } from '../../src/core/rendering/Theme';
import { buildHeightField, HeightField } from '../../src/systems/HeightField';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { CLUBS } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { Golfer, SwingResult, Wind } from '../../src/core/types';

/**
 * Rock carom physics gates (Red Rock pass 7): the strategic boulder on
 * Rimrock's fairway is a swept-cylinder collider with true normal
 * reflection — these tests fire REAL engine shots at it and assert the
 * rebound, no-tunnel, no-trap and lane-pass behavior the spec demands.
 */

const redhollow = loadCourse(redhollowJson as unknown as CourseAuthoring);
const hole = redhollow.holes[0];
const theme = resolveTheme(redhollow);
const hf = buildHeightField(hole, theme.bunkerDepthScale ?? 1, theme.wasteDepthScale ?? 0) as HeightField;
const rock = hole.hazards.find((hz) => hz.type === 'rock')!;

const golfer: Golfer = {
  id: 'sim',
  name: 'Sim',
  color: 0,
  stats: { drivingPower: 85, drivingAccuracy: 85, approach: 85, chipping: 85, putting: 85 }
};
const NO_WIND: Wind = { angle: 0, speed: 0 };
// swing.power is a FRACTION of the club's full carry (0..1).
const PERFECT: SwingResult = { power: 1, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' };
const driver = CLUBS.find((c) => c.id === 'driver')!;
const putter = CLUBS.find((c) => c.id === 'putter')!;

function engineWith(seed: number): PhysicsEngine {
  return new PhysicsEngine(hole, hf, mulberry32(seed));
}

/** Aim angle from an origin straight at the rock center. */
function aimAtRock(ox: number, oy: number): number {
  return Math.atan2(rock.cy! - oy, rock.cx! - ox);
}

describe('the strategic rock caroms', () => {
  it('a rolling ball square into the rock rebounds off it (positive normal exit)', () => {
    // Putt hard at the rock from short range on the fairway — a pure roll.
    const origin = { x: rock.cx!, y: rock.cy! + 120 };
    const engine = engineWith(1);
    const out = engine.simulate({
      origin,
      aimAngle: aimAtRock(origin.x, origin.y),
      swing: PERFECT, // full 90yd-scale putt: arrives at the rock with real pace
      club: putter,
      golfer,
      fireBoost: 0,
      lie: 'fairway',
      wind: NO_WIND,
      hole
    });
    expect(out.hitRock).toBe(true);
    // The ball ends OUTSIDE the collision cylinder, on the shot's side of
    // the rock (rebounded, not tunneled through to the far side).
    const d = Math.hypot(out.finalPos.x - rock.cx!, out.finalPos.y - rock.cy!);
    expect(d).toBeGreaterThanOrEqual(rock.r!);
    expect(out.finalPos.y).toBeGreaterThan(rock.cy!);
  });

  it('no shot ever rests inside the rock or tunnels through it (50 seeded strikes)', () => {
    for (let s = 0; s < 50; s++) {
      const engine = engineWith(100 + s * 7);
      // Vary origin around the tee-side arc and fire a full driver at it —
      // the fastest ball in the game, the worst tunneling case.
      const ang = -Math.PI / 2 + (s / 50 - 0.5) * 0.5;
      const origin = { x: rock.cx! + Math.cos(ang + Math.PI / 2) * 0, y: rock.cy! + 460 };
      const jitterX = (s % 11) - 5; // aim scatter across the rock's face
      const aim = Math.atan2(rock.cy! - origin.y, rock.cx! + jitterX - origin.x);
      const out = engine.simulate({
        origin,
        aimAngle: aim,
        swing: PERFECT,
        club: driver,
        golfer,
        fireBoost: 0,
        lie: 'tee',
        wind: NO_WIND,
        hole
      });
      const d = Math.hypot(out.finalPos.x - rock.cx!, out.finalPos.y - rock.cy!);
      expect(d, `seed ${s} final position clear of the rock`).toBeGreaterThanOrEqual(rock.r!);
      // Every path sample stays out of the cylinder interior too (no
      // tunneling frames, no trapped frames).
      for (const p of out.path) {
        const pd = Math.hypot(p.x - rock.cx!, p.y - rock.cy!);
        expect(pd, `seed ${s} path sample inside rock`).toBeGreaterThanOrEqual(rock.r! - 1.5);
      }
    }
  });

  it('a glancing roller deflects and keeps going (tangential pass, small angle change)', () => {
    // Aim just past the rock's edge: the swept test clips the cylinder,
    // the carom deflects the line but most tangential speed survives.
    const origin = { x: rock.cx! - rock.r! - 2, y: rock.cy! + 140 };
    const engine = engineWith(3);
    const out = engine.simulate({
      origin,
      aimAngle: Math.atan2(-1, 0.06), // nearly straight up-field, shaving the west face
      swing: { ...PERFECT, power: 0.8 },
      club: putter,
      golfer,
      fireBoost: 0,
      lie: 'fairway',
      wind: NO_WIND,
      hole
    });
    if (out.hitRock) {
      // Deflected but not stopped at the face: it travels on past the rock.
      const travelled = Math.hypot(out.finalPos.x - origin.x, out.finalPos.y - origin.y);
      expect(travelled).toBeGreaterThan(60);
    }
    const d = Math.hypot(out.finalPos.x - rock.cx!, out.finalPos.y - rock.cy!);
    expect(d).toBeGreaterThanOrEqual(rock.r!);
  });

  it('both lanes play clean past the rock (no phantom collider beyond the mesh)', () => {
    for (const laneX of [rock.cx! - rock.r! - 20, rock.cx! + rock.r! + 20]) {
      const origin = { x: laneX, y: rock.cy! + 200 };
      const engine = engineWith(5);
      const out = engine.simulate({
        origin,
        aimAngle: -Math.PI / 2, // straight up the lane
        swing: { ...PERFECT, power: 0.6 },
        club: putter,
        golfer,
        fireBoost: 0,
        lie: 'fairway',
        wind: NO_WIND,
        hole
      });
      expect(out.hitRock ?? false, `lane at x=${laneX}`).toBe(false);
    }
  });
});

describe('h2 tier putts behave', () => {
  const h2 = redhollow.holes[1];
  const theme2 = resolveTheme(redhollow);
  const hf2 = buildHeightField(h2, theme2.bunkerDepthScale ?? 1, theme2.wasteDepthScale ?? 0) as HeightField;

  it('the tier reads as a real multi-foot elevation change (honest putt readout)', () => {
    // The putt HUD now shows true net rise (groundAt delta × 1.5 ft/unit), same
    // as full shots — a tier putt reads several FEET, not "11 inches".
    const FT_PER_UNIT = 1.5;
    const backFt = hf2.heightAt(450, 398) * FT_PER_UNIT;
    const frontFt = hf2.heightAt(450, 466) * FT_PER_UNIT;
    expect(backFt - frontFt, 'tier rise (ft)').toBeGreaterThanOrEqual(3.5);
  });

  it('an uphill putt from the lower tier can reach the upper tier and stop there', () => {
    const engine = new PhysicsEngine(h2, hf2, mulberry32(11));
    // From the lower-front flat toward the back tier, pin at the back pin.
    const withPin = { ...h2, pin: { x: 450, y: 398 } };
    const out = engine.simulate({
      origin: { x: 438, y: 466 },
      aimAngle: Math.atan2(398 - 466, 450 - 438),
      swing: { ...PERFECT, power: 0.42 },
      club: putter,
      golfer,
      fireBoost: 0,
      lie: 'green',
      wind: NO_WIND,
      hole: withPin
    });
    // Arrives on the upper tier (past the ramp) — height near the back
    // tier's level, still on the green surface.
    const restH = hf2.heightAt(out.finalPos.x, out.finalPos.y);
    expect(restH).toBeGreaterThanOrEqual(hf2.heightAt(450, 398) - 1.2);
    expect(['green', 'fringe']).toContain(out.surface);
  });

  it('a downhill putt from the upper tier reaches the lower tier without flying the green', () => {
    const engine = new PhysicsEngine(h2, hf2, mulberry32(13));
    const withPin = { ...h2, pin: { x: 438, y: 462 } };
    const out = engine.simulate({
      origin: { x: 450, y: 398 },
      aimAngle: Math.atan2(462 - 398, 438 - 450),
      swing: { ...PERFECT, power: 0.26 },
      club: putter,
      golfer,
      fireBoost: 0,
      lie: 'green',
      wind: NO_WIND,
      hole: withPin
    });
    // Ends at lower-tier height, still on the putting complex.
    const restH = hf2.heightAt(out.finalPos.x, out.finalPos.y);
    expect(restH).toBeLessThanOrEqual(hf2.heightAt(450, 398) - 1.2);
    expect(['green', 'fringe']).toContain(out.surface);
  });
});

// PASS 9 (playtest): far more fairside rock on Rimrock + a three-rock fairway
// cluster. These gate the tester's explicit asks.
describe('Rimrock pass-9 rock frequency + fairway cluster', () => {
  it('h1 carries 50+ side rocks in all four shades', () => {
    const lf = hole.landforms ?? [];
    expect(lf.length).toBeGreaterThanOrEqual(50);
    for (const key of ['rocks_red_bright', 'rocks_red_mid', 'rocks_red_dark', 'rocks_red_cluster'])
      expect(lf.some((l) => l.key === key), `shade ${key}`).toBe(true);
  });

  it('all three fairway rocks carom a struck ball', () => {
    const rocks = hole.hazards.filter((hz) => hz.type === 'rock');
    expect(rocks.length).toBe(3);
    for (const rk of rocks) {
      const origin = { x: rk.cx!, y: rk.cy! + 110 };
      const out = engineWith(3).simulate({
        origin,
        aimAngle: Math.atan2(rk.cy! - origin.y, rk.cx! - origin.x),
        swing: PERFECT,
        club: putter,
        golfer,
        fireBoost: 0,
        lie: 'fairway',
        wind: NO_WIND,
        hole
      });
      expect(out.hitRock, `rock @${rk.cx},${rk.cy} caroms`).toBe(true);
    }
  });

  it('each fairway rock leaves a clean playable lane beside it', () => {
    // A ball rolled down a lane one rock-radius + 26px to the side must NOT
    // hit that rock — i.e. there is real room to play past the cluster.
    const rocks = hole.hazards.filter((hz) => hz.type === 'rock');
    for (const rk of rocks) {
      const offset = rk.r! + 26;
      let cleanLane = false;
      for (const side of [-1, 1]) {
        const origin = { x: rk.cx! + side * offset, y: rk.cy! + 110 };
        const out = engineWith(5).simulate({
          origin,
          aimAngle: -Math.PI / 2, // straight up the hole, parallel past the rock
          swing: PERFECT,
          club: putter,
          golfer,
          fireBoost: 0,
          lie: 'fairway',
          wind: NO_WIND,
          hole
        });
        if (!out.hitRock) cleanLane = true;
      }
      expect(cleanLane, `rock @${rk.cx},${rk.cy} has a clean lane`).toBe(true);
    }
  });
});

// PASS 10 (playtest): the LARGE landform boulders deflect, and the steep right
// cliff bounces a ball back instead of letting it tunnel into the void.
describe('Rimrock pass-10 deflection', () => {
  it('a large landform boulder caroms a struck ball', () => {
    // (476,806,h18) is a big boulder on the right rough of the +10 shelf.
    const lf = (hole.landforms ?? []).find((l) => l.x === 476 && l.y === 806)!;
    expect(lf.h).toBeGreaterThanOrEqual(12); // in the colliding band
    const origin = { x: lf.x, y: lf.y + 120 };
    const out = engineWith(7).simulate({
      origin,
      aimAngle: Math.atan2(lf.y - origin.y, lf.x - origin.x),
      swing: PERFECT,
      club: putter,
      golfer,
      fireBoost: 0,
      lie: 'rough',
      wind: NO_WIND,
      hole
    });
    expect(out.hitRock, 'landform caroms').toBe(true);
  });

  it('small decorative rocks stay pass-through (no minefield)', () => {
    // A small (h < min) landform must NOT collide.
    const small = (hole.landforms ?? []).find((l) => l.h < 12)!;
    const priv = engineWith(1) as unknown as { rocks: Array<{ cx: number; cy: number }> };
    expect(priv.rocks.some((r) => r.cx === small.x && r.cy === small.y)).toBe(false);
  });

  it('a ball driven into the right cliff bounces back and stays in bounds', () => {
    // From the fairway shelf, aim straight into the right wall (rises +26 at
    // x~590). Without the steep-face carom the ball climbs over into the void;
    // with it, the ball caroms back and finishes LEFT of the wall toe, in play.
    const origin = { x: 400, y: 680 };
    const out = engineWith(9).simulate({
      origin,
      aimAngle: 0, // +x, straight at the wall
      swing: { power: 0.5, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
      club: putter,
      golfer,
      fireBoost: 0,
      lie: 'fairway',
      wind: NO_WIND,
      hole
    });
    // Finishes short of the wall crest (bounced), not out on the +26 terrace/void.
    expect(out.finalPos.x, 'stayed left of the wall').toBeLessThan(600);
  });
});
