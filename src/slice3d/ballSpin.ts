/**
 * BALL SPIN — the visual only.
 *
 * Owner: "how hard would it be to make the ball look like it's back spinning in
 * the air? right now it's static which is noticable on the new balls that have
 * designs on them."
 *
 * A white ball hid the fact that the ball has never rotated at all. An ink
 * wash, an alignment stripe or a drip does not — and neither does the ground,
 * where the camera sits closest and a sliding ball reads worst of all. So this
 * covers flight, rollout and putts.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS DRIVEN BY DISTANCE TRAVELLED, NOT BY ELAPSED TIME
 *
 * Flight playback is slow-motion and the factor changes constantly — 0.26x in
 * the air, 0.45x on a rollout, 0.32x on a green, 0.8x on a putt (FLIGHT.*
 * timescales in config.ts) — and a skip or `settleFlight()` can step the entire
 * remaining path in ONE frame.
 *
 * Rotating by elapsed time fights all of that: the ball would blur while
 * visibly drifting in slow motion, and a skip would spin it through a thousand
 * revolutions. Rotating by GROUND COVERED is immune, because it is tied to the
 * motion the player actually sees. It also makes the rolling case physically
 * exact for free — a rolling ball turns once per circumference, which is the
 * whole of `rollStep` below.
 *
 * ---------------------------------------------------------------------------
 * THE ALIASING CHEAT, STATED PLAINLY
 *
 * Real backspin is 2,000-10,000 rpm — 33 to 167 revolutions per SECOND. At
 * 60fps every one of those aliases: the pattern would strobe, freeze, or run
 * visibly backwards (the wagon-wheel effect). A truthful spin rate would look
 * broken.
 *
 * So the per-frame angular step is capped at `MAX_STEP_RAD`. That is a
 * deliberate departure from the physical number, and it is expressed per FRAME
 * rather than per second because aliasing is a sampling problem: what matters
 * is how far the ball turns between two rendered images, whatever the frame
 * rate. A twelfth of a turn per frame is unmistakably fast and can never
 * reverse.
 *
 * ---------------------------------------------------------------------------
 * PURE. No Babylon, no clock, no randomness — see the note on determinism in
 * the caller. Vectors are plain objects in BABYLON space (x right, y up,
 * z into the screen); the caller converts.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** One frame's rotation: an axis to turn about and how far. A null axis means
 *  "nothing moved" — the caller leaves the orientation alone. */
export interface SpinStep {
  axis: Vec3 | null;
  radians: number;
}

const NO_SPIN: SpinStep = { axis: null, radians: 0 };

/**
 * The most a ball may turn between two rendered frames.
 *
 * Derived, not guessed. Aliasing is Nyquist: a pattern with n-fold rotational
 * symmetry about the spin axis repeats every 2π/n, so it starts to alias at
 * half of that — π/n per frame. The two ball designs that matter here:
 *
 *   - ink wash / drip: asymmetric, n = 1 → aliases at π
 *   - alignment stripe / cavity band tumbling end over end: n = 2 → aliases
 *     at π/2, and it is the tighter of the two, so it sets the bound
 *
 * π/3 sits at two thirds of that worst case: a sixth of a revolution per
 * frame, 10 rev/s at 60fps, which reads as genuinely fast and cannot reverse.
 *
 * It is deliberately NOT tighter than this. An earlier π/6 was clamping
 * ordinary rollouts rather than absurd ones — the ball under-rotated through
 * most of every roll, which is the same "sliding ball" the whole change exists
 * to fix. The cap is a safety net for a skipped frame, not a rate limiter for
 * normal play.
 */
export const MAX_STEP_RAD = Math.PI / 3;

/**
 * Revolutions per world unit of flight for a ball with NO club spin and no
 * player spin. Tuned for the look rather than derived: a driver should turn
 * lazily over a long carry, and this is the floor it turns at.
 */
const AIR_REVS_PER_UNIT_BASE = 0.006;
/** How much a high-spin club adds on top of the base. A sand wedge (spin 0.85)
 *  tumbles about four times as hard as a driver (0.15). */
const AIR_REVS_PER_UNIT_SPIN = 0.030;
/** How far shot shape tilts the spin axis toward the direction of travel. A
 *  full fade visibly spins on a cant rather than tumbling end over end. */
const SIDE_TILT = 0.6;

const len = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);

const norm = (v: Vec3): Vec3 | null => {
  const l = len(v);
  if (!(l > 1e-9)) return null;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});

