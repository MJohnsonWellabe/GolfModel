import { describe, expect, it } from 'vitest';
import {
  activeTour,
  archiveTour,
  canAddSeason,
  clearActiveTour,
  LIVE_SEASON_CAP,
  nextSeasonNo,
  emptyTours,
  mergeTours,
  migrateTours,
  newSeason,
  putTour,
  selectTour,
  TOUR_ARCHIVE_CAP,
  TourCollection,
  tourKey,
  TourSeasonState
} from '../src/systems/TourSeason';
import { defaultProfile, KVStorage, loadProfile, mergeProfiles, saveProfile } from '../src/profile/Profile';

/**
 * STAGE 5. The profile used to hold exactly one season, and three of the
 * owner's complaints were the same fact wearing different hats: a finished
 * shared season could not be looked at, joining a friend's season destroyed
 * your own, and you could not play two.
 *
 * These are the gates on the collection that replaced it.
 */

const coop = (t: TourSeasonState, id: string, partners: string[] = []): TourSeasonState => ({
  ...t,
  coop: {
    id,
    playerId: 'me',
    partners: partners.map((name) => ({ playerId: name, name, results: {} }))
  }
});

describe('keys', () => {
  it('a solo season keys on its seed, a shared one on the shared doc', () => {
    const s = newSeason(1234);
    expect(tourKey(s)).toBe('solo:1234');
    expect(tourKey(coop(s, 'abc'))).toBe('co:abc');
  });

  it('two devices in the same shared season land on the SAME key', () => {
    // Different seeds — the joiner takes the host's schedule but the objects
    // are built independently. If the key were the seed they would stack up as
    // two seasons instead of merging into one.
    expect(tourKey(coop(newSeason(1), 'sid'))).toBe(tourKey(coop(newSeason(2), 'sid')));
  });
});

describe('putTour / selectTour / clearActiveTour', () => {
  it('inserting makes it active and leaves the others alone', () => {
    let c = emptyTours();
    const a = newSeason(1);
    const b = newSeason(2);
    c = putTour(c, a);
    c = putTour(c, b);
    expect(Object.keys(c.seasons)).toHaveLength(2);
    expect(activeTour(c)).toBe(b);
    // THE BUG THIS EXISTS FOR: joining a friend's season is an insert, so the
    // season already in progress is still there.
    expect(c.seasons[tourKey(a)]).toBe(a);
  });

  it('selecting an unknown key is ignored rather than blanking the season', () => {
    const c = putTour(emptyTours(), newSeason(1));
    expect(activeTour(selectTour(c, 'nope'))).toBe(activeTour(c));
  });

  it('selecting switches which season the next round belongs to', () => {
    let c = putTour(putTour(emptyTours(), newSeason(1)), newSeason(2));
    c = selectTour(c, 'solo:1');
    expect(activeTour(c)!.seed).toBe(1);
  });

  it('clearing drops the active season without touching the rest', () => {
    let c = putTour(putTour(emptyTours(), newSeason(1)), newSeason(2));
    c = clearActiveTour(c);
    expect(activeTour(c)).toBeNull();
    expect(c.seasons['solo:1']).toBeTruthy();
    expect(c.seasons['solo:2']).toBeUndefined();
  });
});

