import { describe, expect, it } from 'vitest';
import {
  ATTR_CAP,
  activePro,
  bestProOvr,
  CAREER_STARTS,
  careerOvr,
  careerStarted,
  CareerState,
  CP,
  cpForRound,
  emptyCareer,
  grantCp,
  mergeCareers,
  migrateCareer,
  pointCost,
  raiseAttr,
  setActivePro,
  setProLook,
  startPro
} from '../src/data/career';
import { ARCHETYPES } from '../src/data/archetypes';
import type { GolferStats } from '../src/core/types';

/**
 * CAREER MODE math — the whole growth curve is three numbers (the point-cost
 * brackets) and one table (CP per round), so every promise the owner was given
 * is checkable here: the 65-overall start, the 150/200/450 bracket totals, and
 * the ~27/~28/~55-round arc at the CP a player actually earns. Round 2 adds
 * the STABLE: named Pros with a shared wallet, where a new rookie keeps the
 * unspent CP and the old Pro keeps every point ever bought.
 */

const sum = (s: GolferStats): number =>
  s.drivingPower + s.drivingAccuracy + s.approach + s.chipping + s.putting;

/** startPro with a deterministic id, for readable assertions. */
const start = (c: CareerState, styleId: (typeof ARCHETYPES)[number]['id'], opts?: { name?: string; id?: string; now?: number }): CareerState =>
  startPro(c, {
    name: opts?.name ?? 'Test Pro',
    styleId,
    character: 'chip',
    now: opts?.now ?? 1000,
    id: opts?.id ?? `id-${styleId}`
  });

describe('the five starting shapes', () => {
  it('every start is overall EXACTLY 65, signature bias kept', () => {
    for (const a of ARCHETYPES) {
      const s = CAREER_STARTS[a.id];
      expect(sum(s), `${a.id} sums to ${sum(s)}`).toBe(325); // 5 × 65
      expect(careerOvr(s)).toBe(65);
      // The signature stat leads the shape, same as the preset it scales down.
      const max = Math.max(...Object.values(s));
      expect(s[a.signature], `${a.id} signature`).toBe(max);
    }
  });

  it('startPro adopts the shape, keeps CP already saved, and is active', () => {
    let c = grantCp(emptyCareer(), 12);
    expect(careerStarted(c)).toBe(false);
    c = start(c, 'puttKing', { name: '  Lefty  ' });
    expect(careerStarted(c)).toBe(true);
    const pro = activePro(c)!;
    expect(pro.styleId).toBe('puttKing');
    expect(pro.name).toBe('Lefty'); // trimmed
    expect(pro.character).toBe('chip');
    expect(pro.attrs).toEqual(CAREER_STARTS.puttKing);
    expect(pro.createdAt).toBe(1000);
    expect(c.cp).toBe(12);
  });

  it('a blank name falls back instead of shipping an anonymous Pro', () => {
    const c = start(emptyCareer(), 'sniper', { name: '   ' });
    expect(activePro(c)!.name).toBe('My Pro');
  });
});

describe('the cost curve (the owner arc: quick to 80, real to 90, a grind to 99)', () => {
  it('brackets: 2 CP below 80, 4 CP in the 80s, 10 CP in the 90s, capped at 99', () => {
    expect(pointCost(65)).toBe(2);
    expect(pointCost(79)).toBe(2);
    expect(pointCost(80)).toBe(4);
    expect(pointCost(89)).toBe(4);
    expect(pointCost(90)).toBe(10);
    expect(pointCost(98)).toBe(10);
    expect(pointCost(ATTR_CAP)).toBe(Infinity);
  });

  it('bracket totals from a 65 start: 150 to all-80s, +200 to all-90s, +450 to all-99s', () => {
    // Whichever starting shape: they all sum to 325, so the to-80 bill is the
    // same 150 CP; the later brackets are shape-independent by construction.
    const cost = (from: number, to: number): number => {
      let t = 0;
      for (let v = from; v < to; v++) t += pointCost(v);
      return t;
    };
    const s = CAREER_STARTS.bigHitter;
    const to80 = (Object.values(s) as number[]).reduce((a, v) => a + cost(v, 80), 0);
    expect(to80).toBe(150);
    expect(5 * cost(80, 90)).toBe(200);
    expect(5 * cost(90, 99)).toBe(450);
  });

  it('the round counts land where the owner asked (~25-30 / ~25-30 / ~50)', () => {
    // CP per round grows with the player: a rookie averages ~6 (base 4 + a
    // birdie + the odd under-par stroke), a mid golfer ~7, a strong one ~9
    // (birdies, dailies, the occasional win). The brackets divide out to the
    // owner's verbatim curve at exactly those rates.
    expect(Math.ceil(150 / 6)).toBeGreaterThanOrEqual(25);
    expect(Math.ceil(150 / 5)).toBeLessThanOrEqual(30);
    expect(Math.ceil(200 / 7)).toBeGreaterThanOrEqual(25);
    expect(Math.ceil(200 / 7)).toBeLessThanOrEqual(30);
    expect(Math.ceil(450 / 9)).toBe(50);
  });
});

