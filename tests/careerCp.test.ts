import { describe, expect, it } from 'vitest';
import {
  activePro,
  CareerState,
  emptyCareer,
  grantCp,
  grantCpTo,
  mergeCareers,
  migrateCareer,
  proCp,
  proCpEarned,
  proCpSpent,
  raiseAttr,
  setActivePro,
  spendCpFrom,
  startPro,
  pointsAffordable,
  UNCLAIMED_CP
} from '../src/data/career';
import { defaultProfile, KVStorage, loadProfile, mergeProfiles, saveProfile } from '../src/profile/Profile';
import { buyProAttrPoint, grantCareerCp, proCpBalance, spendableCp } from '../src/systems/CareerWallet';
import { recordTourSeasonFinish, SEASON_LIMIT } from '../src/systems/TourSeason';

/**
 * CP PER PRO (owner, verbatim): "Cp earned with a pro should be assigned to
 * that pro. You shouldn't have a bunch when you start a new golfer but it
 * also shouldn't go away in case your not done with the first golfer."
 *
 * Those are two promises pulling opposite ways — a rookie must be poor AND a
 * half-finished veteran must keep their savings — and only a per-Pro ledger
 * satisfies both. Everything here guards one of them, or guards the currency
 * itself: a migration or a merge that mints or eats CP is the failure nobody
 * can undo by playing.
 */

const startAt = (c: CareerState, id: string, now = 1000): CareerState =>
  startPro(c, { name: id, styleId: 'bigHitter', character: 'chip', now, id });

function memStorage(): KVStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe('a Pro banks their own CP', () => {
  it('a rookie starts at zero while the Pro before them keeps every unspent point', () => {
    // The whole ask in one case: the veteran is mid-career (20 earned, 4
    // spent), the player tries a rookie, and neither the rookie's poverty nor
    // the veteran's savings surprise them when they switch back.
    let c = grantCpTo(startAt(emptyCareer(), 'vet'), 'vet', 20);
    c = raiseAttr(raiseAttr(c, 'putting')!, 'putting')!; // 4 CP into the vet
    c = startAt(c, 'rookie', 2000);
    expect(c.cp).toBe(0); // the rookie earns their own way
    expect(proCp(c, 'vet')).toBe(16);
    c = setActivePro(c, 'vet');
    expect(c.cp).toBe(16); // still there, unspent, whenever the vet is picked up again
    expect(proCpEarned(c, 'vet')).toBe(20); // and the vet's own record of it stands
    expect(proCpSpent(c, 'vet')).toBe(4);
    expect(proCpEarned(c, 'rookie')).toBe(0);
    expect(c.cpEarned).toBe(20); // the stable's lifetime total is unchanged by any of it
    expect(c.cpSpent).toBe(4);
  });

  it('earning with one Pro never moves another Pro’s balance', () => {
    let c = startAt(startAt(emptyCareer(), 'a'), 'b', 2000);
    c = grantCpTo(c, 'a', 30);
    c = grantCp(c, 12); // unnamed: credits whoever is playing, which is b
    expect(proCp(c, 'a')).toBe(30);
    expect(proCp(c, 'b')).toBe(12);
    expect(c.cpEarned).toBe(42);
  });

  it('a Pro can only spend what they themselves earned', () => {
    // A rich veteran in the same stable is not a line of credit: the rookie's
    // buy has to fail on the rookie's own balance, or "start at zero" is a
    // display detail rather than a rule.
    let c = grantCpTo(startAt(emptyCareer(), 'vet'), 'vet', 500);
    c = startAt(c, 'rookie', 2000);
    expect(raiseAttr(c, 'putting')).toBeNull();
    expect(spendCpFrom(c, 'rookie', 1)).toBeNull();
    c = grantCp(c, 2);
    const bought = raiseAttr(c, 'putting');
    expect(bought).not.toBeNull();
    expect(proCp(bought!, 'rookie')).toBe(0);
    expect(proCp(bought!, 'vet')).toBe(500); // untouched by the neighbour's spending
  });

  it('CP banked before a career starts belongs to the first Pro, and to nobody after', () => {
    // Playing a lesson or a casual round before starting a career should not
    // be unpaid work — but it must not top up every rookie forever either.
    let c = grantCp(emptyCareer(), 25);
    expect(proCp(c, UNCLAIMED_CP)).toBe(25);
    c = startAt(c, 'first');
    expect(proCp(c, 'first')).toBe(25);
    // The row itself stays put (moving it is what would double-count it on a
    // second device) — it is simply read as part of the first Pro's balance,
    // so the stable's total never grows by folding it in.
    expect(c.cpEarned).toBe(25);
    c = startAt(c, 'second', 2000);
    expect(c.cp).toBe(0);
    expect(proCp(c, 'second')).toBe(0);
  });
});