describe('archiving — the standings that used to be thrown away', () => {
  const played = (): TourSeasonState => {
    const s = newSeason(99);
    s.played = 16;
    // Real rival ids — seasonStandings builds its rows from TOUR_RIVALS, so a
    // made-up id carries no points and the player would top an empty field.
    s.points = { player: 2400, rex: 3100, dutch: 1200 };
    s.results = [{ idx: 0, playerRank: 2, points: 300, toPar: -4, winnerId: 'rex' }];
    return s;
  };

  it('keeps the full final table, the event lines and the partner names', () => {
    const t = coop(played(), 'sid', ['Dave']);
    const c = archiveTour(putTour(emptyTours(), t), t, {
      proId: 'p1',
      proName: 'Ace',
      at: 1000,
      ended: 'finale'
    });
    const a = c.archive[0];
    expect(a.seasonNo).toBe(1);
    expect(a.proName).toBe('Ace');
    expect(a.playerPoints).toBe(2400);
    expect(a.standings.length, 'the whole points table, not one line').toBeGreaterThan(1);
    expect(a.results).toHaveLength(1);
    expect(a.coop!.partnerNames).toEqual(['Dave']);
    // ...and the archived season is no longer live.
    expect(c.seasons[tourKey(t)]).toBeUndefined();
    expect(activeTour(c)).toBeNull();
  });

  it('records the rank the player actually finished at', () => {
    const t = played(); // rex 3100 > player 2400, so the player is 2nd
    const a = archiveTour(emptyTours(), t, { proId: 'p', proName: 'P', at: 1, ended: 'finale' }).archive[0];
    expect(a.playerRank).toBe(2);
  });

  it('is idempotent by key — closing twice does not stack two entries', () => {
    const t = played();
    const meta = { proId: 'p', proName: 'P', at: 1, ended: 'quit' as const };
    const c = archiveTour(archiveTour(emptyTours(), t, meta), t, meta);
    expect(c.archive).toHaveLength(1);
  });

  it('caps the archive newest-first', () => {
    let c = emptyTours();
    for (let i = 0; i < TOUR_ARCHIVE_CAP + 5; i++) {
      const t = newSeason(i);
      c = archiveTour(c, t, { proId: 'p', proName: 'P', at: i, ended: 'finale' });
    }
    expect(c.archive).toHaveLength(TOUR_ARCHIVE_CAP);
    expect(c.archive[0].at, 'newest first').toBe(TOUR_ARCHIVE_CAP + 4);
  });
});

describe('migration from the single-season profile', () => {
  it('folds a stored `tour` into a one-entry map and keeps it active', () => {
    const legacy = newSeason(777);
    legacy.played = 4;
    const c = migrateTours(undefined, JSON.parse(JSON.stringify(legacy)));
    expect(Object.keys(c.seasons)).toEqual(['solo:777']);
    expect(c.activeId).toBe('solo:777');
    expect(activeTour(c)!.played, 'a season in progress is still in progress').toBe(4);
  });

  it('does NOT let a stale legacy field overwrite an already-migrated map', () => {
    const stale = { ...newSeason(777), played: 1 };
    const current = { ...newSeason(777), played: 9 };
    const c = migrateTours({ v: 1, seasons: { 'solo:777': current }, activeId: 'solo:777', archive: [] }, stale);
    expect(activeTour(c)!.played).toBe(9);
  });

  it('re-keys on load so a season that gained a coop link merges with its partner', () => {
    const t = coop(newSeason(5), 'sid');
    const c = migrateTours({ v: 1, seasons: { 'solo:5': t }, activeId: 'solo:5', archive: [] });
    expect(Object.keys(c.seasons)).toEqual(['co:sid']);
    expect(c.activeId, 'the stale key no longer resolves, so it re-anchors').toBe('co:sid');
  });

  it('survives junk', () => {
    expect(migrateTours(undefined)).toEqual(emptyTours());
    expect(migrateTours('nope')).toEqual(emptyTours());
    expect(migrateTours({ seasons: { x: null }, archive: ['junk', null] })).toEqual(emptyTours());
  });

  it('round-trips through the whole profile store', () => {
    const store = new Map<string, string>();
    const kv: KVStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v)
    };
    const p = defaultProfile();
    p.tours = putTour(p.tours, newSeason(42));
    saveProfile(p, kv);
    expect(activeTour(loadProfile(kv).tours)!.seed).toBe(42);
  });
});

