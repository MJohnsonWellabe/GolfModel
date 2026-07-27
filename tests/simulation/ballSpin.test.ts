import { describe, expect, it } from 'vitest';
import { airStep, ballSpinStep, MAX_STEP_RAD, rollStep, spinAxis } from '../../src/slice3d/ballSpin';

/**
 * BALL SPIN (owner: "how hard would it be to make the ball look like it's back
 * spinning in the air? right now it's static which is noticable on the new
 * balls that have designs on them").
 *
 * The load-bearing properties are: the ball turns about the right axis, a
 * rolling ball is physically exact, and NOTHING can ever push the per-frame
 * step far enough to alias — because an aliased spin looks worse than no spin
 * at all, and it is the one failure a screenshot could never catch.
 */

/** Babylon space: x right, y up, z into the screen. */
const along = (x: number, y = 0, z = 0): { x: number; y: number; z: number } => ({ x, y, z });
const BALL = 1.0; // diameter, matching MeshBuilder.CreateSphere in main.ts

describe('the axis a ball turns about', () => {
  it('is horizontal and square to the direction of travel', () => {
    const axis = spinAxis(along(10, 4, 0))!; // travelling +x, climbing
    expect(axis).not.toBeNull();
    expect(axis.y).toBeCloseTo(0, 6); // horizontal: no vertical component
    // Square to the ground track (+x), so it points along z.
    expect(Math.abs(axis.z)).toBeCloseTo(1, 6);
    expect(axis.x).toBeCloseTo(0, 6);
  });

  it('follows the shot around — it is not a fixed world axis', () => {
    const east = spinAxis(along(10, 0, 0))!;
    const north = spinAxis(along(0, 0, 10))!;
    const dot = east.x * north.x + east.y * north.y + east.z * north.z;
    expect(Math.abs(dot), 'a 90° change of direction must turn the axis 90°').toBeCloseTo(0, 6);
  });

  it('is a unit vector, so the angle alone decides how far the ball turns', () => {
    const a = spinAxis(along(3, -7, 2))!;
    expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(1, 6);
  });

  it('cants toward the line of flight under shot shape', () => {
    const straight = spinAxis(along(10, 0, 0))!;
    const faded = spinAxis(along(10, 0, 0), 1)!;
    const dot = straight.x * faded.x + straight.y * faded.y + straight.z * faded.z;
    expect(dot, 'a full fade must visibly tilt the axis').toBeLessThan(0.95);
    expect(Math.hypot(faded.x, faded.y, faded.z), 'still a unit axis').toBeCloseTo(1, 6);
  });

  it('does not exist for a ball going straight down, and says so', () => {
    // A vertical drop has no rolling axis. Returning a bogus one would put a
    // NaN through the mesh transform and blank the ball.
    expect(spinAxis(along(0, -10, 0))).toBeNull();
    expect(spinAxis(along(0, 0, 0))).toBeNull();
  });
});

describe('a rolling ball', () => {
  it('turns once per circumference — real rolling contact', () => {
    const circumference = Math.PI * BALL;
    // Roll exactly one circumference in ten equal steps and total the turn.
    let total = 0;
    for (let i = 0; i < 10; i++) total += rollStep(along(circumference / 10), BALL).radians;
    expect(total, 'one circumference must be exactly one revolution').toBeCloseTo(Math.PI * 2, 6);
  });

  it('rolls FORWARD, not backward', () => {
    // Positive rotation about spinAxis carries the top of the ball with the
    // travel. A putt that span backwards would be glaring.
    expect(rollStep(along(0.1), BALL).radians).toBeGreaterThan(0);
  });

  it('ignores the vertical part of a bounce — only ground contact rolls it', () => {
    const flat = rollStep(along(0.1, 0, 0), BALL).radians;
    const rising = rollStep(along(0.1, 5, 0), BALL).radians;
    expect(rising).toBeCloseTo(flat, 9);
  });

  it('stands still when the ball does', () => {
    expect(rollStep(along(0, 0, 0), BALL)).toEqual({ axis: null, radians: 0 });
  });
});

