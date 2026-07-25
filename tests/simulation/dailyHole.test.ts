import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import sablebay from '../../src/data/courses/v2/sablebay.json';
import timberline from '../../src/data/courses/v2/timberline.json';
import { DAILY_BAND, generateHole, courseForHole, seedForDate, themeForDate } from '../../src/systems/DailyHole';
import { gradeHole } from '../../src/systems/DailyHoleGate';
import { clearDailyHoleCache, dailyHole, shareText } from '../../src/systems/DailyHoleService';

/**
 * Hole of the Day.
 *
 * The whole idea rests on two properties, and this file exists to hold them:
 *
 *   1. **Determinism.** Every player must independently arrive at the same hole
 *      for a given date, with no server telling them what it is — otherwise the
 *      day's scores are not comparable and sharing is meaningless.
 *   2. **The gate is real.** A generator that ships whatever it drew is worse
 *      than no generator. The simulator must actually reject holes, and the
 *      holes it passes must be playable.
 */

const themes = {
  sablebay: loadCourse(sablebay as unknown as CourseAuthoring),
  timberline: loadCourse(timberline as unknown as CourseAuthoring)
};

describe('daily hole determinism', () => {
  it('derives the same seed from the same date, and different seeds from different dates', () => {
    expect(seedForDate('2026-07-25')).toBe(seedForDate('2026-07-25'));
    expect(seedForDate('2026-07-25')).not.toBe(seedForDate('2026-07-26'));
  });

  it('picks a theme deterministically and cycles across days', () => {
    const ids = Object.keys(themes);
    expect(themeForDate('2026-07-25', ids)).toBe(themeForDate('2026-07-25', ids));
    const week = ['01', '02', '03', '04', '05', '06', '07'].map((d) => themeForDate(`2026-07-${d}`, ids));
    expect(new Set(week).size).toBeGreaterThan(1);
  });

  it('generates byte-identical geometry from the same seed', () => {
    const a = generateHole(12345);
    const b = generateHole(12345);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(generateHole(12346))).not.toBe(JSON.stringify(a));
  });

  it('resolves the same hole for the same day, twice, from a cold cache', { timeout: 120_000 }, () => {
    clearDailyHoleCache();
    const first = dailyHole('2026-08-01', themes);
    clearDailyHoleCache();
    const second = dailyHole('2026-08-01', themes);
    expect(first.spec?.seed).toBe(second.spec?.seed);
    expect(first.spec?.par).toBe(second.spec?.par);
  });
});

describe('generated holes are real golf holes', () => {
  it('compiles through the normal course loader (no second code path)', () => {
    const course = courseForHole(generateHole(999), themes.sablebay, 'Test');
    const hole = course.holes[0];
    expect(hole.par).toBeGreaterThanOrEqual(3);
    expect(hole.par).toBeLessThanOrEqual(5);
    // The loader compiles ribbons to polygons and keeps the centerline for the
    // flyover + the playable boundary; both must survive.
    expect(hole.fairway[0].length).toBeGreaterThan(3);
    expect(hole.fairwayCenterlines?.[0]?.length).toBeGreaterThan(1);
    expect(hole.yardage).toBeGreaterThan(100);
  });

  it('places the pin on the green it generated', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const hole = courseForHole(generateHole(seed), themes.sablebay, 'T').holes[0];
      const dx = (hole.pin.x - hole.green.cx) / hole.green.rx;
      const dy = (hole.pin.y - hole.green.cy) / hole.green.ry;
      expect(Math.hypot(dx, dy), `seed ${seed}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('the difficulty gate', () => {
  it('grades a shipped, hand-authored hole as playable', { timeout: 60_000 }, () => {
    // The band is calibrated against real holes: if an authored Sable Bay hole
    // fails it, the band is wrong, not the hole.
    const grade = gradeHole(themes.sablebay, 0);
    expect(grade.meanToPar).toBeGreaterThan(-2);
    expect(grade.meanToPar).toBeLessThan(4);
    expect(grade.parRate).toBeGreaterThan(0);
  });

  it('is deterministic — the same hole always grades the same', { timeout: 60_000 }, () => {
    const course = courseForHole(generateHole(4242), themes.sablebay, 'T');
    expect(gradeHole(course)).toEqual(gradeHole(course));
  });

  it('actually rejects holes (a gate that passes everything is not a gate)', () => {
    // Grade a spread of candidates and confirm the band bites on some of them.
    let rejects = 0;
    for (let i = 0; i < 12; i++) {
      const course = courseForHole(generateHole(1000 + i * 7919), themes.sablebay, 'T');
      if (!gradeHole(course).ok) rejects++;
    }
    expect(rejects, 'no candidate was ever rejected — the band is not doing anything').toBeGreaterThan(0);
    // Grading is 140 simulated rounds per candidate — cheap arithmetic, but 12
    // candidates of it exceeds the default 5s budget on a loaded machine.
  }, 120_000);

  it('serves a hole that passed the band, and records what it rejected', { timeout: 120_000 }, () => {
    clearDailyHoleCache();
    const res = dailyHole('2026-09-15', themes);
    expect(res.spec, 'no hole passed the gate for this day').not.toBeNull();
    expect(res.grade?.ok).toBe(true);
    expect(res.grade!.meanToPar).toBeLessThanOrEqual(DAILY_BAND.maxMeanToPar);
    expect(res.grade!.meanToPar).toBeGreaterThanOrEqual(DAILY_BAND.minMeanToPar);
    expect(res.grade!.blowupRate).toBeLessThanOrEqual(DAILY_BAND.maxBlowupRate);
    expect(res.grade!.parRate).toBeGreaterThanOrEqual(DAILY_BAND.minParRate);
  });

  it('finds a playable hole for every day of a month', () => {
    // The failure this guards is a day with no hole at all, which would be a
    // visible hole in the product on an arbitrary future date.
    clearDailyHoleCache();
    const misses: string[] = [];
    for (let d = 1; d <= 28; d++) {
      const key = `2026-10-${String(d).padStart(2, '0')}`;
      if (!dailyHole(key, themes).spec) misses.push(key);
    }
    expect(misses, `days with no playable hole: ${misses.join(', ')}`).toEqual([]);
  }, 120_000);
});

describe('shareable result', () => {
  it('says how you did without spoiling the hole', () => {
    const text = shareText('2026-07-25', 4, 3);
    expect(text).toContain('2026-07-25');
    expect(text).toContain('🐦');
    expect(text).toContain('(-1)');
    // Nothing about the hole's shape, hazards or line may leak.
    expect(text.toLowerCase()).not.toMatch(/dogleg|bunker|water|left|right|yard/);
  });

  it('marks every scoring band distinctly', () => {
    // The mark is the first token of the RESULT line (the header line names
    // the game and the date).
    const marks = [-2, -1, 0, 1, 2, 3].map((d) => shareText('d', 4, 4 + d).split('\n')[1].split(' ')[0]);
    expect(new Set(marks).size).toBe(6);
  });
});
