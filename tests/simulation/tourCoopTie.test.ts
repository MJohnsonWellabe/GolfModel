import { describe, expect, it } from 'vitest';
import {
  compareCountback,
  coopSeasonSettled,
  coopSeasonStandings,
  COOP_STALE_MS,
  finishSeason,
  newSeason,
  recomputeSeasonPoints,
  seasonCountback,
  TOUR_EVENTS,
  TOUR_POINTS,
  TourSeasonState
} from '../../src/systems/TourSeason';
import { TOUR_RIVALS } from '../../src/data/tourRivals';

/**
 * WHEN TWO REAL PLAYERS TIE (owner: "what will happen when two real users tie
 * in a tournament. how will that resolve").
 *
 * The load-bearing property is AGREEMENT: two phones holding mirror images of
 * the same shared season must name the same champion. The bug these tests
 * exist for was a tiebreak of `Number(b.isPlayer) - Number(a.isPlayer)` —
 * every device sorted ITSELF to the top, so both players were crowned.
 */

const IDS = ['wildwood', 'sablebay', 'timberline', 'portjohnson'];
const AI_TOPAR = 2; // the field is comfortably behind both humans

/**
 * Build ONE side of a shared season. `mine` and `theirs` are per-event toPar
 * arrays; the local player is whichever side this device belongs to.
 */
function sideOf(mine: number[], theirs: number[], meId: string, themId: string, themName = 'Sam'): TourSeasonState {
  const s = newSeason(4242);
  s.coop = {
    id: 'cs123456',
    playerId: meId,
    partners: [
      {
        playerId: themId,
        name: themName,
        results: Object.fromEntries(theirs.map((v, i) => [i, { total: 36 + v, toPar: v }])),
        updatedAt: Date.now()
      }
    ]
  };
  s.played = mine.length;
  mine.forEach((v, i) => {
    s.results.push({
      idx: i,
      playerRank: 1,
      points: 0,
      toPar: v,
      winnerId: 'player',
      total: 36 + v,
      field: TOUR_RIVALS.map(() => ({ total: 36 + AI_TOPAR, toPar: AI_TOPAR }))
    });
  });
  s.points = recomputeSeasonPoints(s, IDS, TOUR_RIVALS);
  return s;
}

/** The same season as the two players each see it. */
function bothSides(a: number[], b: number[]): { mine: TourSeasonState; theirs: TourSeasonState } {
  return {
    mine: sideOf(a, b, 'alice', 'bob', 'Bob'),
    theirs: sideOf(b, a, 'bob', 'alice', 'Alice')
  };
}

/** Who each device says won, as a stable id ('player' means "this device"). */
const championOn = (s: TourSeasonState): string => {
  const top = coopSeasonStandings(s)[0];
  return top.id === 'player' ? s.coop!.playerId : top.id;
};

describe('a tie inside one event', () => {
  it('pays both humans the winner points — nobody takes second', () => {
    const { mine } = bothSides([-5], [-5]);
    const pts = recomputeSeasonPoints(mine, IDS, TOUR_RIVALS);
    expect(pts['player']).toBe(TOUR_POINTS[0]);
    expect(pts['bob']).toBe(TOUR_POINTS[0]);
    // The AI field, beaten by both, shares third.
    expect(pts[TOUR_RIVALS[0].id]).toBe(TOUR_POINTS[2]);
  });

  it('and both devices compute it the same way', () => {
    const { mine, theirs } = bothSides([-5], [-5]);
    expect(recomputeSeasonPoints(mine, IDS, TOUR_RIVALS)['player']).toBe(
      recomputeSeasonPoints(theirs, IDS, TOUR_RIVALS)['player']
    );
  });
});

