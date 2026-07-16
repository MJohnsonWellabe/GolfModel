import { describe, expect, it } from 'vitest';
import { AimControl, ShotContext } from '../src/core/input/AimControl';
import { PhysicsEngine } from '../src/systems/PhysicsEngine';
import { buildHeightField } from '../src/systems/HeightField';
import { CourseAuthoring, loadCourse } from '../src/data/courseLoader';
import { Golfer, HoleData, Point, Surface } from '../src/core/types';
import { dist } from '../src/utils/Geometry';
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

  it('par 5 tee shots choose an authored strategic landing area', () => {
    const h = timber.holes.find((x) => x.par === 5)!;
    const p = defaultAim(h, h.tee, 'tee', 0, ELITE);
    expect(Math.min(...(h.aiTargets ?? []).map((t) => dist(p, t)))).toBeLessThan(45);
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
