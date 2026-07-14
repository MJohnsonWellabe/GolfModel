import { describe, expect, it } from 'vitest';
import { AimControl, ShotContext } from '../src/core/input/AimControl';
import { PhysicsEngine } from '../src/systems/PhysicsEngine';
import { buildHeightField } from '../src/systems/HeightField';
import { CourseAuthoring, loadCourse } from '../src/data/courseLoader';
import { Golfer, HoleData, Point, Surface } from '../src/core/types';
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
