import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../../src/core/rendering/Theme';
import { CourseData } from '../../src/core/types';
import sablebay from '../../src/data/courses/sablebay.json';
import timberline from '../../src/data/courses/timberline.json';
import wildwood from '../../src/data/courses/wildwood.json';
import portjohnson from '../../src/data/courses/portjohnson.json';

const themed = (theme: Record<string, unknown>): CourseData =>
  ({ name: 't', holes: [], theme }) as unknown as CourseData;

describe('theme atmosphere key (V2 Phase 4)', () => {
  it('parses the four valid presets and rejects junk', () => {
    expect(resolveTheme(themed({ atmosphere: 'forest' })).atmosphere).toBe('forest');
    expect(resolveTheme(themed({ atmosphere: 'alpine' })).atmosphere).toBe('alpine');
    expect(resolveTheme(themed({ atmosphere: 'coastal' })).atmosphere).toBe('coastal');
    expect(resolveTheme(themed({ atmosphere: 'none' })).atmosphere).toBe('none');
    expect(resolveTheme(themed({ atmosphere: 'blizzard' })).atmosphere).toBeUndefined();
    expect(resolveTheme(themed({})).atmosphere).toBeUndefined();
  });

  it('each shipped course resolves its bible-assigned preset', () => {
    // Coastal courses rely on the sea-backdrop default (unset key), so the
    // shipped gull behavior is untouched by the new field.
    const sb = resolveTheme(sablebay as unknown as CourseData);
    const pj = resolveTheme(portjohnson as unknown as CourseData);
    expect(sb.atmosphere).toBeUndefined();
    expect(sb.backdrop).toBe('sea');
    expect(pj.atmosphere).toBeUndefined();
    expect(pj.backdrop).toBe('sea');
    expect(resolveTheme(wildwood as unknown as CourseData).atmosphere).toBe('forest');
    expect(resolveTheme(timberline as unknown as CourseData).atmosphere).toBe('alpine');
  });
});
