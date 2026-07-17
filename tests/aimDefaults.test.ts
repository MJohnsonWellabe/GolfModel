import { describe, expect, it } from 'vitest';
import { AimControl, ShotContext } from '../src/core/input/AimControl';
import { PhysicsEngine } from '../src/systems/PhysicsEngine';
import { buildHeightField } from '../src/systems/HeightField';
import { CourseAuthoring, loadCourse } from '../src/data/courseLoader';
import { Golfer, HoleData, Point, Surface } from '../src/core/types';
import { angleTo, dist } from '../src/utils/Geometry';
import portjohnson from '../src/data/courses/portjohnson.json';
import sablebay from '../src/data/courses/sablebay.json';
import timberline from '../src/data/courses/timberline.json';
import wildwood from '../src/data/courses/wildwood.json';

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

/** The surface under the DEFAULT aim point for a shot from `ball`, exactly as
 *  the game arms it (auto club, then resetAim). */
function defaultAimSurface(hole: HoleData, ball: Point, lie: Surface, strokes: number): Surface {
  const engine = new PhysicsEngine(hole, buildHeightField(hole));
  const aim = new AimControl(hole, engine);
  const ctx: ShotContext = { ball, lie, golfer: GOLFER, fireBoost: 0, strokes };
  aim.autoSelectClub(ctx);
  aim.resetAim(ctx);
  const p = aim.aimPoint(ball);
  return engine.surfaceAt(p.x, p.y);
}

/**
 * Regression sweep: the default aim must never park the aim marker in water —
 * neither off the tee (Port Johnson 3 used to aim a full driver carry past the
 * dogleg elbow into the lake) nor from the fairway lay-up spots.
 */
describe('default aim never points into water', () => {
  const courses = [portjohnson, sablebay, timberline, wildwood].map((c) =>
    loadCourse(c as unknown as CourseAuthoring)
  );
  for (const course of courses) {
    for (const h of course.holes) {
      it(`${course.name} hole ${h.number}: tee shot aims dry`, () => {
        expect(defaultAimSurface(h, h.tee, 'tee', 0)).not.toBe('water');
      });

      it(`${course.name} hole ${h.number}: fairway shots aim dry`, () => {
        for (const t of h.aiTargets ?? []) {
          expect(defaultAimSurface(h, t, 'fairway', 1)).not.toBe('water');
        }
      });
    }
  }
});

const ELITE: Golfer = {
  ...GOLFER,
  stats: { drivingPower: 100, drivingAccuracy: 100, approach: 100, chipping: 100, putting: 100 }
};

function defaultAim(hole: HoleData, ball: Point, lie: Surface, strokes: number, golfer: Golfer = GOLFER): Point {
  const engine = new PhysicsEngine(hole, buildHeightField(hole));
  const aim = new AimControl(hole, engine);
  const ctx: ShotContext = { ball, lie, golfer, fireBoost: 0, strokes };
  aim.autoSelectClub(ctx);
  aim.resetAim(ctx);
  return aim.aimPoint(ball);
}

