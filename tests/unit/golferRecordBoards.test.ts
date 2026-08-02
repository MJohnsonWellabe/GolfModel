import { describe, expect, it } from 'vitest';
import { golferRecordBoards, majorsGrid, MAJOR_NAMES, recordTourEventWin, TourHistory } from '../../src/systems/TourSeason';
import type { CareerPro } from '../../src/data/career';

function pro(id: string, name: string): CareerPro {
  return {
    id,
    name,
    styleId: 'bigHitter',
    attrs: { drivingPower: 50, drivingAccuracy: 50, approach: 50, chipping: 50, putting: 50 },
    character: 'chip',
    createdAt: 0
  };
}

const BOARD_IDS = ['wins', 'seasonPoints', 'seasonsPlayed', 'championships'];

describe('golferRecordBoards', () => {
  it('returns all four boards, empty, when no Pro has ever existed', () => {
    const boards = golferRecordBoards({}, []);
    expect(boards.map((b) => b.id)).toEqual(BOARD_IDS);
    for (const b of boards) expect(b.entries).toEqual([]);
  });

  it('omits a Pro with zero qualifying value from a section (no zero entries)', () => {
    const pros = [pro('p1', 'Fresh Pro')];
    const hist: TourHistory = {
      p1: { name: 'Fresh Pro', wins: 0, majorWins: 0, majors: [], majorCounts: {}, seasons: [] }
    };
    const boards = golferRecordBoards(hist, pros);
    for (const b of boards) expect(b.entries).toEqual([]);
  });

  it('ranks tour wins desc, ties share a rank, and non-qualifiers are excluded', () => {
    const pros = [pro('a', 'Alpha'), pro('b', 'Bravo'), pro('c', 'Charlie')];
    const hist: TourHistory = {
      a: { name: 'Alpha', wins: 5, majorWins: 2, majors: [], majorCounts: {}, seasons: [] },
      b: { name: 'Bravo', wins: 5, majorWins: 0, majors: [], majorCounts: {}, seasons: [] },
      c: { name: 'Charlie', wins: 1, majorWins: 0, majors: [], majorCounts: {}, seasons: [] }
    };
    const boards = golferRecordBoards(hist, pros);
    const wins = boards.find((b) => b.id === 'wins')!;
    expect(wins.entries.map((e) => [e.name, e.rank, e.label])).toEqual([
      ['Alpha', 1, '5'],
      ['Bravo', 1, '5'],
      ['Charlie', 3, '1']
    ]);
  });

  it('best season points picks the single highest season, not a sum', () => {
    const pros = [pro('a', 'Alpha')];
    const hist: TourHistory = {
      a: {
        name: 'Alpha',
        wins: 0,
        majorWins: 0,
        majors: [],
        majorCounts: {},
        seasons: [
          { seasonNo: 1, rank: 3, points: 1240 },
          { seasonNo: 2, rank: 1, points: 3105 }
        ]
      }
    };
    const boards = golferRecordBoards(hist, pros);
    const seasonPoints = boards.find((b) => b.id === 'seasonPoints')!;
    expect(seasonPoints.entries[0].label).toBe('3105 pts (S2)');
    const seasonsPlayed = boards.find((b) => b.id === 'seasonsPlayed')!;
    expect(seasonsPlayed.entries[0].label).toBe('2/10');
  });

  it('flattens season championships to one row per (golfer, season) win, not per season number', () => {
    const pros = [pro('a', 'Alpha'), pro('b', 'Bravo')];
    const hist: TourHistory = {
      a: {
        name: 'Alpha',
        wins: 2,
        majorWins: 0,
        majors: [],
        majorCounts: {},
        seasons: [
          { seasonNo: 1, rank: 1, points: 1000 },
          { seasonNo: 2, rank: 1, points: 3105 }
        ]
      },
      b: {
        name: 'Bravo',
        wins: 0,
        majorWins: 0,
        majors: [],
        majorCounts: {},
        seasons: [{ seasonNo: 1, rank: 2, points: 900 }]
      }
    };
    const boards = golferRecordBoards(hist, pros);
    const champs = boards.find((b) => b.id === 'championships')!;
    // Alpha won two DIFFERENT seasons both numbered relative to their own
    // career — both are real championships and both should appear, ranked
    // by that season's points, independent of season-number collisions
    // across golfers (Bravo's un-won S1 never appears here at all).
    expect(champs.entries.map((e) => [e.name, e.label])).toEqual([
      ['Alpha', 'S2 · 3105 pts'],
      ['Alpha', 'S1 · 1000 pts']
    ]);
  });

  it('keeps a deleted Pro (gone from the stable but present in history)', () => {
    const hist: TourHistory = {
      gone: { name: 'Ghost', wins: 3, majorWins: 0, majors: [], majorCounts: {}, seasons: [] }
    };
    const boards = golferRecordBoards(hist, []);
    const wins = boards.find((b) => b.id === 'wins')!;
    expect(wins.entries[0]).toMatchObject({ name: 'Ghost', label: '3' });
  });
});

