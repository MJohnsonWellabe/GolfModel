import { describe, expect, it } from 'vitest';
import {
  mergeTourHistory,
  migrateTourHistory,
  recordTourEventWin,
  recordTourSeasonFinish,
  TourHistory
} from '../../src/systems/TourSeason';

/**
 * PER-GOLFER TOUR RECORDS (owner pass 8 follow-up: "inside the tour screen
 * there should be a way to access past results by golfer. so I can see
 * career wins, major wins and season placements. for any golfer I've used").
 * The season state itself is discarded at rollover, so this history is the
 * ONLY durable record — these tests pin that it accumulates, survives
 * storage, and merges across devices without double-counting.
 */

describe('recording', () => {
  it('event wins accumulate; majors count both tallies', () => {
    const h: TourHistory = {};
    recordTourEventWin(h, 'pro1', 'Ace', false);
    recordTourEventWin(h, 'pro1', 'Ace', false);
    recordTourEventWin(h, 'pro1', 'Ace', true);
    expect(h.pro1.wins).toBe(3);
    expect(h.pro1.majorWins).toBe(1);
    expect(h.pro1.name).toBe('Ace');
    expect(h.pro1.seasons).toEqual([]);
  });

  it('records stay per-golfer, and a rename sticks on the next record', () => {
    const h: TourHistory = {};
    recordTourEventWin(h, 'pro1', 'Ace', false);
    recordTourEventWin(h, 'pro2', 'Deuce', true);
    recordTourEventWin(h, 'pro1', 'Ace II', false);
    expect(h.pro1.wins).toBe(2);
    expect(h.pro1.name).toBe('Ace II');
    expect(h.pro2.wins).toBe(1);
    expect(h.pro2.majorWins).toBe(1);
  });

  it('season finishes list per season and are idempotent by seasonNo', () => {
    const h: TourHistory = {};
    recordTourSeasonFinish(h, 'pro1', 'Ace', 1, 3, 1240);
    recordTourSeasonFinish(h, 'pro1', 'Ace', 2, 1, 3105);
    // A re-record of the same season (cloud replay, double-fire) REPLACES,
    // never duplicates.
    recordTourSeasonFinish(h, 'pro1', 'Ace', 2, 1, 3110);
    expect(h.pro1.seasons).toEqual([
      { seasonNo: 1, rank: 3, points: 1240 },
      { seasonNo: 2, rank: 1, points: 3110 }
    ]);
    expect(h.pro1.wins).toBe(0); // season finishes don't fabricate event wins
  });
});

describe('persistence', () => {
  it('round-trips through JSON', () => {
    const h: TourHistory = {};
    recordTourEventWin(h, 'pro1', 'Ace', true);
    recordTourSeasonFinish(h, 'pro1', 'Ace', 1, 2, 2000);
    expect(migrateTourHistory(JSON.parse(JSON.stringify(h)))).toEqual(h);
  });

  it('junk shapes coalesce to an empty history; bad entries drop whole', () => {
    expect(migrateTourHistory(undefined)).toEqual({});
    expect(migrateTourHistory(null)).toEqual({});
    expect(migrateTourHistory('nope')).toEqual({});
    expect(migrateTourHistory({ pro1: { name: 5, wins: 'many' } })).toEqual({});
    // A valid record survives beside a corrupt one.
    const mixed = migrateTourHistory({
      good: { name: 'Ace', wins: 2, majorWins: 1, seasons: [{ seasonNo: 1, rank: 1, points: 900 }] },
      bad: { name: 'X', wins: 1, majorWins: 0, seasons: [{ seasonNo: 'one' }] }
    });
    expect(Object.keys(mixed)).toEqual(['good']);
    expect(mixed.good.wins).toBe(2);
  });

  it('negative or fractional tallies are cleaned, not trusted', () => {
    const h = migrateTourHistory({
      p: { name: 'A', wins: -3, majorWins: 1.7, seasons: [] }
    });
    expect(h.p.wins).toBe(0);
    expect(h.p.majorWins).toBe(1);
  });
});

describe('cross-device merge', () => {
  it('per golfer: the larger tallies win (one copy is the other plus progress)', () => {
    const a: TourHistory = {};
    recordTourEventWin(a, 'pro1', 'Ace', false);
    recordTourEventWin(a, 'pro1', 'Ace', true);
    const b = migrateTourHistory(JSON.parse(JSON.stringify(a)));
    recordTourEventWin(b, 'pro1', 'Ace', false); // b progressed further
    const merged = mergeTourHistory(a, b);
    expect(merged.pro1.wins).toBe(3);
    expect(merged.pro1.majorWins).toBe(1);
  });

  it('seasons union by seasonNo — never duplicated, never lost', () => {
    const a: TourHistory = {};
    recordTourSeasonFinish(a, 'pro1', 'Ace', 1, 3, 1000);
    recordTourSeasonFinish(a, 'pro1', 'Ace', 2, 2, 2000);
    const b: TourHistory = {};
    recordTourSeasonFinish(b, 'pro1', 'Ace', 2, 2, 2000);
    recordTourSeasonFinish(b, 'pro1', 'Ace', 3, 1, 3000);
    const merged = mergeTourHistory(a, b);
    expect(merged.pro1.seasons.map((s) => s.seasonNo)).toEqual([1, 2, 3]);
  });

  it('golfers only on one side survive whole', () => {
    const a: TourHistory = {};
    recordTourEventWin(a, 'pro1', 'Ace', false);
    const b: TourHistory = {};
    recordTourEventWin(b, 'pro2', 'Deuce', true);
    const merged = mergeTourHistory(a, b);
    expect(Object.keys(merged).sort()).toEqual(['pro1', 'pro2']);
    expect(merged.pro1.wins).toBe(1);
    expect(merged.pro2.majorWins).toBe(1);
  });

  it('does not mutate its inputs', () => {
    const a: TourHistory = {};
    recordTourEventWin(a, 'pro1', 'Ace', false);
    const b: TourHistory = {};
    recordTourEventWin(b, 'pro1', 'Ace', false);
    recordTourEventWin(b, 'pro1', 'Ace', false);
    const aCopy = JSON.parse(JSON.stringify(a));
    const bCopy = JSON.parse(JSON.stringify(b));
    mergeTourHistory(a, b);
    expect(a).toEqual(aCopy);
    expect(b).toEqual(bCopy);
  });
});