describe('default aim strategic intent', () => {
  const sable = loadCourse(sablebay as unknown as CourseAuthoring);
  const timber = loadCourse(timberline as unknown as CourseAuthoring);
  const wild = loadCourse(wildwood as unknown as CourseAuthoring);

  it('par 3 tee shots aim near the flag when the green is reachable', () => {
    const h = sable.holes.find((x) => x.par === 3)!;
    expect(dist(defaultAim(h, h.tee, 'tee', 0, ELITE), h.pin)).toBeLessThan(8);
  });

  it('par 4 tee shots aim near a practical strategic landing area rather than stopping short', () => {
    const h = wild.holes.find((x) => x.par === 4)!;
    const p = defaultAim(h, h.tee, 'tee', 0, ELITE);
    const targetDists = (h.aiTargets ?? []).map((t) => dist(p, t));
    expect(Math.min(...targetDists)).toBeLessThan(35);
    expect(dist(h.tee, p)).toBeGreaterThan(300);
  });

  it('par 5 tee shots lay a full carry out down an authored strategic corridor', () => {
    // A4 change of behavior: an ELITE driver no longer clubs DOWN to the nearest
    // lay-up waypoint — it lays a FULL carry out down the corridor, using the
    // player's length. So the aim POINT legitimately overshoots the near elbow
    // (here ~58px past it) instead of landing on it. What must still hold: the
    // aim points straight down an authored ROUTE line (its bearing matches a
    // waypoint's to within ~3.5°) and lands on dry, in-play ground.
    const h = timber.holes.find((x) => x.par === 5)!;
    const p = defaultAim(h, h.tee, 'tee', 0, ELITE);
    const aimBearing = angleTo(h.tee, p);
    const minBearingErr = Math.min(
      ...(h.aiTargets ?? []).map((t) => Math.abs(angleTo(h.tee, t) - aimBearing))
    );
    expect(minBearingErr, `bearing err ${minBearingErr.toFixed(3)}rad`).toBeLessThan(0.06);
    expect(dist(h.tee, p)).toBeGreaterThan(300);
    const engine = new PhysicsEngine(h, buildHeightField(h));
    expect(engine.surfaceAt(p.x, p.y)).not.toBe('water');
  });

  it('Wildwood 3 (The Long Meadow): an elite driver lays a FULL carry down the T0 corridor, dry', () => {
    // A4 regression. T0 sits ~255yd out and a drivingPower-100 driver carries
    // ~288yd. resetAim used to CAP the tee aim at T0 via min(dist(ball,pick),
    // maxCarry), clubbing the driver down ~33yd. It now arms the club's FULL
    // carry straight down the T0 corridor and lands on dry fairway.
    const h = wild.holes.find((x) => x.number === 3)!;
    const engine = new PhysicsEngine(h, buildHeightField(h));
    const aim = new AimControl(h, engine);
    const ctx: ShotContext = { ball: h.tee, lie: 'tee', golfer: ELITE, fireBoost: 0, strokes: 0 };
    aim.autoSelectClub(ctx);
    aim.resetAim(ctx);
    const maxCarry = aim.maxCarryPx(ctx);
    const p = aim.aimPoint(h.tee);
    expect(aim.club.id).toBe('driver');
    // Armed at the club's full carry — NOT capped at the ~255yd T0 waypoint.
    expect(
      aim.distPx,
      `distPx=${aim.distPx.toFixed(1)} maxCarry=${maxCarry.toFixed(1)}`
    ).toBeGreaterThanOrEqual(maxCarry - 0.01);
    // Aimed straight down the T0 corridor and lands dry.
    const t0 = h.aiTargets![0];
    expect(Math.abs(angleTo(h.tee, t0) - aim.yaw), 'aimed down the T0 line').toBeLessThan(0.06);
    expect(engine.surfaceAt(p.x, p.y)).not.toBe('water');
  });

  it('reachable approaches aim at the flag', () => {
    const h = timber.holes.find((x) => x.par === 4)!;
    const ball = h.aiTargets?.[h.aiTargets.length - 1] ?? h.tee;
    expect(dist(defaultAim(h, ball, 'fairway', 1, ELITE), h.pin)).toBeLessThan(8);
  });

  it('unreachable approaches keep aiming to a strategic landing area', () => {
    const h = wild.holes.find((x) => x.par === 5)!;
    const ball = h.aiTargets![0];
    const p = defaultAim(h, ball, 'fairway', 1, GOLFER);
    expect(dist(p, h.pin)).toBeGreaterThan(80);
    expect(Math.min(...h.aiTargets!.slice(1).map((t) => dist(p, t)))).toBeLessThan(80);
  });
});

describe('default aim complete setup path with ordinary golfer', () => {
  const port = loadCourse(portjohnson as unknown as CourseAuthoring);
  const wild = loadCourse(wildwood as unknown as CourseAuthoring);
  const timber = loadCourse(timberline as unknown as CourseAuthoring);

  function setup(hole: HoleData, ball: Point, lie: Surface, strokes: number, golfer: Golfer = GOLFER) {
    const engine = new PhysicsEngine(hole, buildHeightField(hole));
    const aim = new AimControl(hole, engine);
    const ctx: ShotContext = { ball, lie, golfer, fireBoost: 0, strokes };
    aim.autoSelectClub(ctx);
    aim.resetAim(ctx);
    return { aim, engine, point: aim.aimPoint(ball), ctx };
  }

  it('ordinary par 4 tee setup uses practical club carry and dry ground', () => {
    const h = wild.holes.find((x) => x.par === 4)!;
    const s = setup(h, h.tee, 'tee', 0);
    expect(s.aim.club.id).toBe('driver');
    expect(dist(h.tee, s.point)).toBeLessThanOrEqual(s.aim.maxCarryPx(s.ctx) + 0.01);
    expect(s.engine.surfaceAt(s.point.x, s.point.y)).not.toBe('water');
  });

  it('ordinary par 5 tee setup uses practical club carry and an authored route target', () => {
    const h = timber.holes.find((x) => x.par === 5)!;
    const s = setup(h, h.tee, 'tee', 0);
    expect(s.aim.club.id).toBe('driver');
    expect(dist(h.tee, s.point)).toBeLessThanOrEqual(s.aim.maxCarryPx(s.ctx) + 0.01);
    expect(Math.min(...h.aiTargets!.map((t) => dist(s.point, t)))).toBeLessThan(90);
  });

  it('ordinary reachable approach targets near the flag without choosing water', () => {
    const h = port.holes.find((x) => x.par === 3)!;
    const ball = { x: h.pin.x, y: h.pin.y + 150 };
    const s = setup(h, ball, 'fairway', 1);
    expect(dist(s.point, h.pin)).toBeLessThan(8);
    expect(s.engine.surfaceAt(s.point.x, s.point.y)).not.toBe('water');
  });

  it('ordinary unreachable approach chooses a strategic waypoint instead of forcing the flag', () => {
    const h = wild.holes.find((x) => x.par === 5)!;
    const ball = h.aiTargets![0];
    const s = setup(h, ball, 'fairway', 1);
    expect(dist(s.point, h.pin)).toBeGreaterThan(80);
    expect(s.engine.surfaceAt(s.point.x, s.point.y)).not.toBe('water');
  });
});
