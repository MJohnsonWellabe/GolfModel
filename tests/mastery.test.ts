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

describe('hole mastery — three progressive challenges per hole', () => {
  it('Sable Bay h1: par → birdie → flawless (fairway+GIR+one-putt)', () => {
    const def = thirdStarFor('sablebay', 1)!;
    // Star 1 only: a par with nothing else.
    const m1 = emptyMastery();
    expect(applyHoleMastery(m1, hole({ strokes: 4 }), def).newStars).toEqual([1]);
    // Star 1 + 2: a birdie by any means (chip-in, no GIR).
    const m2 = emptyMastery();
    expect(applyHoleMastery(m2, hole({ strokes: 3, gir: false }), def).newStars).toEqual([1, 2]);
    // All three: the flawless birdie (fairway, GIR, one putt → score 3).
    const m3 = emptyMastery();
    const r = applyHoleMastery(m3, hole({ strokes: 3, fairwayHit: true, gir: true, holePutts: 1 }), def);
    expect(r.newStars).toEqual([1, 2, 3]);
  });

  it('the par-3 dagger (Sable Bay h2 star 3) needs the tee shot inside 6 ft', () => {
    const def = thirdStarFor('sablebay', 2)!;
    const near = applyHoleMastery(emptyMastery(), hole({ holeNumber: 2, par: 3, strokes: 3, gir: true, approachFt: 8, waterHit: false }), def);
    expect(near.newStars).not.toContain(3); // 8 ft is not inside 6
    const stuck = applyHoleMastery(emptyMastery(), hole({ holeNumber: 2, par: 3, strokes: 3, gir: true, approachFt: 5, waterHit: false }), def);
    expect(stuck.newStars).toContain(3);
  });

  it('the par-5 top star (Sable Bay h3) needs an eagle, not a birdie', () => {
    const def = thirdStarFor('sablebay', 3)!;
    expect(applyHoleMastery(emptyMastery(), hole({ holeNumber: 3, par: 5, strokes: 4 }), def).newStars).toEqual([1, 2]);
    expect(applyHoleMastery(emptyMastery(), hole({ holeNumber: 3, par: 5, strokes: 3 }), def).newStars).toEqual([1, 2, 3]);
  });

  it('Wildwood h2 star 3: a birdie WITHOUT True Vision (a TV birdie stops at star 2)', () => {
    const def = thirdStarFor('wildwood', 2)!;
    const withTV = applyHoleMastery(emptyMastery(), hole({ courseId: 'wildwood', holeNumber: 2, par: 3, strokes: 2, gir: true, usedTrueVision: true }), def);
    expect(withTV.newStars).toEqual([1, 2]); // GIR + birdie, but TV used
    const noTV = applyHoleMastery(emptyMastery(), hole({ courseId: 'wildwood', holeNumber: 2, par: 3, strokes: 2, gir: true, usedTrueVision: false }), def);
    expect(noTV.newStars).toEqual([1, 2, 3]);
  });

  it('an over-par hole with no skill feats earns nothing', () => {
    const def = thirdStarFor('sablebay', 1)!;
    expect(applyHoleMastery(emptyMastery(), hole({ strokes: 6, waterHit: true }), def).newStars).toEqual([]);
  });

  it('stars are permanent and never re-awarded', () => {
    const m = emptyMastery();
    const def = thirdStarFor('sablebay', 1)!;
    applyHoleMastery(m, hole({ strokes: 3 }), def); // stars 1 + 2
    const again = applyHoleMastery(m, hole({ strokes: 3, fairwayHit: true, gir: true, holePutts: 1 }), def);
    expect(again.newStars).toEqual([3]); // only the NEW one
    expect(holeStars(m, 'sablebay', 1)).toBe(7);
  });

  it('starCount totals per course and overall', () => {
    const m = emptyMastery();
    m.stars['sablebay:1'] = 3; // 2 stars
    m.stars['wildwood:1'] = 1; // 1 star
    expect(starCount(m, 'sablebay')).toBe(2);
    expect(starCount(m, 'wildwood')).toBe(1);
    expect(starCount(m)).toBe(3);
  });

  it('merge unions stars (cross-device, never loses)', () => {
    const a = emptyMastery();
    const b = emptyMastery();
    a.stars['sablebay:1'] = 1;
    b.stars['sablebay:1'] = 6;
    expect(holeStars(mergeMastery(a, b), 'sablebay', 1)).toBe(7);
  });

  it('migrate masks garbage to the 3-star bit range', () => {
    const m = migrateMastery({ stars: { 'sablebay:1': 255, 'x:9': 'bad' } });
    expect(m.stars['sablebay:1']).toBe(7);
    expect(m.stars['x:9']).toBeUndefined();
  });
});

describe('authored challenge data', () => {
  const HOLES = [1, 2, 3];
  const COURSES = ['sablebay', 'wildwood', 'timberline', 'timberlinewest', 'portjohnson', 'redhollow', 'wildvalley'];

  it('every hole of every course authors exactly three named, described challenges', () => {
    for (const c of COURSES) {
      for (const h of HOLES) {
        const def = thirdStarFor(c, h);
        expect(def, `${c} hole ${h}`).toBeTruthy();
        expect(def!.id).toBe(`${c}:${h}`);
        expect(def!.stars).toHaveLength(3);
        for (const s of def!.stars) {
          expect(s.name.length).toBeGreaterThan(0);
          expect(s.desc.length).toBeGreaterThan(0);
          expect(typeof s.test).toBe('function');
        }
      }
    }
    expect(MASTERY_CHALLENGES).toHaveLength(21);
  });

  it('each hole ladder is fully clearable — some plausible play earns all three stars', () => {
    for (const def of MASTERY_CHALLENGES) {
      const isPar3 = def.holeNumber === 2;
      const isPar5 = def.holeNumber === 3;
      const par = isPar3 ? 3 : isPar5 ? 5 : 4;
      // A near-perfect play of THIS hole: an eagle reached cleanly, no hazards,
      // no True Vision, a long putt made, into wind, stuck tight.
      const great = hole({
        courseId: def.courseId,
        holeNumber: def.holeNumber,
        par,
        strokes: par - 2, // eagle
        fairwayHit: true,
        gir: true,
        holePutts: 1,
        waterHit: false,
        sandHit: false,
        usedTrueVision: false,
        longestPuttFt: 20,
        approachFt: 4,
        onFire: true,
        windSpeed: 10
      });
      const r = applyHoleMastery(emptyMastery(), great, def);
      expect(r.newStars, `${def.id} should be fully clearable`).toEqual([1, 2, 3]);
    }
  });

  it('nextStarHint proposes the first unearned star (easiest tier first) and null when complete', () => {
    const m = emptyMastery();
    const holes = [{ number: 1, par: 4 }, { number: 2, par: 3 }, { number: 3, par: 5 }];
    const hint = nextStarHint(m, 'sablebay', holes, MASTERY_CHALLENGES);
    expect(hint!.holeNumber).toBe(1);
    expect(hint!.star).toBe(1);
    expect(hint!.label).toContain('hole 1');
    for (const h of holes) m.stars[`sablebay:${h.number}`] = 7;
    expect(nextStarHint(m, 'sablebay', holes, MASTERY_CHALLENGES)).toBeNull();
  });
});
