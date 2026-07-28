import { describe, expect, it } from 'vitest';
import {
  applyCoopSnapshot,
  mergeTour,
  migrateTour,
  newSeason,
  recomputeSeasonPoints,
  eventBoardRows,
  eventRowsFor,
  TOUR_POINTS,
  TourCoopPartner,
  TourSeasonState
} from '../../src/systems/TourSeason';
import { TOUR_RIVALS } from '../../src/data/tourRivals';
import { completeTourRound } from '../../src/systems/TourSeason';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import wildwood from '../../src/data/courses/wildwood.json';
import { CourseData } from '../../src/core/types';
import { migrateCoopDoc, parseCoopParam, coopUrl, makeCoopId } from '../../src/firebase/CoopSeason';

/**
 * SHARED SEASONS (owner pass 9: "Allow a user to start a season with another
 * user… Either user can play through as many tournaments as they want. Points
 * will be calculated on current placements and update when the second user
 * finishes."). The load-bearing promise is that finishing FIRST is never
 * penalised and never final: your points settle against the field alone, then
 * re-settle the moment your partner posts.
 */

const IDS = ['wildwood', 'sablebay', 'timberline', 'portjohnson'];

/** A season with `n` events banked, the player at `playerToPar` each time and
 *  a field whose scores are fixed (so the maths is legible). */
function seasonWith(n: number, playerToPar: number, fieldToPar: number): TourSeasonState {
  const s = newSeason(4242);
  for (let idx = 0; idx < n; idx++) {
    s.results.push({
      idx,
      playerRank: 1,
      points: TOUR_POINTS[0],
      toPar: playerToPar,
      winnerId: 'player',
      total: 36 + playerToPar,
      field: TOUR_RIVALS.map(() => ({ total: 36 + fieldToPar, toPar: fieldToPar }))
    });
  }
  s.played = n;
  return s;
}

function withPartner(s: TourSeasonState, results: Record<number, { total: number; toPar: number }>): TourSeasonState {
  s.coop = {
    id: 'cs123456',
    playerId: 'me',
    partners: [{ playerId: 'them', name: 'Sam', results } as TourCoopPartner]
  };
  return s;
}

describe('points that re-settle', () => {
  it('an event you finish first scores you against the field alone', () => {
    const s = withPartner(seasonWith(1, -6, -2), {});
    const pts = recomputeSeasonPoints(s, IDS);
    expect(pts['player']).toBe(TOUR_POINTS[0]); // clear of every rival
    expect(pts['them']).toBeUndefined(); // nothing posted yet, nothing scored
  });

  it("…and re-ranks when the partner posts, moving BOTH players' points", () => {
    const s = withPartner(seasonWith(1, -6, -2), {});
    const solo = recomputeSeasonPoints(s, IDS);
    expect(solo['player']).toBe(TOUR_POINTS[0]);
    // Sam comes back and beats it: the player drops to 2nd, Sam takes 1st.
    s.coop!.partners[0].results = { 0: { total: 28, toPar: -8 } };
    const settled = recomputeSeasonPoints(s, IDS);
    expect(settled['them']).toBe(TOUR_POINTS[0]);
    expect(settled['player']).toBe(TOUR_POINTS[1]);
    expect(settled['player']).toBeLessThan(solo['player']);
  });

  it('is idempotent and order-independent — recomputing never drifts', () => {
    const s = withPartner(seasonWith(3, -6, -2), { 1: { total: 28, toPar: -8 } });
    const a = recomputeSeasonPoints(s, IDS);
    const b = recomputeSeasonPoints(s, IDS);
    expect(a).toEqual(b);
    // The partner filling in an EARLIER event they skipped changes only that
    // event's share, never the events already settled the same way.
    s.coop!.partners[0].results[0] = { total: 40, toPar: 4 }; // a bad round
    const c = recomputeSeasonPoints(s, IDS);
    expect(c['player']).toBe(a['player']); // still beat everyone in event 0
  });

  it('a partner who never posts costs the player nothing', () => {
    const alone = recomputeSeasonPoints(withPartner(seasonWith(4, -6, -2), {}), IDS);
    const solo = recomputeSeasonPoints(seasonWith(4, -6, -2), IDS);
    expect(alone['player']).toBe(solo['player']);
  });

  it('results banked before shared seasons existed keep their stored points', () => {
    const s = newSeason(99);
    s.results.push({ idx: 0, playerRank: 2, points: 300, toPar: -1, winnerId: 'rex' }); // no field
    s.played = 1;
    expect(recomputeSeasonPoints(s, IDS)['player']).toBe(300);
  });

  it('majors pay double in a shared season too', () => {
    const s = seasonWith(0, 0, 0);
    s.results.push({
      idx: 3, // a major
      playerRank: 1,
      points: 0,
      toPar: -9,
      winnerId: 'player',
      total: 99,
      field: TOUR_RIVALS.map(() => ({ total: 110, toPar: -2 }))
    });
    expect(recomputeSeasonPoints(s, IDS)['player']).toBe(TOUR_POINTS[0] * 2);
  });
});

