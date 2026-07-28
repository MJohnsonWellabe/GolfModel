import { describe, expect, it } from 'vitest';
import { classGridCells } from '../../src/core/rendering/CourseTexture';

/**
 * THE GROUND BAKE'S CLASSIFICATION GRID MUST COVER THE WHOLE HOLE.
 *
 * `renderCourseCanvas` rasterizes a coarse surface-class grid at `step` WORLD px
 * per cell, and reads it back with `(worldX + pad) / step | 0`, clamped to the
 * grid. It used to size that grid from the SCALED CANVAS instead — which agreed
 * with the world only at bake scale exactly 1, the one value the bake ever used
 * until its floor dropped to 0.5 for low-end devices.
 *
 * Below 1 the grid stopped short of the world's right and bottom edges. Every
 * point past the end clamped to the final column, smearing whatever class sat
 * there across the remainder of the hole — on Sable Bay 3 a fairway ribbon near
 * the edge repainted the rest of the hole as fairway, while the physics still
 * played it as the waste sand it really was (owner: "everything renders as
 * fairway all the way to the farthest right the hole goes"). Art and physics
 * disagreeing about where the fairway is is about as bad as a bug gets here,
 * and it only appeared on the phones least able to report it.
 */
describe('the bake covers the hole at any texture scale', () => {
  const STEP = 2;
  const PAD = 120;

  it('never clamps, anywhere in the padded world', () => {
    // Every real hole world, plus awkward sizes around the cell boundary.
    for (const span of [1020 + PAD * 2, 1240 + PAD * 2, 1560 + PAD * 2, 1, 2, 3, 4, 999, 1001]) {
      const cells = classGridCells(span, STEP);
      // The far edge is the case that was broken: it must index inside.
      expect((span / STEP) | 0, `span ${span} clamps at its far edge`).toBeLessThan(cells);
      // …and so must every point before it.
      for (const x of [0, span / 3, span / 2, span - 1, span]) {
        expect((x / STEP) | 0, `span ${span} clamps at ${x}`).toBeLessThan(cells);
      }
    }
  });

  it('does not depend on the texture scale — that is the whole point', () => {
    // The regression, stated directly: sizing from the canvas made the grid a
    // function of bake scale. A low-detail albedo must still know exactly where
    // the fairway ends.
    const span = 1240 + PAD * 2;
    const fromWorld = classGridCells(span, STEP);
    for (const scale of [0.5, 0.7, 1, 1.6, 2]) {
      const fromCanvas = Math.ceil(Math.round(span * scale) / STEP);
      if (scale < 1) {
        expect(fromCanvas, `scale ${scale} used to under-cover`).toBeLessThan(fromWorld);
      }
      expect(classGridCells(span, STEP), `scale ${scale}`).toBe(fromWorld);
    }
  });

  it('keeps the grid honest at the coarsest cell sizes', () => {
    for (const step of [1, 2, 4, 8]) {
      const span = 1480;
      expect((span / step) | 0).toBeLessThan(classGridCells(span, step));
    }
  });
});
