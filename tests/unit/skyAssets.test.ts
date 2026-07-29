import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../../src/core/rendering/Theme';
import { CourseData } from '../../src/core/types';
import wildwood from '../../src/data/courses/wildwood.json';
import sablebay from '../../src/data/courses/sablebay.json';
import timberline from '../../src/data/courses/timberline.json';
import portjohnson from '../../src/data/courses/portjohnson.json';
import redhollow from '../../src/data/courses/redhollow.json';
import wildvalley from '../../src/data/courses/wildvalley.json';
import maplevale from '../../src/data/courses/maplevale.json';
import sablebayV2 from '../../src/data/courses/v2/sablebay.json';
import timberlineV2 from '../../src/data/courses/v2/timberline.json';
import timberlineWestV2 from '../../src/data/courses/v2/timberlinewest.json';
import portjohnsonV2 from '../../src/data/courses/v2/portjohnson.json';

/**
 * The per-course painted skies (Stage 6 — owner: "I want courses to have their
 * own unique skies and clouds").
 *
 * `theme.skyStyle` is a FILENAME STEM: course3d.ts turns it into three texture
 * URLs. A typo there costs three 404s and a black dome at runtime, and nothing
 * else in the build would notice — the course JSON is data, so TypeScript never
 * sees the string. This suite is the thing that notices.
 */

const ROOT = join(__dirname, '..', '..');
const SKY = join(ROOT, 'assets', 'textures', 'sky');

const COURSES: Array<[string, unknown]> = [
  ['wildwood', wildwood],
  ['sablebay', sablebay],
  ['timberline', timberline],
  ['portjohnson', portjohnson],
  ['redhollow', redhollow],
  ['wildvalley', wildvalley],
  ['maplevale', maplevale],
  ['v2/sablebay', sablebayV2],
  ['v2/timberline', timberlineV2],
  ['v2/timberlinewest', timberlineWestV2],
  ['v2/portjohnson', portjohnsonV2]
];

const theme = (c: unknown) => resolveTheme(c as CourseData);

describe('per-course painted skies', () => {
  it('every course names a sky style', () => {
    for (const [id, course] of COURSES) {
      expect(theme(course).skyStyle, `${id} has no skyStyle`).toBeTruthy();
    }
  });

  it('every named style has its three committed textures on disk', () => {
    for (const [id, course] of COURSES) {
      const style = theme(course).skyStyle as string;
      for (const part of ['ramp', 'cumulus', 'cirrus']) {
        const file = join(SKY, `${style}_${part}.png`);
        expect(existsSync(file), `${id}: missing ${style}_${part}.png`).toBe(true);
      }
    }
  });

  it('stays inside the sky budget', () => {
    // The whole point of posterising rather than shipping photographs. The
    // three PNGs for ONE style are what a hole downloads; the scene budget is
    // 37-146MB (docs/technical/PERFORMANCE_AND_QUALITY_GATES.md) and the slow
    // courses are already fill-rate bound on sky pixels, so a style that
    // suddenly weighs 200KB means somebody shipped a photo by accident.
    for (const [id, course] of COURSES) {
      const style = theme(course).skyStyle as string;
      const bytes = ['ramp', 'cumulus', 'cirrus']
        .map((p) => statSync(join(SKY, `${style}_${p}.png`)).size)
        .reduce((a, b) => a + b, 0);
      expect(bytes, `${id}: ${style} is ${(bytes / 1024).toFixed(1)}KB`).toBeLessThan(60 * 1024);
    }
  });

  it('gives every course a DIFFERENT sky — including Timberline East vs West', () => {
    // The owner's report was that the skies are all the same, and East and West
    // were literally byte-identical. Courses that are the same PLACE (the
    // pre-rebuild original and its v2) legitimately share a style; distinct
    // places must not.
    const styleOf = (id: string): string =>
      theme(COURSES.find(([c]) => c === id)?.[1]).skyStyle as string;
    const distinct = new Set(
      ['wildwood', 'v2/sablebay', 'v2/timberline', 'v2/timberlinewest', 'v2/portjohnson', 'redhollow', 'wildvalley', 'maplevale'].map(styleOf)
    );
    expect(distinct.size).toBe(8);
    expect(styleOf('v2/timberline')).not.toBe(styleOf('v2/timberlinewest'));
    // A course and its own rebuild share the place, so they share the weather.
    expect(styleOf('sablebay')).toBe(styleOf('v2/sablebay'));
    expect(styleOf('timberline')).toBe(styleOf('v2/timberline'));
    expect(styleOf('portjohnson')).toBe(styleOf('v2/portjohnson'));
  });

  it('rejects a style id that could escape the sky folder', () => {
    const bad = (v: unknown) =>
      resolveTheme({ name: 't', holes: [], theme: { skyStyle: v } } as unknown as CourseData).skyStyle;
    expect(bad('../../secret')).toBeUndefined();
    expect(bad('sea haze')).toBeUndefined();
    expect(bad('Sea_Haze')).toBeUndefined();
    expect(bad(7)).toBeUndefined();
    expect(bad('sea_haze')).toBe('sea_haze');
  });

  it('keeps the procedural sky as the fallback', () => {
    // The daily hole and any future course without a style must still get the
    // coded gradient — skyStyle is opt-in, not a requirement.
    expect(resolveTheme(null).skyStyle).toBeUndefined();
    expect(resolveTheme({ name: 't', holes: [], theme: {} } as unknown as CourseData).skyStyle).toBeUndefined();
  });
});