describe('merging across devices', () => {
  const withSeasons = (...ts: TourSeasonState[]): TourCollection =>
    ts.reduce((c, t) => putTour(c, t), emptyTours());

  it('is per key — a phone joining a shared season cannot erase the laptop solo one', () => {
    const laptop = withSeasons(newSeason(1));
    const phone = withSeasons(coop(newSeason(2), 'sid'));
    const m = mergeTours(laptop, phone);
    expect(Object.keys(m.seasons).sort()).toEqual(['co:sid', 'solo:1']);
  });

  it('resolves each key with mergeTour — the further-progressed copy wins', () => {
    const behind = { ...newSeason(1), played: 2 };
    const ahead = { ...newSeason(1), played: 7 };
    expect(activeTour(mergeTours(withSeasons(behind), withSeasons(ahead)))!.played).toBe(7);
    expect(activeTour(mergeTours(withSeasons(ahead), withSeasons(behind)))!.played).toBe(7);
  });

  it('an archived season is never resurrected as live by a device that missed the finale', () => {
    const t = { ...newSeason(1), played: 16 };
    const finished = archiveTour(withSeasons(t), t, { proId: 'p', proName: 'P', at: 5, ended: 'finale' });
    const stillThinksItsLive = withSeasons(t);
    for (const m of [mergeTours(finished, stillThinksItsLive), mergeTours(stillThinksItsLive, finished)]) {
      expect(m.seasons['solo:1'], 'finished beats in-progress').toBeUndefined();
      expect(m.archive).toHaveLength(1);
    }
  });

  it('archives union, and the fuller record wins a same-timestamp tie', () => {
    const t = { ...newSeason(1), played: 16, points: { player: 100 } };
    const thin = archiveTour(emptyTours(), t, { proId: 'p', proName: 'P', at: 9, ended: 'finale' });
    thin.archive[0].standings = [];
    const full = archiveTour(emptyTours(), t, { proId: 'p', proName: 'P', at: 9, ended: 'finale' });
    expect(mergeTours(thin, full).archive[0].standings.length).toBeGreaterThan(0);
  });

  it('never leaves activeId pointing at a season that is not in the map', () => {
    const t = { ...newSeason(1), played: 16 };
    const finished = archiveTour(withSeasons(t), t, { proId: 'p', proName: 'P', at: 1, ended: 'finale' });
    const m = mergeTours(finished, withSeasons(t));
    expect(m.activeId === null || !!m.seasons[m.activeId]).toBe(true);
  });

  it('rides the whole-profile merge in both directions', () => {
    const a = defaultProfile();
    const b = defaultProfile();
    a.tours = withSeasons(newSeason(1));
    b.tours = withSeasons(coop(newSeason(2), 'sid'));
    for (const m of [mergeProfiles(a, b), mergeProfiles(b, a)]) {
      expect(Object.keys(m.tours.seasons).sort()).toEqual(['co:sid', 'solo:1']);
    }
  });
});

/**
 * RE-KEYING. `startCoopSeason` attaches a coop link to the solo season already
 * in progress and puts it back, which moves it from `solo:<seed>` to
 * `co:<sid>`. It has to MOVE, not copy.
 */
describe('sharing the season already in progress', () => {
  it('moves it rather than leaving a duplicate under the old key', () => {
    const solo = newSeason(9);
    let c = putTour(emptyTours(), solo);
    expect(Object.keys(c.seasons)).toEqual(['solo:9']);
    const shared = { ...solo, coop: { id: 'sid', playerId: 'me', partners: [] } };
    c = putTour(c, shared);
    expect(Object.keys(c.seasons), 'one season, one entry').toEqual(['co:sid']);
    expect(c.activeId).toBe('co:sid');
  });

  it('...and mutating the same object in place is still one entry', () => {
    const solo = newSeason(9);
    let c = putTour(emptyTours(), solo);
    // This is what startCoopSeason literally does: assign onto `base`.
    (solo as TourSeasonState).coop = { id: 'sid2', playerId: 'me', partners: [] };
    c = putTour(c, solo);
    expect(Object.keys(c.seasons)).toEqual(['co:sid2']);
  });

  it('does not disturb the OTHER seasons in the map', () => {
    const other = newSeason(1);
    const solo = newSeason(9);
    let c = putTour(putTour(emptyTours(), other), solo);
    c = putTour(c, { ...solo, coop: { id: 'sid', playerId: 'me', partners: [] } });
    expect(Object.keys(c.seasons).sort()).toEqual(['co:sid', 'solo:1']);
  });
});

