import { describe, expect, it } from 'vitest';
import { effectiveCarryYards, PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { computeTrueVisionPath } from '../../src/systems/TrueVision';
import { clubById } from '../../src/data/clubs';
import { PX_PER_YARD } from '../../src/config';
import { angleTo } from '../../src/utils/Geometry';
import { ShotContext } from '../../src/core/input/AimControl';
import { golferWith, NO_WIND, openHole } from '../simulation/simHelpers';

const golfer = golferWith(85);
const putter = clubById('putter');
const driver = clubById('driver');
const PUTTER_MAX_CARRY_PX = effectiveCarryYards(putter, golfer, 0, 'green') * PX_PER_YARD;

function ctxOn(ball: { x: number; y: number }, lie: 'green' | 'fairway' = 'green'): ShotContext {
  return { ball, lie, golfer, fireBoost: 0, strokes: 0 };
}

/** Initial aim direction implied by the first two points of a path. */
function initialAngle(path: ReturnType<typeof computeTrueVisionPath>): number {
  return angleTo(path[0], path[1]);
}

describe('True Vision', () => {
  it('reflects the CURRENT aim, not a solved line — on a slope that would curve a straight putt wide, the revealed path still starts on the aimed line and drifts off the pin', () => {
    const hole = openHole({ slope: { angle: 0, strength: 0.6 } });
    const ball = { x: hole.pin.x, y: hole.pin.y + 200 };
    const engine = new PhysicsEngine(hole);
    const aimAngle = angleTo(ball, hole.pin);
    const pinDistPx = Math.hypot(hole.pin.x - ball.x, hole.pin.y - ball.y);
    const maxCarryPx = PUTTER_MAX_CARRY_PX;

    const path = computeTrueVisionPath(engine, hole, ctxOn(ball), {
      aimAngle,
      power: pinDistPx / maxCarryPx,
      club: putter,
      wind: NO_WIND
    });

    // Starts on the aim line the caller actually asked for (no correction).
    expect(Math.abs(initialAngle(path) - aimAngle)).toBeLessThan(0.01);
    // The slope genuinely pushes it off-line — it does NOT snap to the pin.
    const last = path[path.length - 1];
    const missDist = Math.hypot(last.x - hole.pin.x, last.y - hole.pin.y);
    expect(missDist).toBeGreaterThan(5);
  });

  it('is deterministic: identical aim/power/wind produce an identical path', () => {
    const hole = openHole({ slope: { angle: 0.4, strength: 0.5 } });
    const ball = { x: hole.pin.x, y: hole.pin.y + 300 };
    const shot = {
      aimAngle: angleTo(ball, hole.pin),
      power: 0.5,
      club: putter,
      wind: NO_WIND
    };
    const path1 = computeTrueVisionPath(new PhysicsEngine(hole), hole, ctxOn(ball), shot);
    const path2 = computeTrueVisionPath(new PhysicsEngine(hole), hole, ctxOn(ball), shot);
    expect(path1).toEqual(path2);
  });

  it('uses the REAL wind (unlike the flat preview engine): a strong crosswind visibly deflects a full-swing path', () => {
    const hole = openHole();
    const ball = { x: hole.pin.x, y: hole.pin.y + 900 };
    const aimAngle = angleTo(ball, hole.pin);
    const shotBase = {
      aimAngle,
      power: 0.9,
      club: driver
    };

    const calm = computeTrueVisionPath(new PhysicsEngine(hole), hole, ctxOn(ball, 'fairway'), {
      ...shotBase,
      wind: NO_WIND
    });
    // Crosswind perpendicular to the aim line.
    const windy = computeTrueVisionPath(new PhysicsEngine(hole), hole, ctxOn(ball, 'fairway'), {
      ...shotBase,
      wind: { angle: aimAngle + Math.PI / 2, speed: 25 }
    });

    const calmEnd = calm[calm.length - 1];
    const windyEnd = windy[windy.length - 1];
    expect(Math.hypot(windyEnd.x - calmEnd.x, windyEnd.y - calmEnd.y)).toBeGreaterThan(10);
  });

  it('holds a putt to the cup when aimed straight at it on a flat, windless green', () => {
    const hole = openHole();
    const ball = { x: hole.pin.x, y: hole.pin.y + 200 };
    const engine = new PhysicsEngine(hole);
    const aimAngle = angleTo(ball, hole.pin);
    const pinDistPx = Math.hypot(hole.pin.x - ball.x, hole.pin.y - ball.y);
    const maxCarryPx = PUTTER_MAX_CARRY_PX;

    const path = computeTrueVisionPath(engine, hole, ctxOn(ball), {
      aimAngle,
      power: pinDistPx / maxCarryPx,
      club: putter,
      wind: NO_WIND
    });
    const last = path[path.length - 1];
    expect(Math.hypot(last.x - hole.pin.x, last.y - hole.pin.y)).toBeLessThan(10);
  });
});