describe('a season-long tie', () => {
  it('BOTH DEVICES NAME THE SAME CHAMPION — the bug this suite exists for', () => {
    // Dead level on points, event for event.
    const { mine, theirs } = bothSides([-4, -2, -6], [-4, -2, -6]);
    expect(mine.points['player']).toBe(theirs.points['player']);
    expect(championOn(mine)).toBe(championOn(theirs));
    // …and they are not BOTH told they won.
    const iWon = coopSeasonStandings(mine)[0].isPlayer;
    const theyWon = coopSeasonStandings(theirs)[0].isPlayer;
    expect(iWon && theyWon).toBe(false);
  });

  it('breaks first on event wins', () => {
    const cb = {
      a: { wins: 3, strokes: 0, byEvent: { 0: 0, 1: 0 } },
      b: { wins: 1, strokes: 0, byEvent: { 0: -9, 1: -9 } } // better scores, fewer wins
    };
    expect(compareCountback('a', 'b', cb)).toBeLessThan(0);
  });

  it('counts wins from the real leaderboard, keyed by each human`s own id', () => {
    // Alice beats Bob and the field in every event she has played.
    const mine = sideOf([-9, -9], [-1, -1], 'alice', 'bob', 'Bob');
    const cb = seasonCountback(mine, TOUR_RIVALS);
    // Keyed by 'alice', NOT the local-only 'player' — that is what lets two
    // devices compare the same two names.
    expect(cb['player']).toBeUndefined();
    expect(cb['alice'].wins).toBe(2);
    expect(cb['bob'].wins).toBe(0);
    expect(cb['alice'].byEvent).toEqual({ 0: -9, 1: -9 });
  });

  it('then on head-to-head over the events both played', () => {
    const cb = {
      a: { wins: 2, strokes: 0, byEvent: { 0: -5, 1: -3, 2: -1 } },
      b: { wins: 2, strokes: 0, byEvent: { 0: -4, 1: -4, 2: -2 } }
    };
    // b beat a in events 1 and 2, a beat b in event 0 → b ahead.
    expect(compareCountback('a', 'b', cb)).toBeGreaterThan(0);
  });

  it('then on the aggregate over those same shared events', () => {
    const cb = {
      a: { wins: 1, strokes: 0, byEvent: { 0: -5, 1: -1 } },
      b: { wins: 1, strokes: 0, byEvent: { 0: -4, 1: -1 } } // level h2h (1-0-1)
    };
    expect(compareCountback('a', 'b', cb)).toBeLessThan(0); // a is -6 to b's -5
  });

  it('and can never end in a dead heat', () => {
    const cb = {
      alice: { wins: 1, strokes: 10, byEvent: { 0: -3 } },
      bob: { wins: 1, strokes: 10, byEvent: { 0: -3 } }
    };
    expect(compareCountback('alice', 'bob', cb)).toBeLessThan(0);
    expect(compareCountback('bob', 'alice', cb)).toBeGreaterThan(0);
    // Antisymmetric, so the two devices cannot disagree.
    expect(Math.sign(compareCountback('alice', 'bob', cb))).toBe(-Math.sign(compareCountback('bob', 'alice', cb)));
  });

  it('having played MORE events neither helps nor hurts the countback', () => {
    const cb = {
      a: { wins: 1, strokes: 0, byEvent: { 0: -3, 1: -9 } }, // a extra event
      b: { wins: 1, strokes: 0, byEvent: { 0: -3 } }
    };
    expect(compareCountback('a', 'b', cb)).toBe('a'.localeCompare('b')); // shared events are level
  });
});

describe('the crown counts the partner', () => {
  it('a friend ahead on points takes the season, not the local player', () => {
    // Bob out-scores Alice everywhere; on Alice's device SHE must not be champion.
    const alice = sideOf([-1, -1, -1], [-8, -8, -8], 'alice', 'bob', 'Bob');
    const fin = finishSeason(alice);
    expect(fin.championId).toBe('bob');
    expect(fin.playerRank).toBeGreaterThan(1);
  });

  it('a solo season is unaffected — the player still wins it outright', () => {
    const solo = newSeason(7);
    solo.points = { player: 5000, [TOUR_RIVALS[0].id]: 100 };
    expect(finishSeason(solo).championId).toBe('player');
  });
});

describe('when the result is final', () => {
  const partnered = (posted: number, updatedAt: number): TourSeasonState => {
    const s = newSeason(1);
    s.coop = {
      id: 'cs123456',
      playerId: 'me',
      partners: [
        {
          playerId: 'them',
          name: 'Sam',
          results: Object.fromEntries(Array.from({ length: posted }, (_, i) => [i, { total: 36, toPar: 0 }])),
          updatedAt
        }
      ]
    };
    return s;
  };

  it('a solo season is always settled', () => {
    expect(coopSeasonSettled(newSeason(1), Date.now())).toBe(true);
  });

  it('waits while the partner still has events to play', () => {
    expect(coopSeasonSettled(partnered(12, Date.now()), Date.now())).toBe(false);
  });

  it('settles the moment they finish all sixteen', () => {
    expect(coopSeasonSettled(partnered(TOUR_EVENTS, Date.now()), Date.now())).toBe(true);
  });

  it('settles anyway once a partner has gone quiet for a month', () => {
    const now = Date.now();
    const quiet = partnered(4, now - COOP_STALE_MS - 1);
    expect(coopSeasonSettled(quiet, now)).toBe(true);
    // …but not a day early.
    expect(coopSeasonSettled(partnered(4, now - COOP_STALE_MS + 60_000), now)).toBe(false);
  });

  it('a partner who never posted anything still frees the season eventually', () => {
    const s = partnered(0, 0); // no updatedAt at all
    expect(coopSeasonSettled(s, Date.now())).toBe(true);
  });
});