describe('recordTourEventWin', () => {
  it('keeps majorCounts and majors in lockstep, counting repeats majors alone cannot', () => {
    const hist: TourHistory = {};
    recordTourEventWin(hist, 'a', 'Alpha', MAJOR_NAMES[0]);
    recordTourEventWin(hist, 'a', 'Alpha', MAJOR_NAMES[0]);
    recordTourEventWin(hist, 'a', 'Alpha', MAJOR_NAMES[1]);
    recordTourEventWin(hist, 'a', 'Alpha'); // a non-major win — must not touch majorCounts
    expect(hist.a.majorWins).toBe(3);
    expect(hist.a.wins).toBe(4);
    expect(hist.a.majors.sort()).toEqual([MAJOR_NAMES[0], MAJOR_NAMES[1]].sort());
    expect(hist.a.majorCounts).toEqual({ [MAJOR_NAMES[0]]: 2, [MAJOR_NAMES[1]]: 1 });
  });
});

describe('majorsGrid', () => {
  it('has a column per golfer with at least one major win, none for a zero', () => {
    const pros = [pro('a', 'Alpha'), pro('b', 'Bravo')];
    const hist: TourHistory = {
      a: { name: 'Alpha', wins: 1, majorWins: 1, majors: [MAJOR_NAMES[0]], majorCounts: { [MAJOR_NAMES[0]]: 1 }, seasons: [] },
      b: { name: 'Bravo', wins: 4, majorWins: 0, majors: [], majorCounts: {}, seasons: [] }
    };
    const grid = majorsGrid(hist, pros);
    expect(grid.columns.map((c) => c.name)).toEqual(['Alpha']);
  });

  it('rows are the four majors in canonical order, columns ordered by total major wins desc', () => {
    const pros = [pro('a', 'Alpha'), pro('b', 'Bravo')];
    const hist: TourHistory = {
      a: {
        name: 'Alpha',
        wins: 3,
        majorWins: 2,
        majors: [MAJOR_NAMES[0], MAJOR_NAMES[1]],
        majorCounts: { [MAJOR_NAMES[0]]: 1, [MAJOR_NAMES[1]]: 1 },
        seasons: []
      },
      b: {
        name: 'Bravo',
        wins: 4,
        majorWins: 3,
        majors: [MAJOR_NAMES[0]],
        majorCounts: { [MAJOR_NAMES[0]]: 3 },
        seasons: []
      }
    };
    const grid = majorsGrid(hist, pros);
    // Bravo (3 major wins) outranks Alpha (2) despite Alpha having more
    // DISTINCT majors — the column order is total wins, not variety.
    expect(grid.columns.map((c) => c.name)).toEqual(['Bravo', 'Alpha']);
    expect(grid.rows.map((r) => r.major)).toEqual([...MAJOR_NAMES]);
    const spring = grid.rows.find((r) => r.major === MAJOR_NAMES[0])!;
    expect(spring.counts).toEqual([3, 1]); // [Bravo, Alpha] — 3x for Bravo, 1x for Alpha
    const summer = grid.rows.find((r) => r.major === MAJOR_NAMES[1])!;
    expect(summer.counts).toEqual([0, 1]); // Bravo never won it; Alpha once
  });

  it('tags a career Grand Slam', () => {
    const pros = [pro('a', 'Alpha')];
    const majorCounts = Object.fromEntries(MAJOR_NAMES.map((m) => [m, 1]));
    const hist: TourHistory = {
      a: { name: 'Alpha', wins: 4, majorWins: 4, majors: [...MAJOR_NAMES], majorCounts, seasons: [] }
    };
    const grid = majorsGrid(hist, pros);
    expect(grid.columns[0].tag).toBe(' — GRAND SLAM');
  });

  it('is empty when nobody has won a major', () => {
    const grid = majorsGrid({}, []);
    expect(grid.columns).toEqual([]);
    expect(grid.rows.every((r) => r.counts.length === 0)).toBe(true);
  });
});
