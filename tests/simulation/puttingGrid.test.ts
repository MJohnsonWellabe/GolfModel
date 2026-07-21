import { afterEach, describe, expect, it } from 'vitest';
import { PX_PER_YARD, PHYSICS } from '../../src/config';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { ftToPx, golferWith, NO_WIND, openHole, PERFECT_SWING } from './simHelpers';

/**
 * PUTTING GRID — the exhaustive "perfect-perfect never blows past" proof
 * (polish-pass Phase 1). The prior `putting.test.ts` proves the FLAT and UPHILL
 * cases; this file closes the gap the owner flagged: DOWNHILL, LEFT/RIGHT BREAK,
 * and DIFFERENT GREEN SPEEDS, across the full 2–30 ft distance band.
 *
 * The shipped putt model (see PhysicsEngine roll loop + config PHYSICS):
 *   • the aim meter is a DUMB, FLAT model — power → flat-green distance, with NO
 *     hidden slope/break compensation. The player READS the slope (the true-rise
 *     readout / True Vision) and aims past (uphill) / short (downhill) / to the
 *     high side (break).
 *   • the physics carries a real, SYMMETRIC slope pace-cost (`puttSlopePaceBoost`)
 *     so the owner law "2 in of slope = 1 ft of pace" (aim ±6 ft per 1 ft of true
 *     rise/drop) holes the putt.
 *   • the cup only captures at ≤ `cupCaptureSpeed` (27 px/s); a hot putt LIPS OUT.
 *     So a HOLED putt is itself proof the ball arrived at dying pace — it did not
 *     blow past. Make-rate is therefore a direct "never blows past" measurement.
 *
 * "Perfect-perfect" = a perfect READ (aim the shipped read tool prescribes) + a
 * perfect-tempo stroke. The assertions below are non-tautological: for slopes we
 * apply the OWNER'S 6:1 rule (tied to the shipped readout, not fitted to the
 * engine); for break/speed we find the read by deterministic True-Vision
 * bisection and then assert it is DIRECTIONALLY correct + SYMMETRIC and that the
 * noisy distribution around it is centered and bounded (never well past).
 */

const putter = clubById('putter');
const golfer = golferWith(85);
// Mirror the game's putt power derivation (see putting.test.ts): power =
// aimDistPx / (effectiveCarry · PX_PER_YARD). Derived from the putter's actual
// baseDistance so it stays faithful.
const CARRY_PX = putter.baseDistance * (0.259 + (85 / 100) * 0.926) * 2;

// Slope direction on the openHole (ball fired from straight below the pin toward
// −y): uphill = +π/2, downhill = −π/2, break-right = 0, break-left = π. Verified
// against the true-rise readout sign in _probe (uphill readout < 0, downhill > 0).
const UPHILL = Math.PI / 2;
const DOWNHILL = -Math.PI / 2;
const BREAK_RIGHT = 0;
const BREAK_LEFT = Math.PI;

/** Authored slope strength so the true-rise readout shows `mag` ft over a
 *  `cupFt` putt (inverts readout = slopeAccel·strength·cupFt/slopeGradAccel). */
const strengthFor = (cupFt: number, mag: number): number =>
  (mag * PHYSICS.slopeGradAccel) / (PHYSICS.slopeAccel * cupFt);

type Scn = { cupFt: number; angle?: number; strength?: number; aimFt: number; yawOff?: number };

/** Fire one putt from straight below the pin. Returns holed, remaining ft from
 *  the cup, and signed "long" ft (+ = past the cup along the −y line). */
