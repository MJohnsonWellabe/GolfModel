import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import wildwood from '../../src/data/courses/wildwood.json';
import sablebay from '../../src/data/courses/v2/sablebay.json';
import timberline from '../../src/data/courses/v2/timberline.json';
import portjohnson from '../../src/data/courses/v2/portjohnson.json';
import { TOUR_RIVALS } from '../../src/data/tourRivals';
import {
  completeTourRound,
  currentEvent,
  eventRoundsPlayed,
  finishSeason,
  MAJOR_NAMES,
  MAJOR_ROUNDS,
  mergeTour,
  migrateTour,
  newSeason,
  pointsForStandings,
  rolloverSeason,
  seasonDone,
  seasonStandings,
  TOUR_EVENTS,
  TOUR_MAJOR_IDXS,
  TOUR_POINTS,
  tourSchedule,
  TourStandingRow
} from '../../src/systems/TourSeason';
import { CourseData } from '../../src/core/types';

/**
 * THE TOUR SEASON — every promise the mode makes, checked headlessly: a
 * deterministic 16-event schedule with majors at 4/8/12/16, PGA-style points
 * with majors doubled and ties sharing, majors accumulating over three
 * rounds, a season that ends/crowns/rolls over, and a merge that can never
 * interleave two seasons.
 */

const COURSES: Record<string, CourseData> = {
  wildwood: loadCourse(wildwood as unknown as CourseAuthoring),
  sablebay: loadCourse(sablebay as unknown as CourseAuthoring),
  timberline: loadCourse(timberline as unknown as CourseAuthoring),
  portjohnson: loadCourse(portjohnson as unknown as CourseAuthoring)
};
const IDS = Object.keys(COURSES);

const row = (id: string, toPar: number, total: number, isPlayer = false): TourStandingRow => ({
  id,
  name: id,
  isPlayer,
  toPar,
  total
});

describe('the schedule', () => {
  it('16 events, majors at 4/8/12/16, the finale is the Grand Championship', () => {
    const sched = tourSchedule(42, IDS);
    expect(sched).toHaveLength(TOUR_EVENTS);
    sched.forEach((e, i) => {
      expect(e.idx).toBe(i);
      expect(IDS).toContain(e.courseId);
      const isMajor = (TOUR_MAJOR_IDXS as readonly number[]).includes(i);
      expect(e.major).toBe(isMajor);
      expect(e.rounds).toBe(isMajor ? MAJOR_ROUNDS : 1);
    });
    expect(sched[15].majorName).toBe('The Grand Championship');
    expect(TOUR_MAJOR_IDXS.map((i) => sched[i].majorName)).toEqual([...MAJOR_NAMES]);
  });

  it('is deterministic per seed, and different seeds move the rotation', () => {
    expect(tourSchedule(7, IDS)).toEqual(tourSchedule(7, IDS));
    // Offsets differ (seed mod pool size) — consecutive seeds start elsewhere.
    expect(tourSchedule(0, IDS)[0].courseId).not.toBe(tourSchedule(1, IDS)[0].courseId);
  });
});

describe('points', () => {
  it('pays the PGA-style table by finish, doubled at a major', () => {
    const standings = [row('player', -4, 8, true), ...TOUR_RIVALS.map((r, i) => row(r.id, i, 12 + i))];
    const pts = pointsForStandings(standings, false);
    expect(pts['player']).toBe(TOUR_POINTS[0]); // 500 for the win
    expect(pts[TOUR_RIVALS[0].id]).toBe(TOUR_POINTS[1]);
    expect(pts[TOUR_RIVALS[9].id]).toBe(TOUR_POINTS[10]); // last still scores
    const major = pointsForStandings(standings, true);
    expect(major['player']).toBe(TOUR_POINTS[0] * 2); // 1000 for a major
  });

  it('ties share the HIGHER points, competition style', () => {
    const standings = [row('a', -2, 9), row('b', -2, 9), row('c', 0, 11)];
    const pts = pointsForStandings(standings, false);
    expect(pts['a']).toBe(TOUR_POINTS[0]);
    expect(pts['b']).toBe(TOUR_POINTS[0]); // tied for 1st: both take 500
    expect(pts['c']).toBe(TOUR_POINTS[2]); // next rank skips to 3rd
  });
});

