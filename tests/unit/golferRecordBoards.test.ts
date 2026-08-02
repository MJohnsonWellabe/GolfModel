import { describe, expect, it } from 'vitest';
import { golferRecordBoards, MAJOR_NAMES, TourHistory } from '../../src/systems/TourSeason';
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

const BOARD_IDS = ['majors', 'wins', 'seasonPoints', 'seasonsPlayed', 'championships'];

describe('golferRecordBoards', () => {
  it('returns all five boards, empty, when no Pro has ever existed', () => {
    const boards = golferRecordBoards({}, []);
    expect(boards.map((b) => b.id)).toEqual(BOARD_IDS);
    for (const b of boards) expect(b.entries).toEqual([]);
  });

  it('omits a Pro with zero qualifying value from a section (no zero entries)', () => {
    const pros = [pro('p1', 'Fresh Pro')];
    const hist: TourHistory = { p1: { name: 'Fresh Pro', wins: 0, majorWins: 0, majors: [], seasons: [] } };
    const boards = golferRecordBoards(hist, pros);
    for (const b of boards) expect(b.entries).toEqual([]);
  });

  it('ranks by wins/majors desc, ties share a rank, and non-qualifiers are excluded', () => {
    const pros = [pro('a', 'Alpha'), pro('b', 'Bravo'), pro('c', 'Charlie')];
    const hist: TourHistory = {
      a: { name: 'Alpha', wins: 5, majorWins: 2, majors: [MAJOR_NAMES[0], MAJOR_NAMES[1]], seasons: [] },
      b: { name: 'Bravo', wins: 5, majorWins: 0, majors: [], seasons: [] },
      c: { name: 'Charlie', wins: 1, majorWins: 0, majors: [], seasons: [] }
    };
    const boards = golferRecordBoards(hist, pros);
    const wins = boards.find((b) => b.id === 'wins')!;
    expect(wins.entries.map((e) => [e.name, e.rank, e.label])).toEqual([
      ['Alpha', 1, '5'],
      ['Bravo', 1, '5'],
      ['Charlie', 3, '1']
    ]);
    const majors = boards.find((b) => b.id === 'majors')!;
    expect(majors.entries).toHaveLength(1);
    expect(majors.entries[0]).toMatchObject({
      name: 'Alpha',
      rank: 1,
      label: '2',
      sub: `${MAJOR_NAMES[0]} · ${MAJOR_NAMES[1]}`
    });
  });

  it('tags a career Grand Slam on the majors board', () => {
    const pros = [pro('a', 'Alpha')];
    const hist: TourHistory = {
      a: {
        name: 'Alpha',
        wins: 4,
        majorWins: 4,
        majors: [...MAJOR_NAMES],
        seasons: []
      }
    };
    const boards = golferRecordBoards(hist, pros);
    const majors = boards.find((b) => b.id === 'majors')!;
    expect(majors.entries[0].tag).toBe(' — GRAND SLAM');
  });

  it('best season points picks the single highest season, not a sum', () => {
    const pros = [pro('a', 'Alpha')];
    const hist: TourHistory = {
      a: {
        name: 'Alpha',
        wins: 0,
        majorWins: 0,
        majors: [],
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
    const hist: TourHistory = { gone: { name: 'Ghost', wins: 3, majorWins: 0, majors: [], seasons: [] } };
    const boards = golferRecordBoards(hist, []);
    const wins = boards.find((b) => b.id === 'wins')!;
    expect(wins.entries[0]).toMatchObject({ name: 'Ghost', label: '3' });
  });
});
