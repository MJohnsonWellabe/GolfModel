import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, resolveTheme } from '../src/core/rendering/Theme';
import { CourseData } from '../src/core/types';

const course = (theme: Record<string, unknown>): CourseData =>
  ({ name: 'T', holes: [], theme }) as unknown as CourseData;

describe('theme knobs', () => {
  it('defaults now carry the unified premium rendering system', () => {
    // The polished look (grain, lush grass, sculpted sand, striped greens, wispy
    // sky, flowers) was promoted from Timberline into DEFAULT_THEME so every
    // course inherits it. resolveTheme(null) === DEFAULT_THEME.
    const t = resolveTheme(null);
    expect(t.tuftDensity).toBe(1.2);
    expect(t.roughTuftHeight).toBe(1.2);
    expect(t.sandSculpt).toBe(0.6);
    expect(t.lushGrass).toBe(true);
    expect(t.edgeWobble).toBe(1.6);
    expect(t.stripeStrength).toBe(1.15);
    expect(t.cloudStyle).toBe('wispy');
    expect(t.bunkerStones).toBe(true);
    expect(t.greenColumns).toBe(true);
    expect(t.greenMowTile).toBe(14);
    expect(t.turfGrainKey).toBe('textures/turf_grain.jpg');
    expect(t.roughGrainKey).toBe('textures/turf_grain_rough.jpg');
    expect(t.turfNormalKey).toBe('textures/turf_normal.jpg');
    expect(t.fairwayGrainTile).toBe(6);
    expect(t.roughGrainTile).toBe(14);
    expect(t.sandGrainKey).toBe('textures/sand_ripple.jpg');
    expect(t.sandGrainTile).toBe(18);
    expect(t.grassKeys).toEqual(['grass_g', 'grass_h', 'grass_i']);
    expect(t.flowerKeys).toEqual(['flower_a', 'flower_b', 'flower_c']);
    // Still per-course IDENTITY — NOT defaulted (each course keeps its own):
    expect(t.mowPattern).toBeUndefined(); // the checker diamond is Timberline-only
    expect(t.mowTile).toBeUndefined();
    expect(t.cloudKeys).toBeUndefined(); // wispy painted clouds ignore mesh keys
    expect(t.treeKeys).toBeUndefined(); // species stay per-course
    expect(t.bushKeys).toBeUndefined();
    expect(t.hazeStrength).toBe(DEFAULT_THEME.hazeStrength);
  });

  it('a course inherits the defaults but can still override or DISABLE them', () => {
    const lush = resolveTheme(course({ fairway: '#123456' }));
    expect(lush.lushGrass).toBe(true); // inherited
    expect(lush.grassKeys).toEqual(['grass_g', 'grass_h', 'grass_i']); // inherited, not wiped
    expect(lush.turfGrainKey).toBe('textures/turf_grain.jpg'); // inherited
    const plain = resolveTheme(course({ lushGrass: false, bunkerStones: false }));
    expect(plain.lushGrass).toBe(false); // explicit disable respected
    expect(plain.bunkerStones).toBe(false);
  });

  it('derives horizonTint from the course sky when unset', () => {
    const t = resolveTheme(course({ skyBottom: '#c0d8e8' }));
    expect(t.horizonTint).not.toBeUndefined();
    // a warm lift of the course's own horizon color, not a fixed cream
    expect(t.horizonTint).not.toBe(0xe8ddc4);
  });

  it('round-trips authored scatter/sand/cloud knobs', () => {
    const t = resolveTheme(
      course({
        tuftDensity: 1.35,
        roughTuftHeight: 1.25,
        sandSculpt: 0.7,
        hazeStrength: 0.55,
        bushKeys: ['bush_juniper', 'bush_c', 'bush_a'],
        grassKeys: ['grass_g', 'grass_h', 'grass_i'],
        flowerKeys: ['flower_a', 'flower_b', 'flower_c'],
        lushGrass: true,
        edgeWobble: 2.4,
        stripeStrength: 1.3,
        mowPattern: 'checker',
        mowTile: 30,
        cloudKeys: ['cloud_a', 'cloud_b', 'cloud_c'],
        cloudStyle: 'wispy',
        turfGrainKey: 'textures/turf_grain.jpg',
        turfNormalKey: 'textures/turf_normal.jpg',
        fairwayGrainTile: 6,
        roughGrainTile: 14,
        roughGrainKey: 'textures/turf_grain_rough.jpg',
        sandGrainKey: 'textures/sand_ripple.jpg',
        sandGrainTile: 9,
        bunkerStones: true,
        horizonTint: '#e9dcc0'
      })
    );
    expect(t.tuftDensity).toBe(1.35);
    expect(t.roughTuftHeight).toBe(1.25);
    expect(t.sandSculpt).toBe(0.7);
    expect(t.hazeStrength).toBe(0.55);
    expect(t.bushKeys).toEqual(['bush_juniper', 'bush_c', 'bush_a']);
    expect(t.grassKeys).toEqual(['grass_g', 'grass_h', 'grass_i']);
    expect(t.lushGrass).toBe(true);
    expect(t.edgeWobble).toBe(2.4);
    expect(t.stripeStrength).toBe(1.3);
    expect(t.mowPattern).toBe('checker');
    expect(t.mowTile).toBe(30);
    expect(t.cloudKeys).toEqual(['cloud_a', 'cloud_b', 'cloud_c']);
    expect(t.cloudStyle).toBe('wispy');
    expect(t.turfGrainKey).toBe('textures/turf_grain.jpg');
    expect(t.turfNormalKey).toBe('textures/turf_normal.jpg');
    expect(t.fairwayGrainTile).toBe(6);
    expect(t.roughGrainTile).toBe(14);
    expect(t.roughGrainKey).toBe('textures/turf_grain_rough.jpg');
    expect(t.sandGrainKey).toBe('textures/sand_ripple.jpg');
    expect(t.sandGrainTile).toBe(9);
    expect(t.bunkerStones).toBe(true);
    expect(t.horizonTint).toBe(0xe9dcc0);
  });

  it('ignores malformed key arrays', () => {
    const t = resolveTheme(course({ bushKeys: 'bush_a', cloudKeys: [1, 2] }));
    expect(t.bushKeys).toBeUndefined();
    expect(t.cloudKeys).toBeUndefined();
  });
});
