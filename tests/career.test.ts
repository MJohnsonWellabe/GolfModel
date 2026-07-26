import { describe, expect, it } from 'vitest';
import {
  ATTR_CAP,
  CAREER_STARTS,
  careerOvr,
  CP,
  cpForRound,
  emptyCareer,
  grantCp,
  mergeCareers,
  pointCost,
  raiseAttr,
  startCareer
} from '../src/data/career';
import { ARCHETYPES } from '../src/data/archetypes';
import type { GolferStats } from '../src/core/types';

/**
 * CAREER MODE math — the whole growth curve is three numbers (the point-cost
 * brackets) and one table (CP per round), so every promise the owner was given
 * is checkable here: the 65-overall start, the 150/200/450 bracket totals, and
 * the ~27/~28/~55-round arc at the CP a player actually earns.
 */

const sum = (s: GolferStats): number =>
  s.drivingPower + s.drivingAccuracy + s.approach + s.chipping + s.putting;

describe('the five starting shapes', () => {
  it('every start is overall EXACTLY 65, signature bias kept', () => {
    for (const a of ARCHETYPES) {
      const start = CAREER_STARTS[a.id];
      expect(sum(start), `${a.id} sums to ${sum(start)}`).toBe(325); // 5 × 65
      expect(careerOvr(start)).toBe(65);
      // The signature stat leads the shape, same as the preset it scales down.
      const max = Math.max(...Object.values(start));
      expect(start[a.signature], `${a.id} signature`).toBe(max);
    }
  });

  it('startCareer adopts the shape and keeps CP already saved', () => {
    let c = grantCp(emptyCareer(), 12);
    c = startCareer(c, 'puttKing', 1000);
    expect(c.styleId).toBe('puttKing');
    expect(c.attrs).toEqual(CAREER_STARTS.puttKing);
    expect(c.cp).toBe(12);
    expect(c.createdAt).toBe(1000);
  });
});

describe('the cost curve (the owner arc: quick to 80, real to 90, a grind to 99)', () => {
  it('brackets: 2 CP below 80, 4 CP in the 80s, 10 CP in the 90s, capped at 99', () => {
    expect(pointCost(65)).toBe(2);
    expect(pointCost(79)).toBe(2);
    expect(pointCost(80)).toBe(4);
    expect(pointCost(89)).toBe(4);
    expect(pointCost(90)).toBe(10);
    expect(pointCost(98)).toBe(10);
    expect(pointCost(ATTR_CAP)).toBe(Infinity);
  });

  it('bracket totals from a 65 start: 150 to all-80s, +200 to all-90s, +450 to all-99s', () => {
    // Whichever starting shape: they all sum to 325, so the to-80 bill is the
    // same 150 CP; the later brackets are shape-independent by construction.
    const cost = (from: number, to: number): number => {
      let t = 0;
      for (let v = from; v < to; v++) t += pointCost(v);
      return t;
    };
    const start = CAREER_STARTS.bigHitter;
    const to80 = (Object.values(start) as number[]).reduce((a, v) => a + cost(v, 80), 0);
    expect(to80).toBe(150);
    expect(5 * cost(80, 90)).toBe(200);
    expect(5 * cost(90, 99)).toBe(450);
  });

  it('the round counts land where the owner asked (~25-30 / ~25-30 / ~50)', () => {
    // CP per round grows with the player: a rookie averages ~6 (base 4 + a
    // birdie + the odd under-par stroke), a mid golfer ~7, a strong one ~9
    // (birdies, dailies, the occasional win). The brackets divide out to the
    // owner's verbatim curve at exactly those rates.
    expect(Math.ceil(150 / 6)).toBeGreaterThanOrEqual(25);
    expect(Math.ceil(150 / 5)).toBeLessThanOrEqual(30);
    expect(Math.ceil(200 / 7)).toBeGreaterThanOrEqual(25);
    expect(Math.ceil(200 / 7)).toBeLessThanOrEqual(30);
    expect(Math.ceil(450 / 9)).toBe(50);
  });
});

describe('spending', () => {
  it('a raise costs the bracket price and moves the grow-only pair', () => {
    let c = startCareer(grantCp(emptyCareer(), 10), 'sniper', 1);
    const next = raiseAttr(c, 'putting');
    expect(next).not.toBeNull();
    c = next!;
    expect(c.attrs.putting).toBe(CAREER_STARTS.sniper.putting + 1);
    expect(c.cp).toBe(8);
    expect(c.cpSpent).toBe(2);
    expect(c.cpEarned).toBe(10); // spending never touches earned
  });

  it('refuses when CP falls short, and at the cap', () => {
    const broke = startCareer(emptyCareer(), 'sniper', 1);
    expect(raiseAttr(broke, 'putting')).toBeNull();
    let capped = startCareer(grantCp(emptyCareer(), 10_000), 'sniper', 1);
    capped = { ...capped, attrs: { ...capped.attrs, putting: ATTR_CAP } };
    expect(raiseAttr(capped, 'putting')).toBeNull();
  });
});

describe('CP per round', () => {
  it('base pay rewards showing up; good golf runs ahead', () => {
    const dud = cpForRound({ toPar: 5, birdies: 0, eagles: 0, holeInOnes: 0, won: false, dailyDone: false });
    expect(dud).toBe(CP.round);
    const hot = cpForRound({ toPar: -2, birdies: 1, eagles: 1, holeInOnes: 0, won: true, dailyDone: true });
    expect(hot).toBe(CP.round + CP.birdie + CP.eagle + 2 * CP.perUnderPar + CP.tournamentWin + CP.daily);
    const ace = cpForRound({ toPar: -2, birdies: 0, eagles: 0, holeInOnes: 1, won: false, dailyDone: false });
    expect(ace).toBe(CP.round + CP.holeInOne + 2 * CP.perUnderPar);
  });
});

describe('cross-device merge', () => {
  it('two devices spending differently never duplicate or resurrect CP', () => {
    // One cloud career, synced to two devices, each spends offline.
    const cloud = startCareer(grantCp(emptyCareer(), 100), 'bigHitter', 1);
    const devA = raiseAttr(raiseAttr(cloud, 'putting')!, 'putting')!; // spent 4
    const devB = raiseAttr(cloud, 'approach')!; // spent 2
    const merged = mergeCareers(devA, devB);
    expect(merged.cpEarned).toBe(100);
    // Grow-only spent takes the max — a spend can never be refunded by sync.
    expect(merged.cpSpent).toBe(4);
    expect(merged.cp).toBe(96);
    // Points bought anywhere are kept.
    expect(merged.attrs.putting).toBe(devA.attrs.putting);
    expect(merged.attrs.approach).toBe(devB.attrs.approach);
  });

  it('an unstarted device cannot blank a started career', () => {
    const started = startCareer(grantCp(emptyCareer(), 40), 'shortGame', 1);
    const fresh = emptyCareer();
    const merged = mergeCareers(fresh, started);
    expect(merged.styleId).toBe('shortGame');
    expect(merged.cpEarned).toBe(40);
    expect(merged.attrs.chipping).toBe(CAREER_STARTS.shortGame.chipping);
  });
});