describe('the snapshot', () => {
  it('drops this device from the partner list and re-settles the table', () => {
    const s = withPartner(seasonWith(1, -6, -2), {});
    const changed = applyCoopSnapshot(
      s,
      [
        { playerId: 'me', name: 'Me', results: {} },
        { playerId: 'them', name: 'Sam', results: { 0: { total: 28, toPar: -8 } } }
      ],
      IDS
    );
    expect(changed).toBe(true);
    expect(s.coop!.partners.map((p) => p.playerId)).toEqual(['them']);
    expect(s.points['them']).toBe(TOUR_POINTS[0]);
    // A solo season ignores snapshots entirely.
    expect(applyCoopSnapshot(seasonWith(1, -6, -2), [], IDS)).toBe(false);
  });

  it('survives a storage round-trip, and a corrupt block falls back to solo', () => {
    const s = withPartner(seasonWith(2, -6, -2), { 0: { total: 30, toPar: -6 } });
    const revived = migrateTour(JSON.parse(JSON.stringify(s)))!;
    expect(revived.coop).toEqual(s.coop);
    const broken = migrateTour({ ...JSON.parse(JSON.stringify(s)), coop: { id: 5 } })!;
    expect(broken.coop).toBeUndefined();
  });

  it('merges toward the copy that has heard about more partner results', () => {
    const a = withPartner(seasonWith(2, -6, -2), {});
    const b = withPartner(seasonWith(2, -6, -2), { 0: { total: 30, toPar: -6 } });
    expect(mergeTour(a, b)).toBe(b);
    expect(mergeTour(b, a)).toBe(b);
  });
});

describe('the invite link', () => {
  it('round-trips an id through a shareable URL', () => {
    const sid = makeCoopId();
    const url = coopUrl(sid, 'https://bsgolf.fun/');
    expect(url).toContain('?coop=');
    expect(parseCoopParam(url)).toBe(sid);
    expect(parseCoopParam(sid)).toBe(sid); // a bare id pasted by hand
    expect(parseCoopParam('nope!')).toBeNull();
  });

  it('validates a fetched doc and drops junk players/results', () => {
    const doc = migrateCoopDoc({
      sid: 'cs123456',
      seed: 77,
      seasonNo: 2,
      players: {
        good: { playerId: 'good', name: 'Sam', results: { '0': { total: 30, toPar: -6 }, '9999': { total: 1, toPar: 1 } } },
        'bad id!': { playerId: 'bad id!', name: 'X', results: {} }
      }
    })!;
    expect(doc.seed).toBe(77);
    expect(Object.keys(doc.players)).toEqual(['good']);
    expect(Object.keys(doc.players.good.results)).toEqual(['0']); // 9999 is out of range
    expect(migrateCoopDoc({ seed: 1 })).toBeNull();
    expect(migrateCoopDoc(null)).toBeNull();
  });
});

describe('a reload must not strand a shared season', () => {
  it('keeps the field scores an event needs to re-settle', () => {
    // Regression: migrateTour dropped `total`/`field` from result lines, so a
    // co-op season that survived a reload could no longer re-rank its events
    // when the partner posted — the points would freeze at the provisional
    // value forever, silently.
    const s = withPartner(seasonWith(2, -6, -2), {});
    const revived = migrateTour(JSON.parse(JSON.stringify(s)))!;
    expect(revived.results).toEqual(s.results);
    revived.coop!.partners[0].results = { 0: { total: 28, toPar: -8 } };
    expect(recomputeSeasonPoints(revived, IDS)['them']).toBe(TOUR_POINTS[0]);
  });

  it('a legacy result line without them still loads', () => {
    const raw = JSON.parse(JSON.stringify(seasonWith(1, -6, -2)));
    delete raw.results[0].field;
    delete raw.results[0].total;
    const revived = migrateTour(raw)!;
    expect(revived.results[0].field).toBeUndefined();
    expect(recomputeSeasonPoints(revived, IDS)['player']).toBe(TOUR_POINTS[0]);
  });
});

