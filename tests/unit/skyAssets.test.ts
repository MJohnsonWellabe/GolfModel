import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { coursesFor } from '../../src/data/courseRoster';
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

  /**
   * THE DOME HAS TO END ON THE FOG COLOUR.
   *
   * The scene runs EXP2 fog at `scene.fogColor = theme.haze`, so everything
   * distant dissolves into that colour. `scripts/convert-skies.mjs` therefore
   * ramps each style's bottom bands onto its course's haze; if the two disagree
   * a pale band sits above the horizon on every hole of that course.
   *
   * Which is exactly what shipped. The haze values were read from
   * `src/data/courses/<id>.json`, but production runs `courseRebuilds`, which
   * loads `src/data/courses/v2/<id>.json` — and Sable Bay, Timberline East and
   * Port Johnson differ between the two. Port Johnson's dome ended 24/28/30
   * above its own fog.
   *
   * So this resolves every course through `coursesFor` — THE SAME ROSTER THE
   * GAME BUILDS FROM — rather than a hand-maintained import list, which is how
   * the mistake got in. Reading the shipped PNG rather than the script's table
   * also means a stale ramp (edited constant, never regenerated) fails here.
   */
  it('every painted dome ends on its own course fog colour', async () => {
    const roster = coursesFor({ newCourses: true, courseRebuilds: true });
    let checked = 0;
    for (const [id, course] of Object.entries(roster)) {
      const t = theme(course);
      if (!t.skyStyle) continue;
      const { data, info } = await sharp(join(SKY, `${t.skyStyle}_ramp.png`))
        .raw()
        .toBuffer({ resolveWithObject: true });
      // Row 0 is the zenith, so the LAST row is the horizon — the texel that
      // abuts the fog. (course3d loads the ramp with invertY:false to match the
      // DynamicTexture it replaced, so row order here is dome order.)
      const i = (info.height - 1) * info.width * info.channels;
      const got = [data[i], data[i + 1], data[i + 2]];
      const want = [(t.haze >> 16) & 255, (t.haze >> 8) & 255, t.haze & 255];
      const hex = (c: number[]): string => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
      // Tolerance is for the palette quantizer, not for authoring slack: the
      // three real defects were 13-30 per channel.
      for (let k = 0; k < 3; k++) {
        expect(
          Math.abs(got[k] - want[k]),
          `${id} (${t.skyStyle}): dome ends ${hex(got)} but fog is ${hex(want)}`
        ).toBeLessThanOrEqual(2);
      }
      checked++;
    }
    // Guard the guard: an empty roster or a renamed field would pass vacuously.
    expect(checked, 'no course resolved to a sky style').toBeGreaterThanOrEqual(8);
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