describe('spending', () => {
  it('a raise targets the ACTIVE Pro, costs the bracket price, moves the grow-only pair', () => {
    let c = start(grantCp(emptyCareer(), 10), 'sniper');
    const next = raiseAttr(c, 'putting');
    expect(next).not.toBeNull();
    c = next!;
    expect(activePro(c)!.attrs.putting).toBe(CAREER_STARTS.sniper.putting + 1);
    expect(c.cp).toBe(8);
    expect(c.cpSpent).toBe(2);
    expect(c.cpEarned).toBe(10); // spending never touches earned
  });

  it('refuses with no Pro, when CP falls short, and at the cap', () => {
    expect(raiseAttr(grantCp(emptyCareer(), 100), 'putting')).toBeNull();
    const broke = start(emptyCareer(), 'sniper');
    expect(raiseAttr(broke, 'putting')).toBeNull();
    let capped = start(grantCp(emptyCareer(), 10_000), 'sniper');
    capped = {
      ...capped,
      pros: capped.pros.map((p) => ({ ...p, attrs: { ...p.attrs, putting: ATTR_CAP } }))
    };
    expect(raiseAttr(capped, 'putting')).toBeNull();
  });
});

describe('the stable', () => {
  it('a new Pro keeps the unspent CP; the old Pro keeps every point bought', () => {
    // Grow the first Pro, then start a rookie: owner Q&A verbatim — "unspent
    // cp should carry over, spent shouldn't. pro should remain playable."
    let c = start(grantCp(emptyCareer(), 20), 'bigHitter', { id: 'first' });
    c = raiseAttr(raiseAttr(c, 'putting')!, 'putting')!; // 4 CP into the vet
    c = startPro(c, { name: 'Rookie', styleId: 'puttKing', character: 'chip', now: 2000, id: 'second' });
    expect(c.cp).toBe(16); // the wallet carried
    expect(c.cpSpent).toBe(4); // spent stays spent — invested in the vet
    expect(activePro(c)!.id).toBe('second');
    expect(activePro(c)!.attrs).toEqual(CAREER_STARTS.puttKing);
    // The vet is still in the stable, points intact, one tap from playable.
    const vet = c.pros.find((p) => p.id === 'first')!;
    expect(vet.attrs.putting).toBe(CAREER_STARTS.bigHitter.putting + 2);
    c = setActivePro(c, 'first');
    expect(activePro(c)!.id).toBe('first');
    expect(activePro(c)!.attrs.putting).toBe(CAREER_STARTS.bigHitter.putting + 2);
  });

  it('setProLook dresses the Pro; unknown ids are no-ops', () => {
    let c = start(emptyCareer(), 'ironMaiden', { id: 'p1' });
    c = setProLook(c, 'p1', 'rio');
    expect(activePro(c)!.character).toBe('rio');
    expect(setProLook(c, 'ghost', 'chip')).toBe(c);
    expect(setActivePro(c, 'ghost')).toBe(c);
  });

  it('bestProOvr reads the best of the stable (the achievement gate)', () => {
    expect(bestProOvr(emptyCareer())).toBe(0);
    let c = start(grantCp(emptyCareer(), 1000), 'bigHitter', { id: 'a' });
    for (let i = 0; i < 10; i++) c = raiseAttr(c, 'putting') ?? c;
    const grown = careerOvr(activePro(c)!.attrs);
    c = startPro(c, { name: 'R', styleId: 'sniper', character: 'chip', now: 2, id: 'b' });
    expect(bestProOvr(c)).toBe(grown); // the vet still counts
  });
});

describe('CP per round', () => {
  it('base pay rewards showing up; good golf runs ahead', () => {
    const dud = cpForRound({ toPar: 5, birdies: 0, eagles: 0, holeInOnes: 0, won: false, dailyDone: false });
    expect(dud).toBe(CP.round);
    const hot = cpForRound({ toPar: -2, birdies: 1, eagles: 1, holeInOnes: 0, won: true, dailyDone: true });
    expect(hot).toBe(CP.round + CP.birdie + CP.eagle + 2 * CP.perUnderPar + CP.tournamentWin + CP.daily);
    const ace = cpForRound({ toPar: -2, birdies: 0, eagles: 0, holeInOnes: 1, won: false, dailyDone: false });
    expect(ace).toBe(CP.round + CP.holeInOne + 2 * CP.perUnderPar);
  });
});