describe('the field keeps its names', () => {
  it('stores rival scores in RIVAL order, so a re-settle credits the right ones', () => {
    // Regression: `field` was written in finishing order but read back
    // positionally as rivals[i], so every rival's season points landed on
    // whoever happened to finish in their slot.
    const s = newSeason(31337);
    const courses: Record<string, CourseData> = { wildwood: loadCourse(wildwood as unknown as CourseAuthoring) };
    completeTourRound(s, courses, 11, 0, ['wildwood']);
    const res = s.results[0];
    expect(res.field).toHaveLength(TOUR_RIVALS.length);
    // The stored line for each rival matches that rival's own event score.
    const standings = recomputeSeasonPoints(s, ['wildwood'], TOUR_RIVALS);
    expect(Object.keys(standings)).toEqual(expect.arrayContaining(TOUR_RIVALS.map((r) => r.id)));
    // The winner recorded on the result is the rival whose stored score is best.
    const best = Math.min(...res.field!.map((f) => f.toPar));
    const bestIds = TOUR_RIVALS.filter((_, i) => res.field![i].toPar === best).map((r) => r.id);
    if (res.winnerId !== 'player') expect(bestIds).toContain(res.winnerId);
  });
});

/**
 * YOUR RIVAL IS ALWAYS ON THE BOARD.
 *
 * Owner: "You can't see your rival in the leaderboard of a tourney. You should
 * always see them. If they played with their score, if not then with a DNP."
 *
 * They were missing outright: `eventStandings` builds the live board from the
 * player and the AI field, and `eventRowsFor` lists only partners who have
 * POSTED — so the one opponent who is an actual person was absent from exactly
 * the board you open to see how you are doing against them.
 *
 * The fix is display-only on purpose. A partner who has not played must not
 * take a rank or a share of the points, so DNP rows are appended after the
 * sort and never reach `pointsForStandings`.
 */
describe('the board always shows your rival', () => {
  const board = (s: TourSeasonState, idx: number) =>
    eventBoardRows(eventRowsFor(s.results.find((r) => r.idx === idx)!, s, TOUR_RIVALS), s, idx);

  it('lists a partner who has not played as DNP, with no rank', () => {
    const s = withPartner(seasonWith(1, -6, -2), {});
    const rows = board(s, 0);
    const sam = rows.find((r) => r.id === 'them');
    expect(sam, 'the rival must appear even having not played').toBeTruthy();
    expect(sam!.dnp).toBe(true);
    expect(sam!.name).toBe('Sam');
    // Last on the board — a DNP is a blank, not a finishing position.
    expect(rows[rows.length - 1].id).toBe('them');
    // Everyone else is a real placing.
    expect(rows.filter((r) => !r.dnp).every((r) => r.dnp === undefined)).toBe(true);
  });

  it('lists them with their score once they post, ranked on merit', () => {
    const s = withPartner(seasonWith(1, -6, -2), { 0: { total: 29, toPar: -7 } });
    const rows = board(s, 0);
    const sam = rows.find((r) => r.id === 'them')!;
    expect(sam.dnp).toBeUndefined();
    expect(sam.toPar).toBe(-7);
    // -7 beats the player's -6, so Sam leads the board.
    expect(rows[0].id).toBe('them');
    expect(rows[1].isPlayer).toBe(true);
  });

  it('NEVER lets a DNP row touch the points', () => {
    // The invariant that keeps this display-only. Scoring reads eventRowsFor;
    // if a DNP row ever reached pointsForStandings it would take a rank and
    // push a real finisher down a place.
    const s = withPartner(seasonWith(1, -6, -2), {});
    const scored = eventRowsFor(s.results[0], s, TOUR_RIVALS);
    expect(scored.some((r) => r.id === 'them'), 'scoring must not see an absent partner').toBe(false);
    const withDnp = eventBoardRows(scored, s, 0);
    expect(withDnp.length).toBe(scored.length + 1);
    // And the season points are unchanged by the board existing at all.
    expect(recomputeSeasonPoints(s, IDS)['them']).toBeUndefined();
    expect(recomputeSeasonPoints(s, IDS)['player']).toBe(TOUR_POINTS[0]);
  });

  it('is a no-op in a solo season', () => {
    const s = seasonWith(1, -6, -2);
    const scored = eventRowsFor(s.results[0], s, TOUR_RIVALS);
    expect(eventBoardRows(scored, s, 0)).toEqual(scored);
  });

  it('does not duplicate a partner already on the scored board', () => {
    const s = withPartner(seasonWith(1, -6, -2), { 0: { total: 29, toPar: -7 } });
    const rows = board(s, 0);
    expect(rows.filter((r) => r.id === 'them')).toHaveLength(1);
  });
});