describe('migrating the account-wide wallet', () => {
  it('the legacy balance lands whole on the Pro who was playing', () => {
    const legacy = {
      pros: [
        { id: 'old', name: 'Old', styleId: 'sniper', attrs: {}, character: 'chip', createdAt: 1 },
        { id: 'now', name: 'Now', styleId: 'bigHitter', attrs: {}, character: 'chip', createdAt: 2 }
      ],
      activeProId: 'now',
      cp: 40,
      cpEarned: 60,
      cpSpent: 20
    };
    const c = migrateCareer(legacy, { name: 'Matt', character: 'chip' });
    expect(proCp(c, 'now')).toBe(40); // the balance the player last saw, intact
    expect(proCp(c, 'old')).toBe(0);
    expect(c.cpEarned).toBe(60); // and the lifetime totals still add up
    expect(c.cpSpent).toBe(20);
  });

  it('running it twice neither doubles the balance nor clears it', () => {
    // The migration reads fields it also writes (the derived totals), so a
    // second pass over its own output — a reload, a cloud copy coming back —
    // has to be a no-op. Belt: the cpPerPro marker. Braces: the ledger it
    // wrote is itself the evidence, so even a marker lost in transit is safe.
    const legacy = { pros: [{ id: 'p', name: 'P', styleId: 'sniper', attrs: {}, character: 'chip', createdAt: 1 }], activeProId: 'p', cpEarned: 50, cpSpent: 8 };
    const once = migrateCareer(legacy, { name: '', character: 'chip' });
    const twice = migrateCareer(JSON.parse(JSON.stringify(once)), { name: '', character: 'chip' });
    expect(twice).toEqual(once);
    const markerLost = { ...JSON.parse(JSON.stringify(once)), cpPerPro: undefined };
    expect(migrateCareer(markerLost, { name: '', character: 'chip' }).cpLedger).toEqual(once.cpLedger);
    expect(proCp(twice, 'p')).toBe(42);
  });

  it('a legacy balance with no Pro yet waits for the first one', () => {
    const c = migrateCareer({ styleId: null, cp: 9, cpEarned: 9, cpSpent: 0 }, { name: '', character: 'chip' });
    expect(c.pros).toHaveLength(0);
    expect(c.cp).toBe(9); // readable before a career exists, exactly as before
    expect(proCp(startAt(c, 'first'), 'first')).toBe(9);
  });

  it('the legacy single-Pro save gives its balance to the Pro it grew', () => {
    const c = migrateCareer(
      { styleId: 'shortGame', attrs: { chipping: 80 }, cp: 6, cpEarned: 40, cpSpent: 34, createdAt: 777 },
      { name: 'Matt', character: 'rio' }
    );
    expect(activePro(c)!.id).toBe('legacy-777');
    expect(proCp(c, 'legacy-777')).toBe(6);
    expect(c.cpEarned).toBe(40);
  });
});

