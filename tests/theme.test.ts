import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, resolveTheme } from '../src/core/rendering/Theme';
import { CourseData } from '../src/core/types';

const course = (theme: Record<string, unknown>): CourseData =>
  ({ name: 'T', holes: [], theme }) as unknown as CourseData;

describe('theme knobs', () => {
  it('defaults preserve the historical literals exactly', () => {
    const t = resolveTheme(null);
    expect(t.tuftDensity).toBe(1); // scatter grid step stays exactly 34
    expect(t.roughTuftHeight).toBe(1);
    expect(t.sandSculpt).toBe(0); // sand bake bit-identical when unset
    expect(t.bushKeys).toBeUndefined(); // falls back to BUSH_KEYS
    expect(t.grassKeys).toBeUndefined(); // falls back to GRASS_KEYS
    expect(t.flowerKeys).toBeUndefined(); // falls back to FLOWER_KEYS
    expect(t.lushGrass).toBeUndefined(); // flat unlit grass
    expect(t.edgeWobble).toBeUndefined(); // historical subtle wobble
    expect(t.stripeStrength).toBeUndefined(); // historical mow-stripe swing
    expect(t.mowPattern).toBeUndefined(); // diagonal stripe, not checkerboard
    expect(t.mowTile).toBeUndefined();
    expect(t.cloudKeys).toBeUndefined(); // painted billboard clouds
    expect(t.hazeStrength).toBe(DEFAULT_THEME.hazeStrength);
    expect(t.turfGrainKey).toBeUndefined(); // coded grain(), not a real texture
    expect(t.turfNormalKey).toBeUndefined(); // coded sine-wave bump
    expect(t.fairwayGrainTile).toBeUndefined();
    expect(t.roughGrainTile).toBeUndefined();
    expect(t.roughGrainKey).toBeUndefined(); // rough grain falls back to turfGrainKey
    expect(t.sandGrainKey).toBeUndefined(); // coded rake sines, not a real texture
    expect(t.sandGrainTile).toBeUndefined();
    expect(t.bunkerStones).toBeUndefined(); // no bunker-edge stones
    expect(t.horizonTint).toBeUndefined(); // historical 4-stop sky gradient
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
