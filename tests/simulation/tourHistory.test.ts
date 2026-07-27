import { describe, expect, it } from 'vitest';
import {
  hasGrandSlam,
  MAJOR_NAMES,
  mergeTourHistory,
  proRetired,
  SEASON_LIMIT,
  seasonsCompleted,
  TOUR_EVENTS,
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
    recordTourEventWin(h, 'pro1', 'Ace');
    recordTourEventWin(h, 'pro1', 'Ace');
    recordTourEventWin(h, 'pro1', 'Ace', MAJOR_NAMES[0]);
    expect(h.pro1.wins).toBe(3);
    expect(h.pro1.majorWins).toBe(1);
    expect(h.pro1.name).toBe('Ace');
    expect(h.pro1.seasons).toEqual([]);
    expect(h.pro1.majors).toEqual([MAJOR_NAMES[0]]);
  });

  it('records stay per-golfer, and a rename sticks on the next record', () => {
    const h: TourHistory = {};
    recordTourEventWin(h, 'pro1', 'Ace');
    recordTourEventWin(h, 'pro2', 'Deuce', MAJOR_NAMES[0]);
    recordTourEventWin(h, 'pro1', 'Ace II');
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
    recordTourEventWin(h, 'pro1', 'Ace', MAJOR_NAMES[0]);
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
      good: { name: 'Ace', wins: 2, majorWins: 1, seasons: [{ seasonNo: 1, rank: 1, points: 900 }] }, // pre-`majors` save
      bad: { name: 'X', wins: 1, majorWins: 0, seasons: [{ seasonNo: 'one' }] }
    });
    expect(Object.keys(mixed)).toEqual(['good']);
    expect(mixed.good.wins).toBe(2);
    expect(mixed.good.majors).toEqual([]); // a pre-`majors` save backfills empty
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
    recordTourEventWin(a, 'pro1', 'Ace');
    recordTourEventWin(a, 'pro1', 'Ace', MAJOR_NAMES[0]);
    const b = migrateTourHistory(JSON.parse(JSON.stringify(a)));
    recordTourEventWin(b, 'pro1', 'Ace'); // b progressed further
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
    recordTourEventWin(a, 'pro1', 'Ace');
    const b: TourHistory = {};
    recordTourEventWin(b, 'pro2', 'Deuce', MAJOR_NAMES[0]);
    const merged = mergeTourHistory(a, b);
    expect(Object.keys(merged).sort()).toEqual(['pro1', 'pro2']);
    expect(merged.pro1.wins).toBe(1);
    expect(merged.pro2.majorWins).toBe(1);
  });

  it('does not mutate its inputs', () => {
    const a: TourHistory = {};
    recordTourEventWin(a, 'pro1', 'Ace');
    const b: TourHistory = {};
    recordTourEventWin(b, 'pro1', 'Ace');
    recordTourEventWin(b, 'pro1', 'Ace');
    const aCopy = JSON.parse(JSON.stringify(a));
    const bCopy = JSON.parse(JSON.stringify(b));
    mergeTourHistory(a, b);
    expect(a).toEqual(aCopy);
    expect(b).toEqual(bCopy);
  });
});

describe('the career limit', () => {
  it('a Pro retires after SEASON_LIMIT seasons, and not before', () => {
    const h: TourHistory = {};
    for (let n = 1; n < SEASON_LIMIT; n++) {
      recordTourSeasonFinish(h, 'pro1', 'Ace', n, 2, 1000);
      expect(seasonsCompleted(h, 'pro1')).toBe(n);
      expect(proRetired(h, 'pro1')).toBe(false);
    }
    recordTourSeasonFinish(h, 'pro1', 'Ace', SEASON_LIMIT, 1, 3000);
    expect(proRetired(h, 'pro1')).toBe(true);
    // Retirement is per-golfer: the next Pro starts a fresh career.
    expect(proRetired(h, 'pro2')).toBe(false);
    expect(seasonsCompleted(h, 'pro2')).toBe(0);
  });

  it('a re-recorded season cannot inflate the counter toward retirement', () => {
    const h: TourHistory = {};
    for (let i = 0; i < SEASON_LIMIT * 2; i++) recordTourSeasonFinish(h, 'pro1', 'Ace', 1, 1, 100);
    expect(seasonsCompleted(h, 'pro1')).toBe(1);
    expect(proRetired(h, 'pro1')).toBe(false);
  });
});