describe('merging two devices', () => {
  it('two Pros grown on two devices keep both balances, counted once each', () => {
    const shared = startAt(emptyCareer(), 'shared');
    const devA = grantCpTo(shared, 'shared', 30); // the same Pro, played here
    const devB = grantCpTo(startAt(shared, 'other', 3000), 'other', 25); // a new Pro there
    const merged = mergeCareers(devA, devB);
    expect(proCp(merged, 'shared')).toBe(30);
    expect(proCp(merged, 'other')).toBe(25);
    expect(merged.cpEarned).toBe(55); // no CP minted, none dropped
  });

  it('a spend on one device is never refunded by the other', () => {
    // Both devices start from the same cloud copy; one buys points, the other
    // sat idle. Max-merging the grow-only pair per Pro is what stops the idle
    // copy handing the CP back.
    const cloud = grantCpTo(startAt(emptyCareer(), 'p'), 'p', 100);
    const spender = raiseAttr(raiseAttr(cloud, 'putting')!, 'putting')!; // 4 CP
    const idle = cloud;
    const merged = mergeCareers(idle, spender); // idle is the "newer" side
    expect(proCp(merged, 'p')).toBe(96);
    expect(merged.cpSpent).toBe(4);
    expect(activePro(merged)!.attrs.putting).toBe(activePro(spender)!.attrs.putting);
  });

  it('one legacy wallet split onto different Pros on two devices is not minted twice', () => {
    // The nastiest case in the whole change: the update lands on two devices
    // that disagree about who was playing, so each attributes the SAME 100 CP
    // to a different Pro. Without the split stamp the player would end up
    // with 200 they never earned.
    const stored = {
      pros: [
        { id: 'x', name: 'X', styleId: 'sniper', attrs: {}, character: 'chip', createdAt: 1 },
        { id: 'y', name: 'Y', styleId: 'sniper', attrs: {}, character: 'chip', createdAt: 2 }
      ],
      cpEarned: 100,
      cpSpent: 0
    };
    const devA = migrateCareer({ ...stored, activeProId: 'x' }, { name: '', character: 'chip' });
    const devB = migrateCareer({ ...stored, activeProId: 'y' }, { name: '', character: 'chip' });
    const merged = mergeCareers(devA, devB);
    expect(merged.cpEarned).toBe(100);
    expect(proCp(merged, 'x') + proCp(merged, 'y')).toBe(100);
    // Both devices then play on, each with their own attribution: the pool is
    // still counted once, and the CP earned since is added to it.
    const merged2 = mergeCareers(grantCpTo(devA, 'x', 10), grantCpTo(devB, 'y', 7));
    expect(merged2.cpEarned).toBe(117);
  });

  it('a device that never started a career cannot strand the CP it banked', () => {
    // One device banked CP before any Pro existed; the other started the
    // career. The bucket has to end up on the first Pro, not in a corner of
    // the ledger nobody can spend from.
    const banked = grantCp(emptyCareer(), 20);
    const started = grantCpTo(startAt(banked, 'first'), 'first', 5);
    const merged = mergeCareers(banked, started);
    expect(proCp(merged, 'first')).toBe(25);
    expect(merged.cpEarned).toBe(25);
  });

  it('a cloud copy that never went through the migration still brings its CP', () => {
    // mergeProfiles normalizes both sides first, but a raw pre-ledger copy
    // slipping past it must not read as "this Pro has no CP" — that would
    // silently delete a real balance on the way in.
    const raw = {
      pros: [{ id: 'p', name: 'P', styleId: 'sniper', attrs: {}, character: 'chip', createdAt: 1 }],
      activeProId: 'p',
      cp: 30,
      cpEarned: 30,
      cpSpent: 0
    } as unknown as CareerState;
    const local = migrateCareer({ ...raw, cpEarned: 30 }, { name: '', character: 'chip' });
    expect(mergeCareers(local, raw).cpEarned).toBe(30);
    expect(proCp(mergeCareers(local, raw), 'p')).toBe(30);
  });

  it('whole profiles merge the same way, through mergeProfiles', () => {
    const a = defaultProfile();
    a.career = grantCpTo(startAt(emptyCareer(), 'p'), 'p', 40);
    a.updatedAt = 200;
    const b = defaultProfile();
    b.career = grantCpTo(startAt(emptyCareer(), 'p'), 'p', 40);
    b.career = grantCpTo(startAt(b.career, 'q', 3000), 'q', 15);
    b.updatedAt = 100;
    const merged = mergeProfiles(a, b);
    expect(proCp(merged.career, 'p')).toBe(40);
    expect(proCp(merged.career, 'q')).toBe(15);
    expect(merged.career.cpEarned).toBe(55);
  });
});

describe('persistence', () => {
  it('a whole stable of balances survives a round trip through storage', () => {
    const s = memStorage();
    const p = defaultProfile();
    p.career = grantCpTo(startAt(emptyCareer(), 'vet'), 'vet', 33);
    p.career = grantCpTo(startAt(p.career, 'rookie', 4000), 'rookie', 7);
    saveProfile(p, s, 1);
    const back = loadProfile(s);
    expect(proCp(back.career, 'vet')).toBe(33);
    expect(proCp(back.career, 'rookie')).toBe(7);
    expect(back.career.cp).toBe(7); // the rookie is active, so the rookie's balance reads
    expect(back.career.cpEarned).toBe(40);
  });

  /**
   * The owner's scenario, to the number (owner: "if you're playing with your
   * first pro and have a Balance of 100cp … I want you to have 0 for the new
   * guy … but if you go back and select the original, you should have your 100
   * back to spend").
   *
   * The UI walk in tests/visual/career.spec.ts proves this on screen, but it
   * cannot prove it across a RELOAD: a guest profile is in-memory only
   * (persistProfile writes only when signed in), so the career would simply be
   * gone. Storage is a model concern, so the round trip is asserted here — and
   * asserted through `setActivePro`, because switching Pro is what re-derives
   * the displayed balance.
   */
  it('a hundred banked on one Pro is untouched by a second, and survives a reload', () => {
    const s = memStorage();
    const p = defaultProfile();
    p.career = grantCpTo(startAt(emptyCareer(), 'first'), 'first', 100);
    // A second Pro joins the stable and becomes active.
    p.career = startAt(p.career, 'second', 4000);

    // Before saving anything: the newcomer is broke and the first is intact.
    expect(proCp(p.career, 'second')).toBe(0);
    expect(p.career.cp, 'the active rookie shows nothing to spend').toBe(0);
    expect(proCp(p.career, 'first')).toBe(100);

    saveProfile(p, s, 1);
    const back = loadProfile(s);

    // Reloaded: still one wallet each, still the right way round.
    expect(proCp(back.career, 'first')).toBe(100);
    expect(proCp(back.career, 'second')).toBe(0);
    // Selecting the original brings its hundred back as the live balance.
    const reselected = setActivePro(back.career, 'first');
    expect(reselected.cp, 'going back to the original restores their 100').toBe(100);
    // …and switching away hides it again rather than lending it out.
    expect(setActivePro(reselected, 'second').cp).toBe(0);
  });
});

