import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import wildwood from '../../src/data/courses/wildwood.json';
import { TOUR_RIVALS } from '../../src/data/tourRivals';
import {
  completeTourPlayoffHole,
  completeTourRound,
  MAX_PLAYOFF_HOLES,
  mergeTour,
  migrateTour,
  newSeason,
  playoffPending,
  pointsForStandings,
  TOUR_POINTS,
  TourSeasonState,
  TourStandingRow
} from '../../src/systems/TourSeason';
import { CourseData } from '../../src/core/types';

/**
 * THE SUDDEN-DEATH PLAYOFF (owner pass 8: "If the user is involved in a tie,
 * it should go into a playoff hole where they play the ai ghosts"). Player
 * tied for the lead after regulation → the event HOLDS un-finalized while
 * extra holes run; an outright winner takes 1st alone and the rest of the
 * tie shares 2nd. AI–AI ties (player not involved) share points as ever.
 */

const COURSES: Record<string, CourseData> = {
  wildwood: loadCourse(wildwood as unknown as CourseAuthoring)
};
const IDS = ['wildwood'];
const R = TOUR_RIVALS.map((r) => r.id);

/** A regulation-complete event 0 (one round) with the player and the first
 *  `tiedRivals` rivals locked on the same score, everyone else behind. */
function tiedSeason(tiedRivals: number, seed = 99): TourSeasonState {
  const s = newSeason(seed);
  s.activeEvent = {
    idx: 0,
    playerTotals: [10],
    playerToPars: [-2],
    fieldTotals: TOUR_RIVALS.map((_, i) => [i < tiedRivals ? 10 : 14]),
    fieldToPars: TOUR_RIVALS.map((_, i) => [i < tiedRivals ? -2 : 2])
  };
  return s;
}

describe('entering the playoff', () => {
  it('a player tied for the lead holds the event open instead of finalizing', () => {
    // Probe the deterministic field, then re-play the same seed matching the
    // leader exactly — the tie must arm sudden death through the REAL
    // completeTourRound path, simulator and all.
    const probe = newSeason(31337);
    const probed = completeTourRound(probe, COURSES, 99, 87, IDS)!;
    expect(probed.eventDone).toBe(true); // player miles behind: no playoff
    const leader = probed.standings[0];
    expect(leader.isPlayer).toBe(false);
    const s = newSeason(31337);
    const out = completeTourRound(s, COURSES, leader.total, leader.toPar, IDS)!;
    expect(out.eventDone).toBe(false);
    expect(out.playoff?.tiedRivalIds).toContain(leader.id);
    expect(s.played).toBe(0); // schedule did NOT advance
    expect(s.results).toHaveLength(0); // no result line
    expect(Object.keys(s.points)).toHaveLength(0); // no points paid
    expect(s.activeEvent?.playoff?.holes).toEqual([]);
  });

  it('an AI–AI tie without the player never arms a playoff', () => {
    // Two rivals tied on top, the player well behind: nobody watches a
    // playoff they are not in — the tie shares points, competition style
    // (the shared-points math itself is pinned in the resolution suite).
    const s = tiedSeason(0);
    s.activeEvent!.playerTotals = [20];
    s.activeEvent!.playerToPars = [8];
    s.activeEvent!.fieldTotals[0] = [10];
    s.activeEvent!.fieldToPars[0] = [-2];
    s.activeEvent!.fieldTotals[1] = [10];
    s.activeEvent!.fieldToPars[1] = [-2];
    expect(playoffPending(s, IDS)).toBeNull();
    expect(completeTourPlayoffHole(s, IDS, 3, {})).toBeNull();
  });

  it('playoffPending self-heals when the stored playoff field was dropped', () => {
    const s = tiedSeason(2);
    expect(s.activeEvent!.playoff).toBeUndefined();
    const pending = playoffPending(s, IDS)!;
    expect(pending.tiedRivalIds).toEqual([R[0], R[1]]);
    expect(pending.holesPlayed).toBe(0);
    expect(s.activeEvent!.playoff).toBeTruthy(); // re-armed in place
  });

  it('no pending playoff mid-event or when the player is not tied on top', () => {
    const mid = tiedSeason(2);
    mid.activeEvent!.playerTotals = []; // regulation not complete
    mid.activeEvent!.playerToPars = [];
    expect(playoffPending(mid, IDS)).toBeNull();
    const behind = tiedSeason(0); // nobody ties the player… but player LEADS
    expect(playoffPending(behind, IDS)).toBeNull();
  });
});