function firePutt(scn: Scn, preview: boolean, rng: () => number): { holed: boolean; remFt: number; longFt: number } {
  const hole = openHole({ slope: { angle: scn.angle ?? 0, strength: scn.strength ?? 0 } });
  const origin = { x: hole.pin.x, y: hole.pin.y + ftToPx(scn.cupFt) };
  const eng = new PhysicsEngine(hole, null, preview ? () => 0.5 : rng);
  const out = eng.simulate({
    origin,
    aimAngle: -Math.PI / 2 + (scn.yawOff ?? 0),
    swing: PERFECT_SWING(ftToPx(scn.aimFt) / CARRY_PX),
    club: putter, golfer, fireBoost: 0, lie: 'green', wind: NO_WIND, hole, preview
  });
  const dx = out.finalPos.x - hole.pin.x;
  const dy = out.finalPos.y - hole.pin.y;
  return {
    holed: out.holed,
    remFt: (Math.hypot(dx, dy) / PX_PER_YARD) * 3,
    longFt: ((hole.pin.y - out.finalPos.y) / PX_PER_YARD) * 3
  };
}

/** Monte-Carlo the noisy perfect-tempo distribution around a read. */
function stats(scn: Scn, n = 400, seed = 0) {
  const rng = mulberry32(4200 + seed);
  const longs: number[] = [];
  let holed = 0;
  for (let i = 0; i < n; i++) {
    const r = firePutt(scn, false, rng);
    if (r.holed) holed++;
    longs.push(r.longFt);
  }
  longs.sort((a, b) => a - b);
  const pct = (p: number) => longs[Math.min(n - 1, Math.floor(n * p))];
  return { makePct: (100 * holed) / n, medianLong: pct(0.5), p90Long: pct(0.9), maxLong: longs[n - 1] };
}

/** Smallest flat-aim distance whose noise-free (True-Vision) stroke just reaches
 *  the cup — the "dies-at-the-hole" read. */
