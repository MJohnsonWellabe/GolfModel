import { describe, expect, it } from 'vitest';
import {
  newSeason,
  proRetired,
  quitSeason,
  SEASON_LIMIT,
  seasonsCompleted,
  TOUR_EVENTS,
  TOUR_POINTS,
  TourHistory,
  TourSeasonState
} from '../../src/systems/TourSeason';
import { TOUR_RIVALS } from '../../src/data/tourRivals';

/**
 * QUITTING A SEASON (owner pass 9b, verbatim: "you should be able to quit a
 * season and start a new one whenever you want. the partial season counts for
 * the golfer").
 *
 * The two halves of that sentence pull against each other, and these tests are
 * where the tension is pinned: leaving must always be possible, and leaving
 * must always cost — one of the golfer's ten seasons, a line on their record,
 * and the purse they walked away from.
 */

/** A season `played` events deep, with the player holding `pts` points. */
function seasonAt(played: number, pts: number, seasonNo = 1): TourSeasonState {
  const s = newSeason(4242, seasonNo);
  s.played = played;
  s.points = { player: pts };
  // The rivals sit below the player unless a test says otherwise.
  for (const r of TOUR_RIVALS) s.points[r.id] = Math.max(0, pts - 100);
  for (let i = 0; i < played; i++) {
    s.results.push({ idx: i, playerRank: 1, points: TOUR_POINTS[0], toPar: -4, winnerId: 'player' });
  }
  return s;
}

describe('quitting part-way', () => {
  it('records the placement held, the events played, and rolls a fresh season', () => {
    const h: TourHistory = {};
    const s = seasonAt(6, 1240);
    const out = quitSeason(s, h, 'pro1', 'Ace', 999);
    expect(out.recorded).toEqual({ seasonNo: 1, rank: 1, points: 1240, events: 6 });
    expect(out.retired).toBe(false);
    // A NEW season, numbered next, with nothing carried over.
    expect(out.next!.seasonNo).toBe(2);
    expect(out.next!.played).toBe(0);
    expect(out.next!.results).toEqual([]);
    expect(out.next!.activeEvent).toBeNull();
    expect(out.next!.seed).toBe(999);
    // …and it counts for the golfer, which is the whole point.
    expect(seasonsCompleted(h, 'pro1')).toBe(1);
  });

  it('the rolled-over season is stamped with the CALLER-resolved owner, not the old season\'s own (possibly missing) stamp', () => {
    // A legacy season with no owner of its own — quitSeason still receives
    // an explicit proId/proName from its caller (owner: seasonOwner() in
    // main.ts resolves this correctly even when the season predates the
    // stamp), and the rollover must carry THAT forward, not silently drop it.
    const h: TourHistory = {};
    const s = seasonAt(6, 1240);
    expect(s.proId).toBeUndefined();
    const out = quitSeason(s, h, 'pro1', 'Ace', 999);
    expect(out.next!.proId).toBe('pro1');
    expect(out.next!.proName).toBe('Ace');
  });

  it('a season quit before playing anything also stamps its free reroll with the owner', () => {
    const h: TourHistory = {};
    const s = newSeason(4242, 1); // 0 played
    const out = quitSeason(s, h, 'pro1', 'Ace', 999);
    expect(out.recorded).toBeNull();
    expect(out.next!.proId).toBe('pro1');
    expect(out.next!.proName).toBe('Ace');
  });

  it('records the rank the player actually held, not a default', () => {
    const h: TourHistory = {};
    const s = seasonAt(9, 300);
    // Three rivals ahead of the player on points.
    s.points[TOUR_RIVALS[0].id] = 900;
    s.points[TOUR_RIVALS[1].id] = 800;
    s.points[TOUR_RIVALS[2].id] = 700;
    expect(quitSeason(s, h, 'pro1', 'Ace', 1).recorded!.rank).toBe(4);
  });

  it('counts a shared season by the board the player saw — partner included', () => {
    const h: TourHistory = {};
    const s = seasonAt(5, 500);
    s.coop = {
      id: 'cs123456',
      playerId: 'me',
      partners: [{ playerId: 'them', name: 'Sam', results: {} }]
    };
    s.points['them'] = 900; // the friend is ahead
    expect(quitSeason(s, h, 'pro1', 'Ace', 1).recorded!.rank).toBe(2);
  });

  it('mid-event progress goes with it — a half-played major is not kept', () => {
    const h: TourHistory = {};
    const s = seasonAt(3, 600);
    s.activeEvent = {
      idx: 3,
      playerTotals: [11],
      playerToPars: [-1],
      fieldTotals: TOUR_RIVALS.map(() => [11]),
      fieldToPars: TOUR_RIVALS.map(() => [-1])
    };
    expect(quitSeason(s, h, 'pro1', 'Ace', 1).next!.activeEvent).toBeNull();
  });
});