describe('a regular event', () => {
  it('one dominant round wins it: rank 1, 500 points, the schedule advances', () => {
    const s = newSeason(1234);
    const out = completeTourRound(s, COURSES, 3, -8, IDS)!; // birdied everything
    expect(out.eventDone).toBe(true);
    expect(out.playerRank).toBe(1);
    expect(out.pointsAwarded?.['player']).toBe(TOUR_POINTS[0]);
    expect(s.played).toBe(1);
    expect(s.activeEvent).toBeNull();
    // Every rival banked points too — the season table is 11 deep.
    expect(Object.keys(s.points)).toHaveLength(TOUR_RIVALS.length + 1);
    const table = seasonStandings(s);
    expect(table[0].isPlayer).toBe(true);
    // The event went into the season's results log — the hub's "past
    // results" page reads exactly this.
    expect(s.results).toHaveLength(1);
    expect(s.results[0]).toMatchObject({ idx: 0, playerRank: 1, points: TOUR_POINTS[0], winnerId: 'player' });
    expect(s.results[0].toPar).toBe(-8);
    // And it survives a storage round-trip.
    const revived = migrateTour(JSON.parse(JSON.stringify(s)))!;
    expect(revived.results).toEqual(s.results);
  });

  it('the results log accumulates one line per finished event', () => {
    const s = newSeason(4242);
    completeTourRound(s, COURSES, 11, 0, IDS);
    completeTourRound(s, COURSES, 12, 1, IDS);
    expect(s.results.map((r) => r.idx)).toEqual([0, 1]);
    for (const r of s.results) {
      expect(r.playerRank).toBeGreaterThanOrEqual(1);
      expect(r.playerRank).toBeLessThanOrEqual(TOUR_RIVALS.length + 1);
      expect(r.points).toBeGreaterThan(0); // all 11 finishers score
      expect(r.winnerId.length).toBeGreaterThan(0);
    }
  });

  it('the field is fixed by the season seed (no rerolls across devices)', () => {
    const a = newSeason(777);
    const b = newSeason(777);
    const outA = completeTourRound(a, COURSES, 10, -1, IDS)!;
    const outB = completeTourRound(b, COURSES, 14, 3, IDS)!;
    expect(outA.standings.filter((r) => !r.isPlayer).map((r) => r.total)).toEqual(
      outB.standings.filter((r) => !r.isPlayer).map((r) => r.total)
    );
  });
});

describe('a major', () => {
  it('accumulates across three rounds and pays double points', () => {
    const s = newSeason(555);
    s.played = TOUR_MAJOR_IDXS[0]; // walk up to the first major
    const def = currentEvent(s, IDS)!;
    expect(def.major).toBe(true);
    const r1 = completeTourRound(s, COURSES, 10, -1, IDS)!;
    expect(r1.eventDone).toBe(false);
    expect(eventRoundsPlayed(s)).toBe(1);
    expect(s.played).toBe(TOUR_MAJOR_IDXS[0]); // still the same event
    const r2 = completeTourRound(s, COURSES, 11, 0, IDS)!;
    expect(r2.eventDone).toBe(false);
    // Cumulative: the player's event total is both rounds so far.
    const me2 = r2.standings.find((r) => r.isPlayer)!;
    expect(me2.total).toBe(21);
    expect(me2.toPar).toBe(-1);
    const r3 = completeTourRound(s, COURSES, 3, -8, IDS)!; // storms home
    expect(r3.eventDone).toBe(true);
    expect(s.played).toBe(TOUR_MAJOR_IDXS[0] + 1);
    const me3 = r3.standings.find((r) => r.isPlayer)!;
    expect(me3.toPar).toBe(-9);
    // A major win pays double.
    if (r3.playerRank === 1) {
      expect(r3.pointsAwarded?.['player']).toBe(TOUR_POINTS[0] * 2);
    }
  });

  it('the banked rounds survive on the state (a resumable major)', () => {
    const s = newSeason(9);
    s.played = TOUR_MAJOR_IDXS[1];
    completeTourRound(s, COURSES, 12, 1, IDS);
    // Serialize/deserialize — closing the game between rounds.
    const revived = migrateTour(JSON.parse(JSON.stringify(s)))!;
    expect(eventRoundsPlayed(revived)).toBe(1);
    const r2 = completeTourRound(revived, COURSES, 11, 0, IDS)!;
    expect(r2.eventDone).toBe(false);
    expect(r2.standings.find((r) => r.isPlayer)!.total).toBe(23);
  });
});