function bisectAimFt(scn: Omit<Scn, 'aimFt'>): number {
  let lo = 0.5;
  let hi = scn.cupFt * 3.2;
  const det = mulberry32(1);
  for (let i = 0; i < 46; i++) {
    const mid = (lo + hi) / 2;
    const r = firePutt({ ...scn, aimFt: mid }, true, det);
    if (r.holed || r.longFt > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Yaw offset (rad) whose noise-free stroke centers the finish on the cup on a
 *  cross-sloped green. + = aim right, − = aim left. */
function bisectYaw(cupFt: number, angle: number, strength: number, aimFt: number): number {
  let lo = -0.6;
  let hi = 0.6;
  const det = mulberry32(1);
  for (let i = 0; i < 46; i++) {
    const mid = (lo + hi) / 2;
    const hole = openHole({ slope: { angle, strength } });
    const origin = { x: hole.pin.x, y: hole.pin.y + ftToPx(cupFt) };
    const out = new PhysicsEngine(hole, null, det).simulate({
      origin, aimAngle: -Math.PI / 2 + mid, swing: PERFECT_SWING(ftToPx(aimFt) / CARRY_PX),
      club: putter, golfer, fireBoost: 0, lie: 'green', wind: NO_WIND, hole, preview: true
    });
    const fx = out.holed ? hole.pin.x : out.finalPos.x;
    if (fx > hole.pin.x) hi = mid; // finished right → aim more left
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// FLAT — the dumb pin-aim baseline: a perfect stroke to the pin distance holes
// and never runs long, every distance 2–30 ft.
// ---------------------------------------------------------------------------
describe('putting grid — FLAT: perfect pin-aim holes and dies in, 2–30 ft', () => {
  for (const cupFt of [2, 3, 5, 8, 12, 18, 25, 30]) {
    it(`${cupFt} ft flat: high make rate, distribution not long`, () => {
      const s = stats({ cupFt, aimFt: cupFt });
      // Holed ⇒ arrived ≤ cupCaptureSpeed ⇒ did not blow past. The make rate
      // falls with distance but a perfect flat stroke is reliable.
      expect(s.makePct, `${cupFt}ft make ${s.makePct}%`).toBeGreaterThanOrEqual(cupFt <= 8 ? 88 : cupFt <= 18 ? 70 : 45);
      // Center of the perfect distribution sits AT the hole, never long.
      expect(s.medianLong, `${cupFt}ft median long ${s.medianLong.toFixed(2)}`).toBeLessThanOrEqual(1.0);
      // Even the long tail dies in — a perfect flat stroke never blows well past.
      expect(s.p90Long, `${cupFt}ft p90 long ${s.p90Long.toFixed(2)}`).toBeLessThanOrEqual(2.0);
    });
  }
});

// ---------------------------------------------------------------------------
// UPHILL — the owner's 6:1 law across the full grid: aim pin + 6·rise, holes and
// errs SHORT, never long. (Extends putting.test.ts to more distances × rises.)
// ---------------------------------------------------------------------------
describe('putting grid — UPHILL 6:1 law: holes, errs short, never long', () => {
  const grid: Array<[number, number]> = [
    [8, 0.5], [12, 0.75], [15, 1], [18, 1.5], [20, 1], [24, 2], [28, 2.5], [30, 3]
  ];
  for (const [cupFt, riseFt] of grid) {
    it(`${cupFt} ft / +${riseFt} ft rise (+${6 * riseFt} ft aim): holes, not long`, () => {
      const s = stats({ cupFt, angle: UPHILL, strength: strengthFor(cupFt, riseFt), aimFt: cupFt + 6 * riseFt });
      expect(s.makePct, `${cupFt}/${riseFt} make ${s.makePct}%`).toBeGreaterThanOrEqual(20);
      expect(s.medianLong, `${cupFt}/${riseFt} median ${s.medianLong.toFixed(2)}`).toBeLessThanOrEqual(1.5);
      expect(s.p90Long, `${cupFt}/${riseFt} p90 ${s.p90Long.toFixed(2)}`).toBeLessThanOrEqual(3.5);
    });
  }
  it('dumb pin-aim uphill comes up clearly SHORT (the read is required)', () => {
    const s = stats({ cupFt: 20, angle: UPHILL, strength: strengthFor(20, 1.5), aimFt: 20 });
    expect(s.medianLong).toBeLessThanOrEqual(-4);
    expect(s.makePct).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// DOWNHILL — the SYMMETRIC side of the owner law: aim pin − 6·drop, holes and
// dies in, NEVER blows well past. Plus proof the dumb pin-aim runs long (read
// required) but the runout is bounded, not a runaway.
// ---------------------------------------------------------------------------
describe('putting grid — DOWNHILL 6:1 law (symmetric): holes, never blows past', () => {
  // Keep 6·drop < cupFt so the aim-short read stays a positive, sensible target.
  const grid: Array<[number, number]> = [
    [15, 0.5], [18, 0.75], [20, 1], [24, 1.5], [28, 2], [30, 2]
  ];
  for (const [cupFt, dropFt] of grid) {
    it(`${cupFt} ft / −${dropFt} ft drop (${cupFt - 6 * dropFt} ft aim): holes, not past`, () => {
      const s = stats({ cupFt, angle: DOWNHILL, strength: strengthFor(cupFt, dropFt), aimFt: cupFt - 6 * dropFt });
      expect(s.makePct, `${cupFt}/${dropFt} make ${s.makePct}%`).toBeGreaterThanOrEqual(20);
      // Centered at the hole (dying in) and the long tail never blows well past.
      expect(Math.abs(s.medianLong), `${cupFt}/${dropFt} median ${s.medianLong.toFixed(2)}`).toBeLessThanOrEqual(1.5);
      expect(s.p90Long, `${cupFt}/${dropFt} p90 long ${s.p90Long.toFixed(2)}`).toBeLessThanOrEqual(3.5);
    });
  }
  it('dumb pin-aim downhill runs LONG (read required) but the runout is BOUNDED', () => {
    // Not reading a −1 ft/20 ft downhill runs the perfect stroke past — but it
    // over-runs by a bounded, recoverable amount, not a runaway off the green.
    const s = stats({ cupFt: 20, angle: DOWNHILL, strength: strengthFor(20, 1), aimFt: 20 });
    expect(s.medianLong, `median long ${s.medianLong.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    expect(s.maxLong, `max long ${s.maxLong.toFixed(2)}`).toBeLessThanOrEqual(16);
  });
});

// ---------------------------------------------------------------------------
// LEFT / RIGHT BREAK — the break physics is MIRROR-SYMMETRIC (a right-breaking
// green deflects a straight putt exactly as far right as a mirror left-breaking
// green deflects it left), the read is DIRECTIONALLY correct (aim to the high
// side), and the correct read holes the putt.
//
// The clean, non-brittle symmetry measure is the RAW lateral deflection of a
// straight putt (probe: |dx_right + dx_left| = 0 exactly). Yaw-magnitude
// equality is NOT used — the cup-capture snap makes the holing band converge to
// different yaws L↔R even when the underlying physics is identical.
// ---------------------------------------------------------------------------
describe('putting grid — BREAK: mirror-symmetric, read holes it', () => {
  /** Lateral finish offset (px, + = right of cup) of a straight-aimed putt. */
  function straightDeflectPx(cupFt: number, angle: number, strength: number, aimFt: number): number {
    const hole = openHole({ slope: { angle, strength } });
    const origin = { x: hole.pin.x, y: hole.pin.y + ftToPx(cupFt) };
    const out = new PhysicsEngine(hole, null, () => 0.5).simulate({
      origin, aimAngle: -Math.PI / 2, swing: PERFECT_SWING(ftToPx(aimFt) / CARRY_PX),
      club: putter, golfer, fireBoost: 0, lie: 'green', wind: NO_WIND, hole, preview: true
    });
    return out.finalPos.x - hole.pin.x;
  }

  for (const cupFt of [15, 18, 25]) {
    it(`${cupFt} ft: right/left break deflect EQUAL & OPPOSITE; straight putt breaks off the cup`, () => {
      const strength = strengthFor(cupFt, 1.2);
      const aimFt = cupFt + 2;
      const dxR = straightDeflectPx(cupFt, BREAK_RIGHT, strength, aimFt);
      const dxL = straightDeflectPx(cupFt, BREAK_LEFT, strength, aimFt);
      // Directional: a right-breaking green pushes the ball RIGHT of the cup (so
      // the player must aim LEFT); left-breaking pushes it LEFT.
      expect(dxR, `right-break dx ${dxR.toFixed(2)}`).toBeGreaterThan(1); // > 1px ≈ 1.5ft off line
      expect(dxL, `left-break dx ${dxL.toFixed(2)}`).toBeLessThan(-1);
      // Perfectly mirror-symmetric — the physics has no left/right bias.
      expect(Math.abs(dxR + dxL), `|dxR+dxL| ${Math.abs(dxR + dxL).toFixed(4)}px`).toBeLessThan(0.05);
    });
  }

  for (const cupFt of [18, 25]) {
    it(`${cupFt} ft: the correct high-side read holes the putt (both sides)`, () => {
      const strength = strengthFor(cupFt, 1.2);
      const aimFt = cupFt + 2;
      const yawR = bisectYaw(cupFt, BREAK_RIGHT, strength, aimFt); // breaks right → aim left (−)
      const yawL = bisectYaw(cupFt, BREAK_LEFT, strength, aimFt); // breaks left → aim right (+)
      expect(yawR, `right-break read yaw ${yawR.toFixed(3)} (aim left)`).toBeLessThan(0);
      expect(yawL, `left-break read yaw ${yawL.toFixed(3)} (aim right)`).toBeGreaterThan(0);
      const sr = stats({ cupFt, angle: BREAK_RIGHT, strength, aimFt, yawOff: yawR });
      const sl = stats({ cupFt, angle: BREAK_LEFT, strength, aimFt, yawOff: yawL });
      // Both sides' correct read holes at a good rate (dies in — holed ⇒ dying
      // pace). L↔R symmetry itself is proven exactly by the raw-deflection test
      // above (|dxR+dxL| < 0.05px); make-rate equality would only re-measure it
      // through the cup-snap-brittle bisected yaw, so it is intentionally not
      // asserted here.
      expect(sr.makePct, `right make ${sr.makePct}%`).toBeGreaterThanOrEqual(20);
      expect(sl.makePct, `left make ${sl.makePct}%`).toBeGreaterThanOrEqual(20);
    });
  }

  it('IGNORING the break (straight pin-aim) misses off the cup — the read is required', () => {
    const cupFt = 18;
    const strength = strengthFor(cupFt, 1.2);
    const r = firePutt({ cupFt, angle: BREAK_RIGHT, strength, aimFt: cupFt + 2, yawOff: 0 }, true, mulberry32(9));
    expect(r.holed, 'straight aim should NOT hole a breaking putt').toBe(false);
    expect(r.remFt, `remaining ${r.remFt.toFixed(1)}ft`).toBeGreaterThan(1.0);
  });
});

// ---------------------------------------------------------------------------
// GREEN SPEED — the model generalises across green speeds. Green speed is the
// global `PHYSICS.friction.green` (150 px/s²); we temporarily override it to a
// FAST (120) and SLOW (220) green and prove a perfect read still holes and dies
// in, with a directionally sensible read (faster green ⇒ less pace).
// ---------------------------------------------------------------------------
describe('putting grid — GREEN SPEED: perfect read holes and dies in, fast & slow', () => {
  const BASE = PHYSICS.friction.green;
  afterEach(() => { PHYSICS.friction.green = BASE; });

  for (const [label, fric] of [['fast', 120], ['medium', 150], ['slow', 220]] as const) {
    it(`${label} green (friction ${fric}): flat + uphill + downhill all hole, none blow past`, () => {
      PHYSICS.friction.green = fric;
      // Flat: a dying-pace read exists and holes.
      const flatAim = bisectAimFt({ cupFt: 20 });
      const sf = stats({ cupFt: 20, aimFt: flatAim });
      expect(sf.makePct, `${label} flat make ${sf.makePct}%`).toBeGreaterThanOrEqual(45);
      expect(sf.p90Long, `${label} flat p90 ${sf.p90Long.toFixed(2)}`).toBeLessThanOrEqual(2.5);

      // Uphill: a read past the pin holes and never runs long.
      const upStr = strengthFor(20, 1);
      const upAim = bisectAimFt({ cupFt: 20, angle: UPHILL, strength: upStr });
      expect(upAim, `${label} uphill aim ${upAim.toFixed(1)} should be past pin`).toBeGreaterThan(20);
      const su = stats({ cupFt: 20, angle: UPHILL, strength: upStr, aimFt: upAim });
      expect(su.makePct, `${label} uphill make ${su.makePct}%`).toBeGreaterThanOrEqual(30);
      expect(su.p90Long, `${label} uphill p90 ${su.p90Long.toFixed(2)}`).toBeLessThanOrEqual(3.5);

      // Downhill: a read short of the pin holes and never blows past.
      const dnStr = strengthFor(20, 1);
      const dnAim = bisectAimFt({ cupFt: 20, angle: DOWNHILL, strength: dnStr });
      expect(dnAim, `${label} downhill aim ${dnAim.toFixed(1)} should be short of pin`).toBeLessThan(20);
      const sd = stats({ cupFt: 20, angle: DOWNHILL, strength: dnStr, aimFt: dnAim });
      expect(sd.makePct, `${label} downhill make ${sd.makePct}%`).toBeGreaterThanOrEqual(30);
      expect(sd.p90Long, `${label} downhill p90 ${sd.p90Long.toFixed(2)}`).toBeLessThanOrEqual(3.5);
    });
  }

  it('putt DISTANCE is green-speed invariant (WYSIWYG aim: v0 back-solved from friction)', () => {
    // The launch speed is solved so the ball stops at the aimed distance on the
    // friction it will actually roll through (PhysicsEngine putter branch:
    // v0 = √(2·mu·carryPx)). So the SAME aim finishes at the hole on a fast or a
    // slow green — green speed changes feel/roll-time (and thus break), never the
    // straight-putt distance. This asserts that deliberate design guarantee.
    for (const f of [110, 150, 220]) {
      PHYSICS.friction.green = f;
      const r = firePutt({ cupFt: 20, aimFt: 20 }, true, mulberry32(1));
      expect(Math.abs(r.longFt), `friction ${f}: flat 20ft finish ${r.longFt.toFixed(2)}ft off pin`).toBeLessThanOrEqual(0.5);
      expect(r.holed, `friction ${f}: flat 20ft pin-aim holes`).toBe(true);
    }
  });
});
