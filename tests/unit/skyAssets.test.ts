import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
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

/**
 * The per-style sheets. Only the DOME RAMP is per course now.
 *
 * The clouds used to be cut from each course's own HDRI, and they were the one
 * part of the painted skies that failed: "the clouds look bad". They are now
 * five shared CC0 silhouettes (scripts/convert-clouds.mjs) tinted per course at
 * runtime from that course's own sunTint/skyTop/haze — so the sky stays unique
 * per course, which is the part that worked, without a photographed cloud in it.
 */
const PARTS = ['ramp'];

/** The shared cloud silhouettes, loaded BY NAME from course3d.ts. A rename or a
 *  missing variant is a 404 and an invisible billboard, and nothing else in the
 *  build would notice. */
const CLOUD_SHEETS = ['cloud_cumulus1', 'cloud_cumulus2', 'cloud_cumulus3', 'cloud_cirrus1', 'cloud_cirrus2'];

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

  it('every named style has its committed ramp on disk', () => {
    for (const [id, course] of COURSES) {
      const style = theme(course).skyStyle as string;
      for (const part of PARTS) {
        const file = join(SKY, `${style}_${part}.png`);
        expect(existsSync(file), `${id}: missing ${style}_${part}.png`).toBe(true);
      }
    }
  });

  /**
   * THE CLOUD SHEETS HAVE TO EXIST, AND HAVE TO BE DIFFERENT CLOUDS.
   *
   * One sheet on every billboard was the "sable bay is just the same cloud on
   * repeat" report, and that half of the diagnosis survived the rebuild even
   * though the sheets themselves were replaced.
   */
  it('ships five distinct shared cloud silhouettes', () => {
    const digests = new Set<string>();
    for (const n of CLOUD_SHEETS) {
      const f = join(SKY, `${n}.png`);
      expect(existsSync(f), `missing ${n}.png — course3d loads it by name`).toBe(true);
      digests.add(createHash('sha1').update(readFileSync(f)).digest('hex'));
    }
    expect(digests.size, 'two cloud sheets are byte-identical').toBe(CLOUD_SHEETS.length);
  });

  it('keeps the shared cloud sheets inside their own budget', () => {
    // Shared by all eight courses, so this is paid ONCE — but it is paid on
    // every hole, and the slow courses are already fill-rate bound on sky
    // pixels. 120KB is roughly twice what the five sheets weigh today; blowing
    // past it means somebody shipped them at full alpha depth again (236KB) or
    // dropped the quantisation.
    const bytes = CLOUD_SHEETS.map((n) => statSync(join(SKY, `${n}.png`)).size).reduce((a, b) => a + b, 0);
    expect(bytes, `cloud sheets weigh ${(bytes / 1024).toFixed(1)}KB`).toBeLessThan(120 * 1024);
  });

  it('stays inside the sky budget', () => {
    // The whole point of posterising rather than shipping photographs. The
    // three PNGs for ONE style are what a hole downloads; the scene budget is
    // 37-146MB (docs/technical/PERFORMANCE_AND_QUALITY_GATES.md) and the slow
    // courses are already fill-rate bound on sky pixels, so a style that
    // suddenly weighs 200KB means somebody shipped a photo by accident.
    for (const [id, course] of COURSES) {
      const style = theme(course).skyStyle as string;
      const bytes = PARTS.map((p) => statSync(join(SKY, `${style}_${p}.png`)).size).reduce((a, b) => a + b, 0);
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
  it('every painted dome meets its own course fog colour AT THE HORIZON', async () => {
    const roster = coursesFor({ newCourses: true, courseRebuilds: true });
    let checked = 0;
    for (const [id, course] of Object.entries(roster)) {
      const t = theme(course);
      if (!t.skyStyle) continue;
      const { data, info } = await sharp(join(SKY, `${t.skyStyle}_ramp.png`))
        .raw()
        .toBuffer({ resolveWithObject: true });
      // THE HORIZON IS THE MIDDLE ROW, NOT THE LAST ONE.
      //
      // Babylon's CreateSphere emits v from the polar angle and course3d
      // centres the dome at y = 0 with invertY:false, so row 0 is the ZENITH
      // (+90°), the middle row is the HORIZON (0°) and the last row points
      // straight DOWN (−90°). This used to read the last row, which is the one
      // texel of this texture that can never be seen — so it was asserting that
      // a colour under the player's feet matched the fog, and every course
      // passed while the visible horizon sat on whatever the ramp happened to
      // reach. Wildwood's arrived at #6080b8, a dark saturated blue, against a
      // near-white fog: the owner's "changes from a light to a dark blue in a
      // weird abrupt way".
      const horizonRow = Math.floor(info.height / 2) - 1;
      const i = horizonRow * info.width * info.channels;
      const got = [data[i], data[i + 1], data[i + 2]];
      const want = [(t.haze >> 16) & 255, (t.haze >> 8) & 255, t.haze & 255];
      const hex = (c: number[]): string => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
      // Tolerance is for the palette quantizer, not for authoring slack: the
      // three real defects were 13-30 per channel.
      for (let k = 0; k < 3; k++) {
        expect(
          Math.abs(got[k] - want[k]),
          `${id} (${t.skyStyle}): dome reaches ${hex(got)} at the horizon but fog is ${hex(want)}`
        ).toBeLessThanOrEqual(2);
      }
      checked++;
    }
    // Guard the guard: an empty roster or a renamed field would pass vacuously.
    expect(checked, 'no course resolved to a sky style').toBeGreaterThanOrEqual(8);
  });

  /**
   * NO HARD STEP IN THE SKY THE PLAYER LOOKS AT.
   *
   * The ramp was 13-16 perfectly flat plateaus with nothing between them. One
   * texel row is 0.703° of arc against a 60° camera FOV, so a band edge is ~12
   * screen pixels on a 1080-tall canvas — and Wildwood's worst edge was a
   * 48-level swing, because its walking percentile hit cumulus in the source
   * and produced a pale band sandwiched between two dark ones. That is exactly
   * what the owner reported, and he was right that it was everywhere: four of
   * the eight styles had a double-digit step somewhere in the visible half.
   *
   * The band boundaries are feathered now. This is the number that has to stay
   * small, and it is measured only over the UPPER half — below the horizon the
   * ramp steps straight to the haze colour on purpose, and nothing sees it.
   */
  it('has no hard step in the visible half of any dome', async () => {
    const roster = coursesFor({ newCourses: true, courseRebuilds: true });
    let checked = 0;
    for (const [id, course] of Object.entries(roster)) {
      const t = theme(course);
      if (!t.skyStyle) continue;
      const { data, info } = await sharp(join(SKY, `${t.skyStyle}_ramp.png`))
        .raw()
        .toBuffer({ resolveWithObject: true });
      const row = (y: number): number[] => {
        const i = y * info.width * info.channels;
        return [data[i], data[i + 1], data[i + 2]];
      };
      let worst = 0;
      let at = 0;
      for (let y = 1; y < Math.floor(info.height / 2); y++) {
        const a = row(y - 1);
        const b = row(y);
        const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
        if (d > worst) {
          worst = d;
          at = y;
        }
      }
      // 12 is generous: the eight styles measure 5-7 after the fix, and they
      // measured up to 48 before it.
      expect(worst, `${id} (${t.skyStyle}): ${worst}-level step at row ${at}`).toBeLessThanOrEqual(12);
      checked++;
    }
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