describe('a ball in the air', () => {
  it('spins BACKWARD — the top turns against the flight', () => {
    expect(airStep(along(5), { clubSpin: 0.5 }).radians).toBeLessThan(0);
  });

  it('tumbles harder off a wedge than off a driver', () => {
    const driver = Math.abs(airStep(along(5), { clubSpin: 0.15 }).radians);
    const wedge = Math.abs(airStep(along(5), { clubSpin: 0.85 }).radians);
    expect(wedge).toBeGreaterThan(driver);
  });

  it('turns further over more ground', () => {
    const near = Math.abs(airStep(along(1), { clubSpin: 0.4 }).radians);
    const far = Math.abs(airStep(along(4), { clubSpin: 0.4 }).radians);
    expect(far).toBeGreaterThan(near);
  });

  it('is muted by a lie that kills spin', () => {
    const clean = Math.abs(airStep(along(5), { clubSpin: 0.8, spinEff: 1 }).radians);
    const buried = Math.abs(airStep(along(5), { clubSpin: 0.8, spinEff: 0.1 }).radians);
    expect(buried).toBeLessThan(clean);
  });

  it('flips to a forward roll on a topped shot', () => {
    // topSpin is positive for topspin; enough of it should out-argue the
    // backspin a struck ball carries by default.
    expect(airStep(along(5), { clubSpin: 0.3, topSpin: 1 }).radians).toBeGreaterThanOrEqual(0);
  });
});

describe('it can never alias — the property that matters most', () => {
  const absurd = [1e3, 1e6, 1e9];

  it('caps the air step however far the ball moves in one frame', () => {
    for (const d of absurd) {
      const step = airStep(along(d), { clubSpin: 1, spinEff: 1, topSpin: -1 });
      expect(Math.abs(step.radians), `${d} units in one frame`).toBeLessThanOrEqual(MAX_STEP_RAD);
    }
  });

  it('caps the roll step too — a skip can hand it the whole rollout at once', () => {
    for (const d of absurd) {
      expect(Math.abs(rollStep(along(d), BALL).radians)).toBeLessThanOrEqual(MAX_STEP_RAD);
    }
  });

  it('caps a ball smaller than any sane radius rather than dividing to infinity', () => {
    expect(Math.abs(rollStep(along(1), 1e-6).radians)).toBeLessThanOrEqual(MAX_STEP_RAD);
  });

  it('sits inside the Nyquist bound of the tightest ball pattern', () => {
    // A tumbling alignment stripe is 2-fold symmetric, so it aliases at π/2 per
    // frame — tighter than the asymmetric ink wash at π. The cap must be
    // comfortably inside that, not merely under it.
    expect(MAX_STEP_RAD).toBeLessThan(Math.PI / 2);
    expect(MAX_STEP_RAD / (Math.PI / 2), 'leave real margin under the bound').toBeLessThanOrEqual(0.7);
  });

  it('leaves ordinary rolling alone — the cap is a safety net, not a governor', () => {
    // The regression that made this explicit: at π/6 the cap clamped normal
    // rollouts, so the ball under-rotated through most of every roll — the
    // same sliding look the whole change exists to remove. A ball crossing a
    // tenth of its own circumference in one frame is unremarkable and must
    // come through the model untouched.
    const modest = (Math.PI * BALL) / 10;
    const step = rollStep(along(modest), BALL);
    expect(Math.abs(step.radians)).toBeLessThan(MAX_STEP_RAD);
    expect(step.radians, 'and it must still be exact').toBeCloseTo(modest / (BALL / 2), 9);
  });
});

describe('nothing it is handed can produce a broken transform', () => {
  it('survives NaN and Infinity without emitting one', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const step = ballSpinStep(along(bad, bad, bad), true, BALL, { clubSpin: 0.5 });
      expect(step.axis, `travel of ${bad}`).toBeNull();
      expect(Number.isFinite(step.radians)).toBe(true);
    }
  });

  it('always returns a finite angle and a unit axis, over a wide sweep', () => {
    for (const airborne of [true, false]) {
      for (let i = 0; i < 200; i++) {
        // Deterministic sweep — no RNG anywhere near the ball (shotRng is the
        // physics stream the replay re-derives).
        const t = along(Math.sin(i) * i, Math.cos(i * 0.7) * i, Math.sin(i * 1.3) * i);
        const step = ballSpinStep(t, airborne, BALL, { clubSpin: (i % 10) / 10, topSpin: (i % 5) - 2 });
        expect(Number.isFinite(step.radians)).toBe(true);
        expect(Math.abs(step.radians)).toBeLessThanOrEqual(MAX_STEP_RAD);
        if (step.axis) expect(Math.hypot(step.axis.x, step.axis.y, step.axis.z)).toBeCloseTo(1, 6);
      }
    }
  });

  it('routes air and ground to different models', () => {
    const t = along(0.4, 0, 0);
    expect(ballSpinStep(t, false, BALL).radians).toBe(rollStep(t, BALL).radians);
    expect(ballSpinStep(t, true, BALL, { clubSpin: 0.5 }).radians).toBe(airStep(t, { clubSpin: 0.5 }).radians);
  });
});