describe('the career grand slam', () => {
  it('needs all four majors — repeats of one do not count twice', () => {
    const h: TourHistory = {};
    recordTourEventWin(h, 'pro1', 'Ace', MAJOR_NAMES[0]);
    recordTourEventWin(h, 'pro1', 'Ace', MAJOR_NAMES[0]);
    recordTourEventWin(h, 'pro1', 'Ace', MAJOR_NAMES[1]);
    expect(h.pro1.majorWins).toBe(3);
    expect(h.pro1.majors).toEqual([MAJOR_NAMES[0], MAJOR_NAMES[1]]);
    expect(hasGrandSlam(h.pro1)).toBe(false);
    recordTourEventWin(h, 'pro1', 'Ace', MAJOR_NAMES[2]);
    recordTourEventWin(h, 'pro1', 'Ace', MAJOR_NAMES[3]);
    expect(hasGrandSlam(h.pro1)).toBe(true);
    expect(hasGrandSlam(undefined)).toBe(false);
  });

  it('the slam survives a cross-device merge that splits the four wins', () => {
    const a: TourHistory = {};
    recordTourEventWin(a, 'pro1', 'Ace', MAJOR_NAMES[0]);
    recordTourEventWin(a, 'pro1', 'Ace', MAJOR_NAMES[1]);
    const b: TourHistory = {};
    recordTourEventWin(b, 'pro1', 'Ace', MAJOR_NAMES[2]);
    recordTourEventWin(b, 'pro1', 'Ace', MAJOR_NAMES[3]);
    expect(hasGrandSlam(mergeTourHistory(a, b).pro1)).toBe(true);
  });
});

describe('a partial season on the record', () => {
  it('round-trips its event count through storage', () => {
    const h: TourHistory = {};
    recordTourSeasonFinish(h, 'pro1', 'Ace', 1, 3, 1240, 6);
    recordTourSeasonFinish(h, 'pro1', 'Ace', 2, 1, 3000); // played out in full
    expect(h.pro1.seasons[0].events).toBe(6);
    expect(h.pro1.seasons[1].events).toBeUndefined();
    expect(migrateTourHistory(JSON.parse(JSON.stringify(h)))).toEqual(h);
  });

  it('a malformed event count degrades to "full" rather than dropping the Pro', () => {
    // Losing one annotation is survivable; losing a whole career over a stray
    // number is not — so this field is the one exception to the drop rule.
    const h = migrateTourHistory({
      pro1: {
        name: 'Ace',
        wins: 3,
        majorWins: 1,
        majors: [],
        seasons: [
          { seasonNo: 1, rank: 2, points: 900, events: 'lots' },
          { seasonNo: 2, rank: 1, points: 2000, events: -4 }
        ]
      }
    });
    expect(h.pro1.wins).toBe(3); // the record survived
    expect(h.pro1.seasons).toHaveLength(2);
    expect(h.pro1.seasons[0].events).toBeUndefined();
    expect(h.pro1.seasons[1].events).toBeUndefined();
  });

  it('an events count at or beyond a full season is not stored as partial', () => {
    const h: TourHistory = {};
    recordTourSeasonFinish(h, 'pro1', 'Ace', 1, 1, 3000, TOUR_EVENTS);
    expect(h.pro1.seasons[0].events).toBeUndefined();
  });

  it('merging two devices keeps the DEEPER copy of the same season', () => {
    const a: TourHistory = {};
    recordTourSeasonFinish(a, 'pro1', 'Ace', 1, 5, 400, 4); // quit at 4 here
    const b: TourHistory = {};
    recordTourSeasonFinish(b, 'pro1', 'Ace', 1, 3, 900, 9); // played 9 there
    expect(mergeTourHistory(a, b).pro1.seasons[0]).toEqual({ seasonNo: 1, rank: 3, points: 900, events: 9 });
    expect(mergeTourHistory(b, a).pro1.seasons[0].events).toBe(9);
    // …and a season played to the finale beats any partial copy of it.
    const c: TourHistory = {};
    recordTourSeasonFinish(c, 'pro1', 'Ace', 1, 1, 3000);
    expect(mergeTourHistory(b, c).pro1.seasons[0].events).toBeUndefined();
    // Either way it is still ONE season against the career limit.
    expect(seasonsCompleted(mergeTourHistory(a, b), 'pro1')).toBe(1);
  });
});
