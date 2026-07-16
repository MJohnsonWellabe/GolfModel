import { describe, expect, it } from 'vitest';
import { PX_PER_YARD } from '../../src/config';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { buildHeightField } from '../../src/systems/HeightField';
import { clubById } from '../../src/data/clubs';
import { golferWith, NO_WIND, PERFECT_SWING } from './simHelpers';
import portjohnson from '../../src/data/courses/portjohnson.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { AimControl } from '../../src/core/input/AimControl';

/**
 * Regression guard for the reported "perfect ~78yd wedge finishes ~20ft long".
 *
 * Wired exactly like the real game (main.ts:496-502): the aim/power targeting
 * runs on the FLAT previewEngine (slope zeroed, null heightfield) while the shot
 * itself is resolved on the real, terrain-aware engine (buildHeightField). An
 * earlier build overshot because the perfect-swing power sent the ball too far;
 * the latest tuning brought a perfect approach back on target. This locks that in
 * so a future change can't reintroduce a big overshoot (or a big come-up-short)
 * on a full scoring swing.
 */
describe('approach distance — a perfect full wedge finishes on target (real wiring)', () => {
  const course = loadCourse(portjohnson as unknown as CourseAuthoring);
  const pj3 = course.holes[2];
  const golfer = golferWith(90);

  function perfectApproach(targetYds: number, clubId: string) {
    // engine2d: real terrain. previewEngine: flat, exactly the game's wiring.
    const engine2d = new PhysicsEngine(pj3, buildHeightField(pj3, 1), () => 0.5);
    const previewEngine = new PhysicsEngine(
      { ...pj3, slope: { angle: 0, strength: 0 } },
      null,
      () => 0.5
    );
    const aim = new AimControl(pj3, previewEngine);
    aim.setClubById(clubId);
    const ball = { x: pj3.pin.x, y: pj3.pin.y + targetYds * PX_PER_YARD };
    aim.yaw = Math.atan2(pj3.pin.y - ball.y, pj3.pin.x - ball.x);
    aim.distPx = targetYds * PX_PER_YARD;
    const ctx = { ball, lie: 'fairway' as const, golfer, fireBoost: 0, strokes: 2 };
    const power = aim.barToPhysicsPower(aim.barPowerTarget(ctx), ctx);
    const out = engine2d.simulate({
      origin: ball,
      aimAngle: aim.yaw,
      swing: PERFECT_SWING(power),
      club: clubById(clubId),
      golfer,
      fireBoost: 0,
      lie: 'fairway',
      wind: NO_WIND,
      hole: pj3
    });
    const stopYds = Math.hypot(out.finalPos.x - ball.x, out.finalPos.y - ball.y) / PX_PER_YARD;
    const remainFt = (Math.hypot(out.finalPos.x - pj3.pin.x, out.finalPos.y - pj3.pin.y) / PX_PER_YARD) * 3;
    return { stopYds, remainFt };
  }

  it('a ~78yd SW approach aimed at the pin does not finish long (the reported bug)', () => {
    const { stopYds, remainFt } = perfectApproach(78, 'sw');
    // Must not sail ~20ft (≈6.7yd) past the target the way the old build did.
    expect(stopYds, `stop=${stopYds.toFixed(1)}yd`).toBeLessThanOrEqual(80.5);
    // And it should still be a genuinely good shot — close to the flag.
    expect(remainFt, `remain=${remainFt.toFixed(1)}ft`).toBeLessThan(15);
  });

  it('a mid-range ~120yd 9i approach also finishes near the flag', () => {
    const { remainFt } = perfectApproach(120, '9i');
    expect(remainFt, `remain=${remainFt.toFixed(1)}ft`).toBeLessThan(24);
  });
});
