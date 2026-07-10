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
    expect(t.cloudKeys).toBeUndefined(); // painted billboard clouds
    expect(t.hazeStrength).toBe(DEFAULT_THEME.hazeStrength);
    expect(t.turfGrainKey).toBeUndefined(); // coded grain(), not a real texture
    expect(t.turfNormalKey).toBeUndefined(); // coded sine-wave bump
    expect(t.fairwayGrainTile).toBeUndefined();
    expect(t.roughGrainTile).toBeUndefined();
  });

  it('round-trips authored scatter/sand/cloud knobs', () => {
    const t = resolveTheme(
      course({
        tuftDensity: 1.35,
        roughTuftHeight: 1.25,
        sandSculpt: 0.7,
        hazeStrength: 0.55,
        bushKeys: ['bush_juniper', 'bush_c', 'bush_a'],
        cloudKeys: ['cloud_a', 'cloud_b', 'cloud_c'],
        turfGrainKey: 'textures/turf_grain.jpg',
        turfNormalKey: 'textures/turf_normal.jpg',
        fairwayGrainTile: 6,
        roughGrainTile: 14
      })
    );
    expect(t.tuftDensity).toBe(1.35);
    expect(t.roughTuftHeight).toBe(1.25);
    expect(t.sandSculpt).toBe(0.7);
    expect(t.hazeStrength).toBe(0.55);
    expect(t.bushKeys).toEqual(['bush_juniper', 'bush_c', 'bush_a']);
    expect(t.cloudKeys).toEqual(['cloud_a', 'cloud_b', 'cloud_c']);
    expect(t.turfGrainKey).toBe('textures/turf_grain.jpg');
    expect(t.turfNormalKey).toBe('textures/turf_normal.jpg');
    expect(t.fairwayGrainTile).toBe(6);
    expect(t.roughGrainTile).toBe(14);
  });

  it('ignores malformed key arrays', () => {
    const t = resolveTheme(course({ bushKeys: 'bush_a', cloudKeys: [1, 2] }));
    expect(t.bushKeys).toBeUndefined();
    expect(t.cloudKeys).toBeUndefined();
  });
});
