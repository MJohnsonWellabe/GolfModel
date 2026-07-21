import { describe, expect, it } from 'vitest';
import { loadCourse, CourseAuthoring } from '../../src/data/courseLoader';
import { buildHeightField } from '../../src/systems/HeightField';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { golferWith, PERFECT_SWING } from '../simulation/simHelpers';
import type { HoleData } from '../../src/core/types';
import timberlineV2 from '../../src/data/courses/v2/timberline.json';

/**
 * A tree authored as a LANDFORM (a fir sapling placed via hole.landforms, not a
 * `trees` hazard) must collide as a real TREE — a ball flying into it STOPS.
 * Regression for the owner's report that "the fir saplings … didn't seem to
 * have hitboxes": they used to fall through the rock-landform path and only
 * deflect when authored h >= landformCollideMinH, so a short sapling was fully
 * pass-through. Now every `tree_*` landform is a trunk in the tree collider set.
 */
describe('tree landforms have a real tree hitbox', () => {
  const course = loadCourse(timberlineV2 as unknown as CourseAuthoring);

  it('a low liner into a fir-sapling landform is stopped (not passed through / caromed)', () => {
    // Timberline East hole 2 carries three fir landforms clustered near (471,505).
    const hole = course.holes.find((h) =>
      (h as unknown as { landforms?: { key?: string }[] }).landforms?.some((l) => String(l.key).startsWith('tree_'))
    ) as HoleData;
    expect(hole, 'a hole with a tree landform exists').toBeTruthy();
    const firs = (hole as unknown as { landforms: { key: string; x: number; y: number }[] }).landforms.filter((l) =>
      String(l.key).startsWith('tree_')
    );
    expect(firs.length).toBeGreaterThan(0);
    const cx = firs.reduce((a, l) => a + l.x, 0) / firs.length;
    const cy = firs.reduce((a, l) => a + l.y, 0) / firs.length;

    const shoot = (dist: number, launchMult: number) => {
      const origin = { x: cx, y: cy + dist };
      const aim = Math.atan2(cy - origin.y, cx - origin.x);
      return new PhysicsEngine(hole, buildHeightField(hole), mulberry32(3)).simulate({
        origin,
        aimAngle: aim,
        swing: PERFECT_SWING(1.0),
        club: clubById('7i'),
        golfer: golferWith(85),
        fireBoost: 0,
        lie: 'tee',
        wind: { angle: 0, speed: 0 },
        hole,
        launchMult,
        spin: { side: 0, top: 0 }
      });
    };
    // A LOW shot that crosses the cluster below the sapling's canopy height is
    // stopped, and settles at the cluster (not caroming away like a rock).
    const low = shoot(150, 0.35);
    expect(low.hitTrees, 'a low shot into the fir cluster stops').toBe(true);
    expect(Math.hypot(low.finalPos.x - cx, low.finalPos.y - cy)).toBeLessThan(45);
    // A HIGH shot flies OVER the short saplings and clears them — the lollipop
    // hitbox matches the tree's real height (owner: reflect the tree's shape).
    const high = shoot(150, 1.0);
    expect(high.hitTrees, 'a high shot clears the short saplings').toBe(false);
  });
});
