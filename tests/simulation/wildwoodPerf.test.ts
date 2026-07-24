import { describe, expect, it } from 'vitest';
import wildwoodJson from '../../src/data/courses/wildwood.json';
import { withWildwoodPerf } from '../../src/systems/wildwoodPerf';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { collectTreeBlobs } from '../../src/systems/treeField';

/**
 * Guards the dev-only Wildwood Glen perf transform (systems/wildwoodPerf.ts):
 * it must thin RENDER vegetation without touching gameplay, without dropping
 * WW1 below the occlusion floor the visual gate asserts, and without mutating
 * the shared imported JSON.
 */
const BLOSSOM = (wildwoodJson as { theme: { blossomChance?: number } }).theme.blossomChance ?? 0;

// The transform runs at module load; if it mutated the import instead of its
// clone, the assertions below on `wildwoodJson` would already see the change.
const perfSrc = withWildwoodPerf(wildwoodJson as unknown as CourseAuthoring);
const base = loadCourse(wildwoodJson as unknown as CourseAuthoring);
const perf = loadCourse(perfSrc);

describe('withWildwoodPerf', () => {
  it('never mutates the imported wildwood.json (deep-clones first)', () => {
    const theme = (wildwoodJson as { theme: Record<string, unknown> }).theme;
    expect(theme.waterReflectRatio).toBeUndefined();
    expect(theme.backdropTreeStep).toBeUndefined();
  });

  it('thins render trunks on every hole', () => {
    perf.holes.forEach((h, i) => {
      const before = collectTreeBlobs(base.holes[i], BLOSSOM, true).length;
      const after = collectTreeBlobs(h, BLOSSOM, true).length;
      expect(after, `hole ${i + 1} render trunks`).toBeLessThan(before);
    });
  });

  it('keeps WW1 above the ≥50 canopy-occlusion floor the visual gate asserts', () => {
    // occlusion.spec.ts: wildwood h1 must register ≥50 occlusion candidates,
    // which are built from the render trunk set collectTreeBlobs(…, true).
    expect(collectTreeBlobs(perf.holes[0], BLOSSOM, true).length).toBeGreaterThanOrEqual(50);
  });

  it('leaves collision hitboxes (spacing) byte-identical — gameplay untouched', () => {
    perf.holes.forEach((h, i) => {
      const before = collectTreeBlobs(base.holes[i], BLOSSOM, false).length;
      const after = collectTreeBlobs(h, BLOSSOM, false).length;
      expect(after, `hole ${i + 1} collision trunks`).toBe(before);
    });
  });

  it('trims garden bloom density marginally, never below 1', () => {
    const holeIdx = perfSrc.holes.findIndex((h) => (h.gardens?.length ?? 0) > 0);
    expect(holeIdx).toBeGreaterThanOrEqual(0);
    const baseGardens = (wildwoodJson as unknown as { holes: Array<{ gardens?: Array<{ density?: number }> }> })
      .holes[holeIdx].gardens!;
    perfSrc.holes[holeIdx].gardens!.forEach((g, gi) => {
      const bd = baseGardens[gi].density;
      if (typeof bd === 'number') {
        expect(g.density!).toBeLessThanOrEqual(bd);
        expect(g.density!).toBeGreaterThanOrEqual(1);
      }
    });
  });

  it('sets a cheaper water-mirror ratio on the theme', () => {
    expect((perfSrc.theme as { waterReflectRatio?: number }).waterReflectRatio).toBeLessThan(0.35);
  });
});
