import { describe, expect, it } from 'vitest';
import { SWING } from '../src/config';
import {
  asDifficulty,
  DEFAULT_DIFFICULTY,
  defaultDifficulty,
  DIFFICULTIES,
  difficultyProfile,
  effectiveDifficulty,
  recordsAllowed,
  TUTORIAL_DIFFICULTY,
  zoneMultFor
} from '../src/systems/Difficulty';
import { goodHalf, perfectHalf } from '../src/systems/swingModel';
import { bandGeometry, outlinePx } from '../src/slice3d/meter3d';
import { applyRoundRecords, emptyRecords, RoundRecordInput } from '../src/systems/Records';
import { rankedRound } from '../src/systems/RecordBoards';
import { RoundStats } from '../src/data/progression';

describe('the difficulty table', () => {
  it('defines Pro as the shipped game', () => {
    // The whole scheme hangs off this: Pro must be a pure 1.0 or "the game as
    // it shipped" quietly becomes a different game.
    expect(zoneMultFor('pro')).toBe(1);
  });

  it('has the owner-specified multipliers, easiest to hardest', () => {
    expect(zoneMultFor('beginner')).toBeCloseTo(1.4, 10);
    expect(zoneMultFor('amateur')).toBeCloseTo(1.2, 10);
    expect(zoneMultFor('expert')).toBeCloseTo(0.8, 10);
  });

  it('puts Beginner at exactly the width the Fire streak grants', () => {
    // Owner: beginner "would equate to always being on fire right now, right?"
    expect(zoneMultFor('beginner')).toBeCloseTo(SWING.firePerfectMult, 10);
  });

  it('is ordered easiest → hardest with strictly shrinking zones', () => {
    const mults = DIFFICULTIES.map(zoneMultFor);
    for (let i = 1; i < mults.length; i++) expect(mults[i]).toBeLessThan(mults[i - 1]);
  });

  it('allows records only at Pro and harder', () => {
    expect(DIFFICULTIES.filter(recordsAllowed)).toEqual(['pro', 'expert']);
    // Stated structurally too: anything with more room than Pro is unranked.
    for (const d of DIFFICULTIES) expect(recordsAllowed(d)).toBe(zoneMultFor(d) <= 1);
  });
});

describe('what a difficulty actually moves', () => {
  const ctx = { stat: 78, powerTarget: 0.8, isPutt: false };

  it('scales the perfect AND good bands by exactly the multiplier', () => {
    for (const d of DIFFICULTIES) {
      const pro = { ...ctx, perfectMult: zoneMultFor('pro') };
      const at = { ...ctx, perfectMult: zoneMultFor(d) };
      expect(perfectHalf(at) / perfectHalf(pro)).toBeCloseTo(zoneMultFor(d), 10);
      expect(goodHalf(at) / goodHalf(pro)).toBeCloseTo(zoneMultFor(d), 10);
    }
  });

  it('stacks with fire rather than replacing it', () => {
    const beginner = { ...ctx, perfectMult: zoneMultFor('beginner') };
    const onFire = { ...ctx, perfectMult: zoneMultFor('beginner') * SWING.firePerfectMult };
    expect(perfectHalf(onFire) / perfectHalf(beginner)).toBeCloseTo(SWING.firePerfectMult, 10);
  });
});

describe('defaults', () => {
  it('starts a player in the lesson at Beginner and everywhere after at Amateur', () => {
    expect(defaultDifficulty(false)).toBe(TUTORIAL_DIFFICULTY);
    expect(defaultDifficulty(false)).toBe('beginner');
    expect(defaultDifficulty(true)).toBe(DEFAULT_DIFFICULTY);
    expect(defaultDifficulty(true)).toBe('amateur');
  });

  it('an explicit choice outranks the default, in both directions', () => {
    expect(effectiveDifficulty('expert', false)).toBe('expert');
    expect(effectiveDifficulty('beginner', true)).toBe('beginner');
  });

  it('treats absent and garbled stored values as "never chosen"', () => {
    for (const junk of [undefined, null, '', 'PRO', 'legend', 7, {}]) {
      expect(asDifficulty(junk)).toBeUndefined();
      expect(effectiveDifficulty(junk, true)).toBe(DEFAULT_DIFFICULTY);
    }
  });
});

