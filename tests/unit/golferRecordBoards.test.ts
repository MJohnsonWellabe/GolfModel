import { describe, expect, it } from 'vitest';
import {
  ArchivedTourSeason,
  golferRecordBoards,
  majorsGrid,
  MAJOR_NAMES,
  mergeTourHistory,
  newSeason,
  reassignArchivedSeason,
  reassignLiveSeason,
  recordTourEventWin,
  TOUR_MAJOR_IDXS,
  TourHistory,
  tourHistoryFromArchive
} from '../../src/systems/TourSeason';
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

  it('flattens season championships to one row per (golfer, season) win, ordered by season number', () => {
    const pros = [pro('a', 'Alpha'), pro('b', 'Bravo')];
    const hist: TourHistory = {
      a: {
        name: 'Alpha',
        wins: 2,
        majorWins: 0,
        majors: [],
        majorCounts: {},
        // Deliberately out of season-number order and with the LATER season
        // scoring FEWER points — proves the sort is by season number, not
        // by points (owner: "the season winners should order by season
        // number").
        seasons: [
          { seasonNo: 2, rank: 1, points: 1000 },
          { seasonNo: 1, rank: 1, points: 3105 }
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
    // career — both are real championships and both should appear, in
    // chronological order, independent of season-number collisions across
    // golfers (Bravo's un-won S1 never appears here at all) and independent
    // of which one scored more.
    expect(champs.entries.map((e) => [e.rank, e.name, e.label])).toEqual([
      [1, 'Alpha', 'S1 · 3105 pts'],
      [1, 'Alpha', 'S2 · 1000 pts']
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

/** A minimal archived season: `wins` are the 0-based event indices the
 *  player finished 1st in (drives both the win count and, via
 *  TOUR_MAJOR_IDXS, which of those wins were majors — mirrors how
 *  tourSchedule decides major-ness from idx alone, independent of seed). */
function archivedSeason(
  proId: string,
  proName: string,
  seasonNo: number,
  wins: number[],
  opts: { ended?: ArchivedTourSeason['ended']; totalEvents?: number } = {}
): ArchivedTourSeason {
  const totalEvents = opts.totalEvents ?? 16;
  const results = Array.from({ length: totalEvents }, (_, idx) => ({
    idx,
    playerRank: wins.includes(idx) ? 1 : 4,
    points: wins.includes(idx) ? 500 : 100,
    toPar: -2,
    winnerId: wins.includes(idx) ? 'player' : 'rival1'
  }));
  return {
    key: `solo:${seasonNo}`,
    seasonNo,
    proId,
    proName,
    at: 0,
    ended: opts.ended ?? 'finale',
    playerRank: 1,
    playerPoints: 1000,
    standings: [{ id: 'player', name: proName, isPlayer: true, total: 1000, toPar: -2 }],
    results
  };
}

describe('tourHistoryFromArchive', () => {
  it('reconstructs wins, majors and per-major counts purely from event index', () => {
    // idx 3 and 7 are both TOUR_MAJOR_IDXS — the Pro won the first major
    // twice (across two seasons) and the second major once, plus one
    // ordinary (non-major) event.
    const [major1, major2] = TOUR_MAJOR_IDXS;
    const archive = [
      archivedSeason('a', 'Alpha', 1, [major1, 0]),
      archivedSeason('a', 'Alpha', 2, [major1, major2])
    ];
    const hist = tourHistoryFromArchive(archive);
    expect(hist.a.wins).toBe(4); // major1 x2, major2 x1, event 0 x1
    expect(hist.a.majorWins).toBe(3);
    expect(hist.a.majorCounts).toEqual({ [MAJOR_NAMES[0]]: 2, [MAJOR_NAMES[1]]: 1 });
    expect(hist.a.majors.sort()).toEqual([MAJOR_NAMES[0], MAJOR_NAMES[1]].sort());
    expect(hist.a.seasons.map((s) => s.seasonNo)).toEqual([1, 2]);
  });

  it('records a quit season with its actual event count, not a full season', () => {
    const archive = [archivedSeason('a', 'Alpha', 1, [], { ended: 'quit', totalEvents: 6 })];
    const hist = tourHistoryFromArchive(archive);
    expect(hist.a.seasons[0]).toMatchObject({ seasonNo: 1, events: 6 });
  });

  it('skips an archive entry with no proId (never a real Pro to credit)', () => {
    const archive = [{ ...archivedSeason('', '', 1, [0]) }];
    expect(tourHistoryFromArchive(archive)).toEqual({});
  });

  it('fixes the reported bug: old data with majorWins/majors but no majorCounts gets its counts back via merge', () => {
    // Exactly the shape a pre-majorCounts save would have: majors/majorWins
    // say a Grand Slam happened, majorCounts is empty because that field
    // didn't exist yet — the grid would show every cell as zero.
    const staleHist: TourHistory = {
      a: { name: 'Alpha', wins: 4, majorWins: 4, majors: [...MAJOR_NAMES], majorCounts: {}, seasons: [] }
    };
    const archive = TOUR_MAJOR_IDXS.map((idx, i) => archivedSeason('a', 'Alpha', i + 1, [idx]));
    const reconciled = mergeTourHistory(staleHist, tourHistoryFromArchive(archive));
    expect(reconciled.a.majorCounts).toEqual(Object.fromEntries(MAJOR_NAMES.map((m) => [m, 1])));
    const grid = majorsGrid(reconciled, [pro('a', 'Alpha')]);
    expect(grid.columns[0]).toMatchObject({ name: 'Alpha', tag: ' — GRAND SLAM' });
    expect(grid.rows.map((r) => r.counts[0])).toEqual([1, 1, 1, 1]);
  });
});

/**
 * ONE-TIME REASSIGNMENT (owner: "this assigned a bunch of stuff to the
 * wrong pro... they were spread across pros" — the admin repair tool built
 * for the already-corrupted historical data). `mergeTourHistory` takes the
 * LARGER tally per Pro, so these tests specifically check that the OLD
 * (wrong) owner's stale, too-high counters actually go DOWN — re-stamping
 * the archive entry alone would leave them dominating the merge forever.
 */
describe('reassignArchivedSeason', () => {
  it('moves wins, a major, and the season line off the old owner and onto the new one', () => {
    const [major1] = TOUR_MAJOR_IDXS;
    const archive = [archivedSeason('charlotte', 'Charlotte', 4, [major1, 0])];
    const history = tourHistoryFromArchive(archive); // as if it was recorded live, same as the archive says
    const { archive: nextArchive, history: nextHistory } = reassignArchivedSeason(
      archive,
      history,
      'solo:4',
      'parker',
      'Parker'
    );
    expect(nextArchive[0]).toMatchObject({ proId: 'parker', proName: 'Parker' });
    expect(nextHistory.charlotte).toBeUndefined();
    expect(nextHistory.parker.wins).toBe(2);
    expect(nextHistory.parker.majorWins).toBe(1);
    expect(nextHistory.parker.majorCounts).toEqual({ [MAJOR_NAMES[0]]: 1 });
    expect(nextHistory.parker.majors).toEqual([MAJOR_NAMES[0]]);
    expect(nextHistory.parker.seasons.map((s) => s.seasonNo)).toEqual([4]);
  });

  it('leaves the old owner\'s OTHER seasons untouched — only this one moves', () => {
    const [major1] = TOUR_MAJOR_IDXS;
    const archive = [
      archivedSeason('charlotte', 'Charlotte', 1, [major1]),
      archivedSeason('charlotte', 'Charlotte', 2, [0])
    ];
    const history = tourHistoryFromArchive(archive);
    const { history: nextHistory } = reassignArchivedSeason(archive, history, 'solo:1', 'parker', 'Parker');
    // Season 2's plain win stays Charlotte's.
    expect(nextHistory.charlotte.wins).toBe(1);
    expect(nextHistory.charlotte.majorWins).toBe(0);
    expect(nextHistory.charlotte.seasons.map((s) => s.seasonNo)).toEqual([2]);
    // Season 1's major moves to Parker.
    expect(nextHistory.parker.wins).toBe(1);
    expect(nextHistory.parker.majorWins).toBe(1);
  });

  it('fixes the actual bug: a stale, too-high tally on the old owner stops beating the new owner in the merge', () => {
    // The exact failure mode: profile.tourHistory already has Charlotte
    // credited (built by the original buggy recording calls, same numbers
    // the archive itself says) — re-stamping the archive entry ALONE would
    // leave this stale copy, and mergeTourHistory's max-per-Pro would keep
    // showing Charlotte with the win forever.
    const [major1] = TOUR_MAJOR_IDXS;
    const archive = [archivedSeason('charlotte', 'Charlotte', 7, [major1])];
    const staleHistory = tourHistoryFromArchive(archive);
    const { archive: nextArchive, history: nextHistory } = reassignArchivedSeason(
      archive,
      staleHistory,
      'solo:7',
      'parker',
      'Parker'
    );
    const merged = mergeTourHistory(nextHistory, tourHistoryFromArchive(nextArchive));
    expect(merged.parker.majorWins).toBe(1);
    expect(merged.charlotte).toBeUndefined();
  });

  it('a quit season carries its actual event count to the new owner', () => {
    const archive = [archivedSeason('charlotte', 'Charlotte', 1, [], { ended: 'quit', totalEvents: 6 })];
    const history = tourHistoryFromArchive(archive);
    const { history: nextHistory } = reassignArchivedSeason(archive, history, 'solo:1', 'parker', 'Parker');
    expect(nextHistory.parker.seasons[0]).toMatchObject({ seasonNo: 1, events: 6 });
  });

  it('an unknown key is a no-op — fresh copies, nothing changed', () => {
    const archive = [archivedSeason('charlotte', 'Charlotte', 1, [0])];
    const history = tourHistoryFromArchive(archive);
    const { archive: nextArchive, history: nextHistory } = reassignArchivedSeason(
      archive,
      history,
      'solo:999',
      'parker',
      'Parker'
    );
    expect(nextArchive).toEqual(archive);
    expect(nextHistory).toEqual(history);
    expect(nextHistory.parker).toBeUndefined();
  });

  it('reassigning to the SAME owner it already has is a no-op', () => {
    const archive = [archivedSeason('charlotte', 'Charlotte', 1, [0])];
    const history = tourHistoryFromArchive(archive);
    const { history: nextHistory } = reassignArchivedSeason(archive, history, 'solo:1', 'charlotte', 'Charlotte');
    expect(nextHistory).toEqual(history);
  });
});

/** A live (not yet closed) season `proId`/`proName` owns, `wins` events deep
 *  into its results already — same idx-drives-major-ness convention as
 *  `archivedSeason`, just on a TourSeasonState instead of an archive entry. */
function liveSeason(proId: string, proName: string, seasonNo: number, wins: number[]): ReturnType<typeof newSeason> {
  const s = newSeason(seasonNo * 1000, seasonNo, proId, proName);
  const played = wins.length ? Math.max(...wins) + 1 : 0;
  s.played = played;
  s.results = Array.from({ length: played }, (_, idx) => ({
    idx,
    playerRank: wins.includes(idx) ? 1 : 4,
    points: wins.includes(idx) ? 500 : 100,
    toPar: -2,
    winnerId: wins.includes(idx) ? 'player' : 'rival1'
  }));
  return s;
}

/**
 * SEASON HAND-OFF (owner: "some users are saying they can't switch golfer
 * midway through the season and they should be able to" — the season-
 * ownership fix locks a season to its stamped owner, so this is the
 * explicit, opt-in way to move an ACTIVE, still-open season to a different
 * Pro, including whatever it's already earned).
 */
describe('reassignLiveSeason', () => {
  it('moves already-recorded wins and a major off the old owner and onto the new one', () => {
    const [major1] = TOUR_MAJOR_IDXS;
    const s = liveSeason('charlotte', 'Charlotte', 5, [major1, 0]);
    // As if these two wins had already been recorded live, event by event,
    // the way the real recording path does DURING a season — no season
    // line yet, since this one hasn't closed.
    const history: TourHistory = {};
    recordTourEventWin(history, 'charlotte', 'Charlotte', MAJOR_NAMES[0]);
    recordTourEventWin(history, 'charlotte', 'Charlotte');
    const { season, history: nextHistory } = reassignLiveSeason(s, history, 'parker', 'Parker');
    expect(season.proId).toBe('parker');
    expect(season.proName).toBe('Parker');
    expect(nextHistory.charlotte).toBeUndefined();
    expect(nextHistory.parker.wins).toBe(2);
    expect(nextHistory.parker.majorWins).toBe(1);
    expect(nextHistory.parker.majorCounts).toEqual({ [MAJOR_NAMES[0]]: 1 });
  });

  it('does not touch the season line — a live season has none to move yet', () => {
    const s = liveSeason('charlotte', 'Charlotte', 5, [0]);
    const history: TourHistory = {
      charlotte: { name: 'Charlotte', wins: 1, majorWins: 0, majors: [], majorCounts: {}, seasons: [] }
    };
    const { history: nextHistory } = reassignLiveSeason(s, history, 'parker', 'Parker');
    expect(nextHistory.parker.seasons).toEqual([]);
    expect(nextHistory.charlotte).toBeUndefined(); // wins moved, nothing left of the record
  });

  it('a season with nothing played yet hands off cleanly (no history to move)', () => {
    const s = liveSeason('charlotte', 'Charlotte', 5, []);
    const { season, history: nextHistory } = reassignLiveSeason(s, {}, 'parker', 'Parker');
    expect(season.proId).toBe('parker');
    expect(nextHistory).toEqual({});
  });

  it('hands off cleanly even when the old owner has no history record at all', () => {
    const s = liveSeason('charlotte', 'Charlotte', 5, [0]);
    const { history: nextHistory } = reassignLiveSeason(s, {}, 'parker', 'Parker');
    expect(nextHistory.parker.wins).toBe(1);
  });

  it('reassigning to the SAME owner it already has is a no-op', () => {
    const s = liveSeason('charlotte', 'Charlotte', 5, [0]);
    const history: TourHistory = {
      charlotte: { name: 'Charlotte', wins: 1, majorWins: 0, majors: [], majorCounts: {}, seasons: [] }
    };
    const { season, history: nextHistory } = reassignLiveSeason(s, history, 'charlotte', 'Charlotte');
    expect(season).toBe(s); // same reference — genuinely untouched
    expect(nextHistory).toEqual(history);
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