describe('a retired Pro', () => {
  it('keeps the CP they earned on the books, but can no longer spend it', () => {
    // Ten seasons and the career is over (TourSeason.SEASON_LIMIT). Their CP
    // is NOT forfeited — the ledger row is part of their record, like their
    // wins — it is simply frozen: the growing is done.
    const p = defaultProfile();
    p.career = startAt(emptyCareer(), 'vet');
    grantCareerCp(p, 60);
    expect(spendableCp(p)).toBe(60);
    for (let n = 1; n <= SEASON_LIMIT; n++) recordTourSeasonFinish(p.tourHistory, 'vet', 'Vet', n, 3, 900);
    expect(buyProAttrPoint(p, 'putting')).toBe(false);
    expect(spendableCp(p)).toBe(0);
    expect(proCpBalance(p, 'vet')).toBe(60); // kept, not taken
    // The one thing that changes it is the one thing the game asks for: a new
    // Pro, who starts at zero and can spend from their first round.
    p.career = startAt(p.career, 'rookie', 9000);
    expect(spendableCp(p)).toBe(0);
    grantCareerCp(p, 2);
    expect(spendableCp(p)).toBe(2);
    expect(buyProAttrPoint(p, 'putting')).toBe(true);
    expect(proCpBalance(p, 'vet')).toBe(60);
  });
});

/**
 * THE CP PREVIEW ON THE STAT BAR (Stage 2.3).
 *
 * The ghost segment promises "this is what your bank buys here". It has to be
 * charged through the same cost brackets and stop at the same ceiling as the
 * buy button, or the card advertises points `buyProAttrPoint` will refuse.
 */
describe('pointsAffordable', () => {
  it('charges the same brackets pointCost does', () => {
    // Under 80: 2 CP a point.
    expect(pointsAffordable(65, 10)).toBe(5);
    // Across the 80 boundary: 78 -> 80 costs 2+2, then 4 a point.
    expect(pointsAffordable(78, 4)).toBe(2);
    expect(pointsAffordable(78, 8)).toBe(3);
    // Across the 90 boundary: 89 -> 90 costs 4, then 10 a point.
    expect(pointsAffordable(89, 4)).toBe(1);
    expect(pointsAffordable(89, 13)).toBe(1);
    expect(pointsAffordable(89, 14)).toBe(2);
  });

  it('buys nothing with an empty bank, and never goes negative', () => {
    expect(pointsAffordable(65, 0)).toBe(0);
    expect(pointsAffordable(65, 1)).toBe(0);
  });

  it('stops at the 99 base cap', () => {
    expect(pointsAffordable(99, 10_000)).toBe(0);
    expect(pointsAffordable(97, 10_000)).toBe(2);
  });

  it('stops at the EFFECTIVE 100 ceiling the buy stops at', () => {
    // 94 base + a +6 club bonus is already at the clamp: the buy refuses, so
    // the preview must not draw a ghost either.
    expect(pointsAffordable(94, 10_000, 6)).toBe(0);
    expect(pointsAffordable(92, 10_000, 6)).toBe(2);
  });

  it('agrees with actually spending the bank one point at a time', () => {
    const p = defaultProfile();
    p.career = startPro(emptyCareer(), { name: 'Ghost', styleId: 'bigHitter', character: 'chip', now: 1, id: 'p1' });
    grantCareerCp(p, 30);
    const pro = activePro(p.career)!;
    const predicted = pointsAffordable(pro.attrs.putting, spendableCp(p));
    let bought = 0;
    while (buyProAttrPoint(p, 'putting')) bought += 1;
    expect(bought).toBe(predicted);
  });
});