describe('the season arc', () => {
  it('event 16 ends the season; the rollover starts fresh with rivals intact', () => {
    const s = newSeason(31337);
    s.played = TOUR_EVENTS - 1; // at the finale
    const def = currentEvent(s, IDS)!;
    expect(def.majorName).toBe('The Grand Championship');
    s.points['player'] = 4000; // a season already dominated
    for (let r = 0; r < MAJOR_ROUNDS; r++) completeTourRound(s, COURSES, 9, -2, IDS);
    expect(seasonDone(s)).toBe(true);
    expect(currentEvent(s, IDS)).toBeNull();
    const fin = finishSeason(s);
    expect(fin.playerRank).toBe(1);
    expect(fin.championId).toBe('player');
    expect(fin.coins).toBeGreaterThan(0);
    expect(fin.cp).toBeGreaterThan(0);
    const next = rolloverSeason(s, 999);
    expect(next.seasonNo).toBe(s.seasonNo + 1);
    expect(next.played).toBe(0);
    expect(next.points).toEqual({});
    expect(next.seed).toBe(999);
  });
});

// OWNERSHIP (owner: "assigning most of my wins to Charlotte... they were
// spread across pros"): a season used to have no memory of its own owner —
// every recording call re-read whichever Pro happened to be active AT THAT
// INSTANT, which drifted from whoever actually played it the moment more
// than one season ran in parallel. A season now carries its owner from the
// moment it's created, through rollover and a quit, independent of
// whatever the player's active Pro becomes afterward.
describe('season ownership', () => {
  it('newSeason stamps the given Pro; omitting one leaves no stamp at all (legacy shape)', () => {
    const owned = newSeason(1, 1, 'pro1', 'Ace');
    expect(owned.proId).toBe('pro1');
    expect(owned.proName).toBe('Ace');
    const unowned = newSeason(1);
    expect(unowned.proId).toBeUndefined();
    expect('proId' in unowned).toBe(false);
  });

  it('rolloverSeason carries the SAME owner forward, not whoever is active later', () => {
    const s = newSeason(1, 1, 'pro1', 'Ace');
    const next = rolloverSeason(s, 999);
    expect(next.proId).toBe('pro1');
    expect(next.proName).toBe('Ace');
  });

  it('rolloverSeason on a legacy (unowned) season stays unowned', () => {
    const s = newSeason(1);
    const next = rolloverSeason(s, 999);
    expect(next.proId).toBeUndefined();
  });

  it('migrateTour round-trips proId/proName, and omits them entirely when absent', () => {
    const owned = newSeason(9, 1, 'pro1', 'Ace');
    const revived = migrateTour(JSON.parse(JSON.stringify(owned)))!;
    expect(revived.proId).toBe('pro1');
    expect(revived.proName).toBe('Ace');
    const unowned = migrateTour(JSON.parse(JSON.stringify(newSeason(9))))!;
    expect('proId' in unowned).toBe(false);
  });
});

describe('merge and migrate', () => {
  it('the further-progressed season wins whole', () => {
    const ahead = newSeason(1);
    ahead.played = 5;
    const behind = newSeason(1);
    behind.played = 2;
    expect(mergeTour(behind, ahead)).toBe(ahead);
    const s2 = newSeason(2, 2);
    expect(mergeTour(ahead, s2)).toBe(s2); // a later season beats any progress
    // Same events played: more rounds into the current major wins.
    const majA = newSeason(3);
    majA.played = 3;
    completeTourRound(majA, COURSES, 12, 1, IDS);
    const majB = migrateTour(JSON.parse(JSON.stringify(majA)))!;
    completeTourRound(majB, COURSES, 11, 0, IDS);
    expect(mergeTour(majA, majB)).toBe(majB);
    expect(mergeTour(null, ahead)).toBe(ahead);
    expect(mergeTour(null, null)).toBeNull();
  });

  it('migrate rejects junk, heals partial copies, round-trips real state', () => {
    expect(migrateTour(undefined)).toBeNull();
    expect(migrateTour({})).toBeNull();
    expect(migrateTour({ seasonNo: 1 })).toBeNull(); // no seed
    const healed = migrateTour({ seasonNo: 1, seed: 5, played: 3, points: { player: 100, junk: -5 } })!;
    expect(healed.points).toEqual({ player: 100 }); // negative points dropped
    expect(healed.activeEvent).toBeNull();
    // A stale activeEvent (from an already-finished event) is discarded.
    const stale = migrateTour({ seasonNo: 1, seed: 5, played: 4, activeEvent: { idx: 3, playerTotals: [10], playerToPars: [1] } })!;
    expect(stale.activeEvent).toBeNull();
  });
});