describe('a season nobody played is a free reroll', () => {
  it('records nothing, keeps the season NUMBER, and draws a new schedule', () => {
    const h: TourHistory = {};
    const s = seasonAt(0, 0, 3);
    const out = quitSeason(s, h, 'pro1', 'Ace', 777);
    expect(out.recorded).toBeNull();
    expect(out.retired).toBe(false);
    expect(out.next!.seasonNo).toBe(3); // NOT bumped — that season never happened
    expect(out.next!.seed).toBe(777); // …but the schedule is different
    expect(h.pro1).toBeUndefined();
    expect(seasonsCompleted(h, 'pro1')).toBe(0);
  });

  it('so a mistaken tap can never cost a career slot', () => {
    const h: TourHistory = {};
    let s = seasonAt(0, 0);
    for (let i = 0; i < 25; i++) s = quitSeason(s, h, 'pro1', 'Ace', 1000 + i).next!;
    expect(seasonsCompleted(h, 'pro1')).toBe(0);
    expect(proRetired(h, 'pro1')).toBe(false);
  });
});

describe('the career still ends', () => {
  it('quitting the tenth season retires the Pro instead of rolling over', () => {
    const h: TourHistory = {};
    let s = seasonAt(1, 100, 1);
    for (let n = 1; n < SEASON_LIMIT; n++) {
      const out = quitSeason(s, h, 'pro1', 'Ace', n);
      expect(out.retired, `retired early at season ${n}`).toBe(false);
      s = out.next!;
      s.played = 1;
      s.points = { player: 100 };
    }
    expect(seasonsCompleted(h, 'pro1')).toBe(SEASON_LIMIT - 1);
    const last = quitSeason(s, h, 'pro1', 'Ace', 99);
    expect(last.retired).toBe(true);
    expect(last.next).toBeNull(); // no eleventh season rolls out
    expect(proRetired(h, 'pro1')).toBe(true);
    expect(seasonsCompleted(h, 'pro1')).toBe(SEASON_LIMIT);
  });

  it('re-quitting a season already on record cannot inflate the counter', () => {
    const h: TourHistory = {};
    const s = seasonAt(4, 400, 2);
    quitSeason(s, h, 'pro1', 'Ace', 1);
    quitSeason(s, h, 'pro1', 'Ace', 2); // a double-fire, or a cloud replay
    quitSeason(s, h, 'pro1', 'Ace', 3);
    expect(seasonsCompleted(h, 'pro1')).toBe(1);
    expect(h.pro1.seasons[0].events).toBe(4);
  });

  it('is per-golfer: quitting on one Pro leaves the others untouched', () => {
    const h: TourHistory = {};
    quitSeason(seasonAt(6, 600), h, 'pro1', 'Ace', 1);
    expect(seasonsCompleted(h, 'pro1')).toBe(1);
    expect(seasonsCompleted(h, 'pro2')).toBe(0);
  });
});

describe('a full season is still a full season', () => {
  it('no `events` marker is stored when all sixteen were played', () => {
    const h: TourHistory = {};
    const out = quitSeason(seasonAt(TOUR_EVENTS, 3000), h, 'pro1', 'Ace', 1);
    // Quitting a season that is already complete is a no-op edge, but the
    // record must not claim it was abandoned.
    expect(out.recorded!.events).toBeUndefined();
  });
});