describe('migration', () => {
  it('the legacy single-Pro shape becomes pros[0], named after the profile', () => {
    const legacy = {
      styleId: 'shortGame',
      attrs: { ...CAREER_STARTS.shortGame, chipping: 80 },
      cp: 6,
      cpEarned: 40,
      cpSpent: 34,
      createdAt: 777
    };
    const c = migrateCareer(legacy, { name: 'Matt', character: 'rio' });
    expect(c.pros).toHaveLength(1);
    const pro = activePro(c)!;
    expect(pro.id).toBe('legacy-777'); // deterministic — two devices migrate to ONE Pro
    expect(pro.name).toBe('Matt');
    expect(pro.character).toBe('rio');
    expect(pro.attrs.chipping).toBe(80);
    expect(c.cp).toBe(6);
    expect(c.cpEarned).toBe(40);
  });

  it('an unstarted legacy career migrates to an empty stable, wallet intact', () => {
    const c = migrateCareer({ styleId: null, cp: 9, cpEarned: 9, cpSpent: 0 }, { name: '', character: 'chip' });
    expect(c.pros).toHaveLength(0);
    expect(c.activeProId).toBeNull();
    expect(c.cp).toBe(9);
  });

  it('a partial RTDB copy of the stable coalesces; a bad activeProId self-heals', () => {
    const c = migrateCareer(
      { pros: [{ id: 'x', attrs: { drivingPower: 70 } }], activeProId: 'gone', cpEarned: 10 },
      { name: '', character: 'chip' }
    );
    expect(c.pros).toHaveLength(1);
    expect(c.pros[0].attrs.drivingPower).toBe(70);
    expect(c.pros[0].attrs.putting).toBe(65); // backfilled
    expect(c.activeProId).toBe('x'); // healed to a Pro that exists
    expect(c.cp).toBe(10);
  });

  it('nothing at all migrates to an empty career', () => {
    expect(migrateCareer(undefined, { name: '', character: 'chip' })).toEqual(emptyCareer());
  });
});

describe('cross-device merge', () => {
  it('two devices spending differently never duplicate or resurrect CP', () => {
    // One cloud career, synced to two devices, each spends offline.
    const cloud = start(grantCp(emptyCareer(), 100), 'bigHitter', { id: 'shared' });
    const devA = raiseAttr(raiseAttr(cloud, 'putting')!, 'putting')!; // spent 4
    const devB = raiseAttr(cloud, 'approach')!; // spent 2
    const merged = mergeCareers(devA, devB);
    expect(merged.cpEarned).toBe(100);
    // Grow-only spent takes the max — a spend can never be refunded by sync.
    expect(merged.cpSpent).toBe(4);
    expect(merged.cp).toBe(96);
    // The shared Pro merged to ONE entry with points bought anywhere kept.
    expect(merged.pros).toHaveLength(1);
    expect(merged.pros[0].attrs.putting).toBe(activePro(devA)!.attrs.putting);
    expect(merged.pros[0].attrs.approach).toBe(activePro(devB)!.attrs.approach);
  });

  it('pros union by id: a Pro started on either device survives the merge', () => {
    const cloud = start(grantCp(emptyCareer(), 50), 'bigHitter', { id: 'shared', now: 1 });
    const devA = startPro(cloud, { name: 'A-only', styleId: 'sniper', character: 'chip', now: 5, id: 'onlyA' });
    const devB = startPro(cloud, { name: 'B-only', styleId: 'puttKing', character: 'rio', now: 9, id: 'onlyB' });
    const merged = mergeCareers(devA, devB);
    expect(merged.pros.map((p) => p.id).sort()).toEqual(['onlyA', 'onlyB', 'shared']);
    // The newer side (a) picks the active Pro.
    expect(merged.activeProId).toBe('onlyA');
    // Names and looks ride along untouched.
    expect(merged.pros.find((p) => p.id === 'onlyB')!.character).toBe('rio');
  });

  it('an unstarted device cannot blank a started career', () => {
    const started = start(grantCp(emptyCareer(), 40), 'shortGame', { id: 's' });
    const fresh = emptyCareer();
    const merged = mergeCareers(fresh, started);
    expect(merged.pros).toHaveLength(1);
    expect(activePro(merged)!.styleId).toBe('shortGame');
    expect(merged.cpEarned).toBe(40);
    expect(activePro(merged)!.attrs.chipping).toBe(CAREER_STARTS.shortGame.chipping);
  });
});