describe('records are ranked-only', () => {
  const stats = (toPar: number): RoundStats =>
    ({
      toPar,
      birdies: 0,
      longestPuttMadeFt: 0,
      longestDriveYds: 0
    }) as unknown as RoundStats;

  const round = (total: number, ranked: boolean): RoundRecordInput => ({
    courseId: 'sablebay',
    courseName: 'Sable Bay',
    total,
    stats: stats(total - 12),
    ranked,
    now: 1
  });

  it('an unranked round sets no course best, even when it is the lowest', () => {
    const rec = emptyRecords();
    applyRoundRecords(rec, round(14, true));
    const events = applyRoundRecords(rec, round(9, false));
    expect(rec.bestByCourse.sablebay.total).toBe(14);
    expect(events.map((e) => e.id)).not.toContain('course_best');
    // ...and it did not silently claim the "best round anywhere" either.
    expect(rec.bestRoundToPar).toBe(2);
  });

  it('an unranked round does not END a par-or-better run built at Pro', () => {
    const rec = emptyRecords();
    applyRoundRecords(rec, round(11, true)); // under par, run = 1
    expect(rec.parOrBetterRun).toBe(1);
    applyRoundRecords(rec, round(20, false)); // a loose Beginner round
    expect(rec.parOrBetterRun).toBe(1);
  });

  it('still counts the round, so play at any difficulty is play', () => {
    const rec = emptyRecords();
    applyRoundRecords(rec, round(15, false));
    expect(rec.totalRounds).toBe(1);
  });

  it('defaults to ranked so every existing caller keeps its meaning', () => {
    const rec = emptyRecords();
    applyRoundRecords(rec, { courseId: 'c', courseName: 'C', total: 12, stats: stats(0), now: 1 });
    expect(rec.bestByCourse.c.total).toBe(12);
  });
});

describe('the shared record boards', () => {
  it('rank Pro and Expert rounds, and rounds recorded before the setting existed', () => {
    expect(rankedRound({ diff: 'pro' })).toBe(true);
    expect(rankedRound({ diff: 'expert' })).toBe(true);
    expect(rankedRound({})).toBe(true); // pre-difficulty round — was played at Pro
  });

  it('drop Beginner and Amateur rounds', () => {
    expect(rankedRound({ diff: 'beginner' })).toBe(false);
    expect(rankedRound({ diff: 'amateur' })).toBe(false);
  });

  it('every difficulty has a label and a blurb worth showing', () => {
    for (const d of DIFFICULTIES) {
      const p = difficultyProfile(d);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(10);
    }
  });
});

/**
 * THE PIXELS, NOT JUST THE MODEL.
 *
 * The difficulty setting shipped correct and looked broken: every tier drew a
 * band a few pixels wide with ~6px of white chrome painted over it, so Beginner
 * and Expert were indistinguishable on the bar. Every test we had measured the
 * model, and the model was right — so nothing failed. These measure what is
 * actually drawn.
 */
describe('the drawn band', () => {
  const BAR_PX = 356; // #meter at left:5%/right:5% on a 400px-wide phone
  const ctx = (d: (typeof DIFFICULTIES)[number]) => ({
    stat: 70,
    powerTarget: 0.8,
    isPutt: false,
    perfectMult: zoneMultFor(d)
  });
  const drawnPx = (d: (typeof DIFFICULTIES)[number]): number =>
    bandGeometry(0.5, perfectHalf(ctx(d))).width * BAR_PX;

  it('gets visibly wider as the difficulty gets easier', () => {
    const widths = DIFFICULTIES.map(drawnPx);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1]);
    // Not a rounding difference — the easiest band is nearly twice the hardest.
    expect(drawnPx('beginner') / drawnPx('expert')).toBeCloseTo(1.4 / 0.8, 6);
  });

  it('leaves green visible inside the outline at every difficulty', () => {
    // The worst case in the game: Expert, driver, from the fairway.
    const worst = bandGeometry(0.5, perfectHalf({ ...ctx('expert'), difficultyMult: 0.68 })).width * BAR_PX;
    const green = worst - outlinePx(worst) * 2;
    expect(green, `only ${green.toFixed(1)}px of band left inside the outline`).toBeGreaterThan(1.5);
  });

  it('never lets the outline outgrow its band', () => {
    for (const px of [3, 5, 8, 13, 14, 20, 40]) expect(outlinePx(px) * 2).toBeLessThan(px);
  });
});

describe('bandGeometry clamps to the bar', () => {
  it('reports the VISIBLE width when a band runs off the left edge', () => {
    // The accuracy bands sit at 0.08, so an easy difficulty's good band starts
    // at a negative offset — `#meter` is overflow:hidden, so the drawn band has
    // to say how much of it can actually be seen.
    const g = bandGeometry(0.08, 0.106);
    expect(g.left).toBe(0);
    expect(g.width).toBeCloseTo(0.186, 6);
  });

  it('clamps the right edge too, and never returns a negative width', () => {
    expect(bandGeometry(0.95, 0.2)).toEqual({ left: 0.75, width: 0.25 });
    expect(bandGeometry(1.5, 0.1).width).toBe(0);
  });

  it('is untouched when the band fits', () => {
    const g = bandGeometry(0.5, 0.02);
    expect(g.left).toBeCloseTo(0.48, 10);
    expect(g.width).toBeCloseTo(0.04, 10);
  });
});