/**
 * The axis a ball rolling or spinning along `travel` turns about: horizontal,
 * square to the direction of travel. Returns null when travel is vertical or
 * zero, where no such axis exists — a straight-down drop has no roll.
 *
 * Positive rotation about this axis carries the TOP of the ball forward, which
 * is a forward roll. Backspin is therefore the same axis with a negative
 * angle, which is exactly how `airStep` signs it.
 */
export function spinAxis(travel: Vec3, sideSpin = 0): Vec3 | null {
  const horizontal = norm({ x: travel.x, y: 0, z: travel.z });
  if (!horizontal) return null; // straight up or down: no rolling axis exists
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  const axis = cross(up, horizontal);
  if (!sideSpin) return norm(axis);
  // Shot shape cants the axis toward the line of flight. Clamped because the
  // spin channel can run past ±1 and a fully-tilted axis would spin the ball
  // like a rifled bullet, which is not what a sliced golf ball does.
  const t = Math.max(-1, Math.min(1, sideSpin)) * SIDE_TILT;
  return norm({
    x: axis.x + horizontal.x * t,
    y: axis.y + horizontal.y * t,
    z: axis.z + horizontal.z * t
  });
}

/** Clamp a step into the readable band, preserving its direction. */
const capped = (radians: number): number =>
  Math.max(-MAX_STEP_RAD, Math.min(MAX_STEP_RAD, radians));

/**
 * A ball ROLLING on the ground — putts and rollouts.
 *
 * Physically exact and free: a ball in rolling contact turns through
 * `distance / radius` radians, so a stripe makes exactly one revolution per
 * circumference travelled. The cap can still bite on a fast rollout, and when
 * it does, preventing a strobe is worth more than the last of the accuracy.
 */
export function rollStep(travel: Vec3, ballDiameter: number): SpinStep {
  const axis = spinAxis(travel);
  const radius = ballDiameter / 2;
  if (!axis || !(radius > 0)) return NO_SPIN;
  // Only ground distance rolls the ball; a bounce's rise does not.
  const distance = Math.hypot(travel.x, travel.z);
  return { axis, radians: capped(distance / radius) };
}

/**
 * A ball in the AIR.
 *
 * `clubSpin` is ClubSpec.spin (0.15 driver .. 0.85 sand wedge), `spinEff` the
 * club-family × lie authority, and `topSpin` the live player spin where
 * NEGATIVE means backspin. There is no rev/min anywhere in the physics to read
 * — the flight model's lift coefficient is spin-independent — so this is a
 * derived look, not a measurement.
 */
export function airStep(
  travel: Vec3,
  opts: { clubSpin?: number; spinEff?: number; topSpin?: number; sideSpin?: number } = {}
): SpinStep {
  const axis = spinAxis(travel, opts.sideSpin ?? 0);
  if (!axis) return NO_SPIN;
  const clubSpin = Math.max(0, Math.min(1, opts.clubSpin ?? 0.5));
  const spinEff = Math.max(0, Math.min(1, opts.spinEff ?? 1));
  // Backspin is the default state of a struck golf ball; topspin only cuts it
  // back. `topSpin` is negative for backspin, so a positive value here reduces
  // the tumble and a strong enough one can flip it to a forward roll — which
  // is what a topped shot looks like.
  const shaped = 1 + Math.max(-1, Math.min(1, opts.topSpin ?? 0)) * -1;
  const revsPerUnit = (AIR_REVS_PER_UNIT_BASE + AIR_REVS_PER_UNIT_SPIN * clubSpin * spinEff) * shaped;
  const distance = len(travel);
  // NEGATIVE: backspin carries the top of the ball against the flight.
  return { axis, radians: capped(-distance * revsPerUnit * Math.PI * 2) };
}

/**
 * One frame of ball rotation, air or ground.
 *
 * `travel` is the movement since the previous frame in Babylon space. Airborne
 * is the caller's read of the trajectory's height, not a guess from `travel.y`
 * — a ball at the top of its arc is moving flat but is still very much in the
 * air.
 */
export function ballSpinStep(
  travel: Vec3,
  airborne: boolean,
  ballDiameter: number,
  opts: { clubSpin?: number; spinEff?: number; topSpin?: number; sideSpin?: number } = {}
): SpinStep {
  if (!Number.isFinite(travel.x) || !Number.isFinite(travel.y) || !Number.isFinite(travel.z)) return NO_SPIN;
  return airborne ? airStep(travel, opts) : rollStep(travel, ballDiameter);
}