/**
 * RUNNING TWO SEASONS AT ONCE — the half of Stage 5 that shipped unreachable.
 *
 * The collection could always hold several seasons and the picker could always
 * switch between them, but no SOLO path ever added one: every route guarded
 * `if (!tourNow())` or archived-and-replaced, so only the co-op flow could grow
 * the map. The owner, playing solo, reported (twice) that there was still no
 * way to run more than one season, and he was right — the feature had no door.
 */
describe('starting a second season alongside the first', () => {
  it('adds without archiving, and the first season is untouched', () => {
    let c: TourCollection = putTour(emptyTours(), { ...newSeason(1, 1), played: 5, points: { player: 300 } });
    const firstKey = c.activeId!;
    c = putTour(c, newSeason(2, nextSeasonNo(c)));

    expect(Object.keys(c.seasons)).toHaveLength(2);
    expect(c.archive, 'nothing was closed out').toHaveLength(0);
    expect(activeTour(c)!.seasonNo, 'the new one is the one being played').toBe(2);
    // The season that was already running kept every event it had banked.
    expect(c.seasons[firstKey].played).toBe(5);
    expect(c.seasons[firstKey].points.player).toBe(300);
    // ...and switching back reaches it whole.
    expect(activeTour(selectTour(c, firstKey))!.played).toBe(5);
  });

  it('numbers each season once, counting the ones already finished', () => {
    // Sequential seasons could take `previous + 1`; concurrent ones cannot, or
    // the picker offers the player two rows both called "Season 2".
    let c: TourCollection = putTour(emptyTours(), newSeason(1, nextSeasonNo(emptyTours())));
    expect(activeTour(c)!.seasonNo).toBe(1);
    c = putTour(c, newSeason(2, nextSeasonNo(c)));
    c = putTour(c, newSeason(3, nextSeasonNo(c)));
    const nos = Object.values(c.seasons).map((t) => t.seasonNo).sort();
    expect(nos).toEqual([1, 2, 3]);

    // An archived season still holds its number — the next one goes past it.
    const closed = archiveTour(c, c.seasons[tourKey(newSeason(1, 1))], {
      proId: 'p',
      proName: 'Pro',
      at: 1,
      ended: 'finale'
    });
    expect(nextSeasonNo(closed), 'does not re-issue an archived number').toBe(4);
  });

  it('is capped, so a synced collection cannot grow without bound', () => {
    let c: TourCollection = emptyTours();
    for (let i = 0; i < LIVE_SEASON_CAP; i++) {
      expect(canAddSeason(c), `slot ${i} is free`).toBe(true);
      c = putTour(c, newSeason(i + 1, nextSeasonNo(c)));
    }
    expect(canAddSeason(c), 'full').toBe(false);
    expect(Object.keys(c.seasons)).toHaveLength(LIVE_SEASON_CAP);
    // Closing one out frees a slot again.
    const [key] = Object.keys(c.seasons);
    const freed = archiveTour(c, c.seasons[key], { proId: 'p', proName: 'Pro', at: 1, ended: 'quit' });
    expect(canAddSeason(freed)).toBe(true);
  });

  it('archiving one leaves its siblings alone', () => {
    let c: TourCollection = putTour(emptyTours(), newSeason(1, 1));
    const keep = c.activeId!;
    c = putTour(c, newSeason(2, 2));
    const closing = activeTour(c)!;
    c = archiveTour(c, closing, { proId: 'p', proName: 'Pro', at: 1, ended: 'finale' });
    expect(Object.keys(c.seasons), 'the sibling survives').toEqual([keep]);
    expect(c.archive).toHaveLength(1);
    expect(c.archive[0].seasonNo).toBe(2);
  });
});
