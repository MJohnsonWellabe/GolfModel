import { describe, expect, it } from 'vitest';
import {
  applyHoleMastery,
  emptyMastery,
  holeStars,
  mergeMastery,
  migrateMastery,
  nextStarHint,
  starCount,
  HoleMasteryInput
} from '../src/systems/Mastery';
import { MASTERY_CHALLENGES, thirdStarFor } from '../src/data/masteryChallenges';

function hole(over: Partial<HoleMasteryInput> = {}): HoleMasteryInput {
  return { courseId: 'sablebay', holeNumber: 1, par: 4, strokes: 4, ...over };
}

describe('hole mastery stars', () => {
  it('par earns star 1, birdie earns stars 1+2', () => {
    const m = emptyMastery();
    const r1 = applyHoleMastery(m, hole({ strokes: 4 }), undefined);
    expect(r1.newStars).toEqual([1]);
    const r2 = applyHoleMastery(m, hole({ strokes: 3 }), undefined);
    expect(r2.newStars).toEqual([2]); // par star already earned, only birdie is new
    expect(holeStars(m, 'sablebay', 1)).toBe(3);
  });

  it('an over-par hole earns nothing', () => {
    const m = emptyMastery();
    expect(applyHoleMastery(m, hole({ strokes: 5 }), undefined).newStars).toEqual([]);
  });

  it('the authored third star fires from course data, once, and never again', () => {
    const m = emptyMastery();
    const def = thirdStarFor('sablebay', 1)!; // shoot 4 under or better (round-scale)
    const first = applyHoleMastery(m, hole({ strokes: 4, roundToPar: -4 }), def);
    expect(first.newStars).toContain(3);
    const again = applyHoleMastery(m, hole({ strokes: 4, roundToPar: -4 }), def);
    expect(again.newStars).toEqual([]); // duplicate-star prevention
  });

  it('the third star respects its condition (a -3 round is NOT enough at Sable Bay h1)', () => {
    const m = emptyMastery();
    const def = thirdStarFor('sablebay', 1)!;
    const r = applyHoleMastery(m, hole({ strokes: 4, roundToPar: -3 }), def);
    expect(r.newStars).toEqual([1]); // par star only — the hard star needs -4
  });

  it('the par-3 dagger needs the tee shot inside 10 feet', () => {
    const m = emptyMastery();
    const def = thirdStarFor('wildwood', 2)!;
    expect(applyHoleMastery(m, hole({ holeNumber: 2, par: 3, strokes: 3, approachFt: 12 }), def).newStars).toEqual([1]);
    const m2 = emptyMastery();
    expect(applyHoleMastery(m2, hole({ holeNumber: 2, par: 3, strokes: 3, approachFt: 8 }), def).newStars).toEqual([1, 3]);
  });

  it('the par-5 star needs an eagle, not a birdie', () => {
    const m = emptyMastery();
    const def = thirdStarFor('portjohnson', 3)!;
    expect(applyHoleMastery(m, hole({ holeNumber: 3, par: 5, strokes: 4 }), def).newStars).toEqual([1, 2]);
    const m2 = emptyMastery();
    expect(applyHoleMastery(m2, hole({ holeNumber: 3, par: 5, strokes: 3 }), def).newStars).toEqual([1, 2, 3]);
  });

  it('starCount totals per course and overall', () => {
    const m = emptyMastery();
    applyHoleMastery(m, hole({ strokes: 3 }), undefined); // 2 stars sablebay
    applyHoleMastery(m, hole({ courseId: 'wildwood', strokes: 4 }), undefined); // 1 star wildwood
    expect(starCount(m, 'sablebay')).toBe(2);
    expect(starCount(m, 'wildwood')).toBe(1);
    expect(starCount(m)).toBe(3);
  });

  it('merge unions stars (cross-device, never loses)', () => {
    const a = emptyMastery();
    const b = emptyMastery();
    applyHoleMastery(a, hole({ strokes: 4 }), undefined);
    applyHoleMastery(b, hole({ strokes: 3 }), undefined);
    const m = mergeMastery(a, b);
    expect(holeStars(m, 'sablebay', 1)).toBe(3);
  });

  it('migrate masks garbage to the 3-star bit range', () => {
    const m = migrateMastery({ stars: { 'sablebay:1': 255, 'x:9': 'bad' } });
    expect(m.stars['sablebay:1']).toBe(7);
    expect(m.stars['x:9']).toBeUndefined();
  });
});

describe('authored challenge data', () => {
  const HOLES = [1, 2, 3];
  const COURSES = ['sablebay', 'wildwood', 'timberline', 'portjohnson'];

  it('every hole of every course has exactly one authored third star', () => {
    for (const c of COURSES) {
      for (const h of HOLES) {
        const defs = MASTERY_CHALLENGES.filter((d) => d.courseId === c && d.holeNumber === h);
        expect(defs.length, `${c} hole ${h}`).toBe(1);
        expect(defs[0].id).toBe(`${c}:${h}`);
        expect(defs[0].name.length).toBeGreaterThan(0);
        expect(defs[0].desc.length).toBeGreaterThan(0);
      }
    }
  });

  it('each challenge is achievable on a career-best hole in a career-best round', () => {
    // An eagle with every box ticked, inside a -4 round with 2 putts total —
    // should satisfy EVERY authored challenge (proving none is impossible by
    // construction, even at the harder tuning).
    for (const def of MASTERY_CHALLENGES) {
      const great = hole({
        courseId: def.courseId,
        holeNumber: def.holeNumber,
        par: 4,
        strokes: 2, // eagle
        fairwayHit: true,
        gir: true,
        waterHit: false,
        sandHit: false,
        usedTrueVision: false,
        longestPuttFt: 22,
        approachFt: 4,
        onFire: true,
        windSpeed: 9,
        roundToPar: -4,
        roundPutts: 2
      });
      expect(def.test(great), def.id).toBe(true);
    }
  });

  it('nextStarHint proposes the easiest missing star first and null when complete', () => {
    const m = emptyMastery();
    const holes = [{ number: 1, par: 4 }, { number: 2, par: 3 }, { number: 3, par: 5 }];
    const hint = nextStarHint(m, 'sablebay', holes, MASTERY_CHALLENGES);
    expect(hint).toEqual({ holeNumber: 1, star: 1, label: 'Par hole 1 for a star' });
    for (const h of holes) m.stars[`sablebay:${h.number}`] = 7;
    expect(nextStarHint(m, 'sablebay', holes, MASTERY_CHALLENGES)).toBeNull();
  });
});
