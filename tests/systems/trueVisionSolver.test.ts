import { describe, expect, it } from 'vitest';
import { PHYSICS, PX_PER_YARD } from '../../src/config';
import { effectiveCarryYards, PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { solveTrueVisionPath } from '../../src/systems/TrueVisionSolver';
import { clubById } from '../../src/data/clubs';
import { angleTo } from '../../src/utils/Geometry';
import { golferWith, ftToPx, openHole } from '../simulation/simHelpers';

const golfer = golferWith(85);
const putter = clubById('putter');
// Mirrors the solver's own pace convention: power = pinDist / maxCarryPx.
const MAX_CARRY_PX = effectiveCarryYards(putter, golfer, 0, 'green') * PX_PER_YARD;

function distFromPin(path: ReturnType<typeof solveTrueVisionPath>, pin: { x: number; y: number }): number {
  const last = path[path.length - 1];
  return Math.hypot(last.x - pin.x, last.y - pin.y);
}

/** Initial aim direction implied by the first two points of a solved path. */
function initialAngle(path: ReturnType<typeof solveTrueVisionPath>): number {
  return angleTo(path[0], path[1]);
}

/** A perfect straight-at-pin putt on `engine`'s hole, using the solver's own
 *  pace convention — the control case each curved-slope test compares against. */
function straightPutt(engine: PhysicsEngine, hole: ReturnType<typeof openHole>, ball: { x: number; y: number }) {
  const pinDistPx = Math.hypot(hole.pin.x - ball.x, hole.pin.y - ball.y);
  return engine.simulate({
    origin: ball,
    aimAngle: angleTo(ball, hole.pin),
    swing: { power: pinDistPx / MAX_CARRY_PX, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
    club: putter,
    golfer,
    fireBoost: 0,
    lie: 'green',
    wind: { angle: 0, speed: 0 },
    hole,
    preview: true
  });
}

describe('True Vision solver', () => {
  it('flat green: straight-at-pin already holes, no correction needed', () => {
    const hole = openHole();
    const ball = { x: hole.pin.x, y: hole.pin.y + ftToPx(15) };
    const engine = new PhysicsEngine(hole);
    const path = solveTrueVisionPath(engine, hole, ball, golfer);
    expect(distFromPin(path, hole.pin)).toBeLessThanOrEqual(PHYSICS.cupRadius);
    // Aims essentially straight at the pin (no slope to correct for).
    const base = angleTo(ball, hole.pin);
    expect(Math.abs(initialAngle(path) - base)).toBeLessThan(0.01);
  });

  it('a sloped green that would curve a naive straight putt wide: the solved aim still holes out', () => {
    // Lateral break: the slope pushes +x while the ball rolls straight north
    // toward the pin, so a straight-aimed putt drifts wide of the cup.
    const hole = openHole({ slope: { angle: 0, strength: 0.6 } });
    const ball = { x: hole.pin.x, y: hole.pin.y + ftToPx(20) };
    const engine = new PhysicsEngine(hole);

    // Control: confirm a straight-at-pin putt on this slope actually misses,
    // so the test is exercising real curvature, not a no-op green.
    const straightOut = straightPutt(engine, hole, ball);
    expect(straightOut.holed, 'sanity: straight aim should miss on this slope').toBe(false);

    const path = solveTrueVisionPath(engine, hole, ball, golfer);
    expect(distFromPin(path, hole.pin)).toBeLessThanOrEqual(PHYSICS.cupRadius);
    // The solved aim actually corrects for the break (not just coincidentally straight).
    const base = angleTo(ball, hole.pin);
    expect(Math.abs(initialAngle(path) - base)).toBeGreaterThan(0.01);
  });

  it('is deterministic: identical inputs produce an identical path', () => {
    const hole = openHole({ slope: { angle: 0.4, strength: 0.5 } });
    const ball = { x: hole.pin.x, y: hole.pin.y + ftToPx(25) };
    const path1 = solveTrueVisionPath(new PhysicsEngine(hole), hole, ball, golfer);
    const path2 = solveTrueVisionPath(new PhysicsEngine(hole), hole, ball, golfer);
    expect(path1).toEqual(path2);
  });

  it('a pathological slope with no exact solve in the search cone still returns a non-empty path, at least as close as the naive straight aim', () => {
    // An extreme, whole-green lateral slope: no angle within ±30° of straight
    // can out-curve it to actually drop the putt.
    const hole = openHole({ slope: { angle: 0, strength: 6 } });
    const ball = { x: hole.pin.x, y: hole.pin.y + ftToPx(30) };
    const engine = new PhysicsEngine(hole);

    const straightOut = straightPutt(engine, hole, ball);
    const straightDist = Math.hypot(
      straightOut.finalPos.x - hole.pin.x,
      straightOut.finalPos.y - hole.pin.y
    );

    const path = solveTrueVisionPath(engine, hole, ball, golfer);
    expect(path.length).toBeGreaterThan(0);
    expect(distFromPin(path, hole.pin)).toBeLessThanOrEqual(straightDist + 1e-6);
  });
});