describe('sudden death resolution', () => {
  it('the player alone at the low score wins: 1st alone, losers share 2nd', () => {
    const s = tiedSeason(2);
    const out = completeTourPlayoffHole(s, IDS, 3, { [R[0]]: 4, [R[1]]: 5 })!;
    expect(out.eventDone).toBe(true);
    expect(out.playoffWinnerId).toBe('player');
    expect(out.playerRank).toBe(1);
    expect(out.pointsAwarded!['player']).toBe(TOUR_POINTS[0]);
    expect(out.pointsAwarded![R[0]]).toBe(TOUR_POINTS[1]);
    expect(out.pointsAwarded![R[1]]).toBe(TOUR_POINTS[1]);
    // The rest of the field is untouched by the override.
    expect(out.pointsAwarded![R[2]]).toBe(TOUR_POINTS[3]);
    expect(s.played).toBe(1);
    expect(s.results[0].winnerId).toBe('player');
    expect(s.results[0].playerRank).toBe(1);
    expect(s.activeEvent).toBeNull();
  });

  it('a rival strictly below the player takes it; the player shares 2nd', () => {
    const s = tiedSeason(2);
    const out = completeTourPlayoffHole(s, IDS, 4, { [R[0]]: 5, [R[1]]: 3 })!;
    expect(out.eventDone).toBe(true);
    expect(out.playoffWinnerId).toBe(R[1]);
    expect(out.playerRank).toBe(2);
    expect(out.pointsAwarded![R[1]]).toBe(TOUR_POINTS[0]);
    expect(out.pointsAwarded!['player']).toBe(TOUR_POINTS[1]);
    expect(out.pointsAwarded![R[0]]).toBe(TOUR_POINTS[1]);
    expect(s.results[0].winnerId).toBe(R[1]);
  });

  it('two rivals below the player: the lowest wins, leaderboard order breaks a tie', () => {
    const low = tiedSeason(2);
    expect(completeTourPlayoffHole(low, IDS, 5, { [R[0]]: 4, [R[1]]: 3 })!.playoffWinnerId).toBe(R[1]);
    const tie = tiedSeason(2);
    expect(completeTourPlayoffHole(tie, IDS, 5, { [R[0]]: 3, [R[1]]: 3 })!.playoffWinnerId).toBe(R[0]);
  });

  it('a re-tie continues with only the survivors', () => {
    const s = tiedSeason(3);
    // Rival 2 blows up (worse than the player), rivals 0 and 1 match the 3.
    const out = completeTourPlayoffHole(s, IDS, 3, { [R[0]]: 3, [R[1]]: 3, [R[2]]: 6 })!;
    expect(out.eventDone).toBe(false);
    expect(out.playoff?.tiedRivalIds).toEqual([R[0], R[1]]);
    expect(playoffPending(s, IDS)!.tiedRivalIds).toEqual([R[0], R[1]]);
    expect(playoffPending(s, IDS)!.holesPlayed).toBe(1);
    // Next hole: only survivors count; rival 0 wins it.
    const out2 = completeTourPlayoffHole(s, IDS, 4, { [R[0]]: 3, [R[1]]: 4 })!;
    expect(out2.eventDone).toBe(true);
    expect(out2.playoffWinnerId).toBe(R[0]);
  });

  it(`still tied after ${MAX_PLAYOFF_HOLES} holes: the player takes it`, () => {
    const s = tiedSeason(1);
    for (let h = 0; h < MAX_PLAYOFF_HOLES - 1; h++) {
      const out = completeTourPlayoffHole(s, IDS, 3, { [R[0]]: 3 })!;
      expect(out.eventDone).toBe(false);
    }
    const last = completeTourPlayoffHole(s, IDS, 3, { [R[0]]: 3 })!;
    expect(last.eventDone).toBe(true);
    expect(last.playoffWinnerId).toBe('player');
    expect(last.playerRank).toBe(1);
  });

  it('pointsForStandings without a winner override shares as ever', () => {
    const rows: TourStandingRow[] = [
      { id: 'player', name: 'You', isPlayer: true, toPar: -2, total: 10 },
      { id: 'a', name: 'a', isPlayer: false, toPar: -2, total: 10 },
      { id: 'b', name: 'b', isPlayer: false, toPar: 0, total: 12 }
    ];
    const shared = pointsForStandings(rows, false);
    expect(shared['player']).toBe(TOUR_POINTS[0]);
    expect(shared['a']).toBe(TOUR_POINTS[0]);
    expect(shared['b']).toBe(TOUR_POINTS[2]);
    const decided = pointsForStandings(rows, false, 'a');
    expect(decided['a']).toBe(TOUR_POINTS[0]);
    expect(decided['player']).toBe(TOUR_POINTS[1]);
    expect(decided['b']).toBe(TOUR_POINTS[2]);
  });
});

describe('persistence', () => {
  it('migrateTour round-trips a live playoff', () => {
    const s = tiedSeason(2);
    completeTourPlayoffHole(s, IDS, 3, { [R[0]]: 3, [R[1]]: 3 }); // re-tie: still live
    const back = migrateTour(JSON.parse(JSON.stringify(s)))!;
    expect(back.activeEvent?.playoff).toEqual(s.activeEvent?.playoff);
    expect(playoffPending(back, IDS)!.holesPlayed).toBe(1);
  });

  it('a corrupt stored playoff is dropped, and the event re-arms from scratch', () => {
    const s = tiedSeason(2);
    const raw = JSON.parse(JSON.stringify(s));
    raw.activeEvent.playoff = { tiedRivalIds: [R[0]], holes: [{ player: 'NaN?', rivals: {} }] };
    const back = migrateTour(raw)!;
    expect(back.activeEvent?.playoff).toBeUndefined();
    const pending = playoffPending(back, IDS)!;
    expect(pending.tiedRivalIds).toEqual([R[0], R[1]]); // re-derived, not the corrupt copy
    expect(pending.holesPlayed).toBe(0);
  });

  it('mergeTour prefers the copy deeper into sudden death at equal progress', () => {
    const a = tiedSeason(2);
    const b = migrateTour(JSON.parse(JSON.stringify(tiedSeason(2))))!;
    completeTourPlayoffHole(b, IDS, 3, { [R[0]]: 3, [R[1]]: 3 });
    expect(mergeTour(a, b)).toBe(b);
    expect(mergeTour(b, a)).toBe(b);
  });
});
