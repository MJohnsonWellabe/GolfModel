import { describe, expect, it } from 'vitest';
import {
  clearLocalProfile,
  defaultProfile,
  KVStorage,
  loadProfile,
  mergeProfiles,
  PlayerProfile,
  resetProfileRecords,
  saveProfile
} from '../src/profile/Profile';

function memStorage(): KVStorage & { removeItem: (k: string) => void; has: (k: string) => boolean } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    has: (k) => m.has(k)
  };
}

describe('profile persistence', () => {
  it('round-trips through storage', () => {
    const s = memStorage();
    const p = defaultProfile();
    p.name = 'Matt';
    p.coins = 120;
    saveProfile(p, s, 111);
    const back = loadProfile(s);
    expect(back.name).toBe('Matt');
    expect(back.coins).toBe(120);
    expect(back.updatedAt).toBe(111);
  });

  it('returns a fresh default when storage is empty or corrupt', () => {
    const s = memStorage();
    expect(loadProfile(s).name).toBe('');
    s.setItem('johnsons-golf-profile-v1', '{not json');
    expect(loadProfile(s).level).toBe(1);
  });

  it('migrates forward: missing fields fill from defaults', () => {
    const s = memStorage();
    s.setItem('johnsons-golf-profile-v1', JSON.stringify({ v: 1, name: 'Old', coins: 7 }));
    const p = loadProfile(s);
    expect(p.name).toBe('Old');
    expect(p.coins).toBe(7);
    expect(p.settings.sound).toBeGreaterThan(0);
    expect(p.stats.rounds).toBe(0);
  });
});

describe('account-gated model', () => {
  it('clearLocalProfile wipes the persisted profile so sign-out shows a clean slate', () => {
    const s = memStorage();
    const p = defaultProfile();
    p.name = 'Matt';
    p.coins = 500;
    saveProfile(p, s, 1);
    expect(s.has('johnsons-golf-profile-v1')).toBe(true);
    clearLocalProfile(s);
    // Nothing persists — a reload loads a fresh, empty (0-coin) profile.
    const back = loadProfile(s);
    expect(back.name).toBe('');
    expect(back.coins).toBe(0);
    expect(back.level).toBe(1);
  });

  it('first sign-in folds pre-existing local progress into the (empty) account, losing nothing', () => {
    // Live signed-out profile is a fresh empty default; the browser still holds
    // legacy local progress from before accounts were gated.
    const empty = defaultProfile();
    empty.updatedAt = 500; // the live empty profile is the most-recently-touched
    const legacy = defaultProfile();
    legacy.updatedAt = 10;
    legacy.coinsEarned = 640;
    legacy.coins = 640;
    legacy.cosmetics.owned.push('ball-red');
    legacy.stats.birdies = 8;
    // adoptCloudAccount seeds the sync with mergeProfiles(live, legacy).
    const seeded = mergeProfiles(empty, legacy);
    expect(seeded.coins).toBe(640);
    expect(seeded.cosmetics.owned).toContain('ball-red');
    expect(seeded.stats.birdies).toBe(8);
  });
});

describe('mergeProfiles — progress is never lost', () => {
  function pair(): [PlayerProfile, PlayerProfile] {
    const a = defaultProfile();
    const b = defaultProfile();
    a.updatedAt = 100;
    b.updatedAt = 200;
    return [a, b];
  }

  it('a spend survives the merge (grow-only spent counter), xp still takes the max', () => {
    const [a, b] = pair();
    // Both started at 1000 earned; the newer copy (b) spent 910 down to 90.
    a.coinsEarned = 1000;
    a.coinsSpent = 0;
    a.coins = 1000;
    b.coinsEarned = 1000;
    b.coinsSpent = 910;
    b.coins = 90;
    a.xp = 1000;
    b.xp = 2500;
    const m = mergeProfiles(a, b);
    // Spent only grows, so the debit isn't resurrected: 1000 − 910 = 90.
    expect(m.coins).toBe(90);
    expect(m.coinsSpent).toBe(910);
    expect(m.xp).toBe(2500); // grow-only
  });

  it('logging in on a wiped device never loses the cloud balance', () => {
    const [fresh, cloud] = pair(); // fresh.updatedAt=100 (older) ... make it NEWER
    fresh.updatedAt = 300; // fresh empty profile is the most-recently-touched
    // Fresh local profile after clearing browser data: nothing earned/spent.
    fresh.coinsEarned = 0;
    fresh.coinsSpent = 0;
    fresh.coins = 0;
    // The Google account in the cloud holds a real balance.
    cloud.coinsEarned = 1000;
    cloud.coinsSpent = 200;
    cloud.coins = 800;
    const m = mergeProfiles(fresh, cloud);
    // earned/spent are grow-only, so the empty-but-newer local can't wipe it.
    expect(m.coins).toBe(800);
    expect(m.coinsEarned).toBe(1000);
    expect(m.coinsSpent).toBe(200);
  });

  it('coalesces pre-counter saves (balance falls back into earned)', () => {
    const [a, b] = pair();
    // Legacy cloud copy written before the counters existed: only `coins`.
    b.coinsEarned = undefined as unknown as number;
    b.coinsSpent = undefined as unknown as number;
    b.coins = 640;
    a.coinsEarned = 0;
    a.coinsSpent = 0;
    a.coins = 0;
    const m = mergeProfiles(a, b);
    expect(m.coins).toBe(640); // legacy balance treated as earned, preserved
  });

  it('collections union, career counters max, best-round min', () => {
    const [a, b] = pair();
    a.cosmetics.owned = ['ball-red', 'char-nova'];
    b.cosmetics.owned = ['ball-red', 'trail-fire'];
    a.achievements = ['first-birdie'];
    b.achievements = ['first-eagle'];
    a.stats.birdies = 12;
    b.stats.birdies = 9;
    a.stats.bestRoundToPar = -1;
    b.stats.bestRoundToPar = -3;
    a.clubUpgrades = { driver: 1 };
    b.clubUpgrades = { putter: 1, driver: 0 };
    const m = mergeProfiles(a, b);
    expect(m.cosmetics.owned.sort()).toEqual(['ball-red', 'char-nova', 'trail-fire']);
    expect(m.achievements.sort()).toEqual(['first-birdie', 'first-eagle']);
    expect(m.stats.birdies).toBe(12);
    expect(m.stats.bestRoundToPar).toBe(-3);
    expect(m.clubUpgrades).toEqual({ driver: 1, putter: 1 });
  });

  it('preferences follow the most recently updated copy', () => {
    const [a, b] = pair();
    a.name = 'Old Name';
    b.name = 'New Name';
    b.settings.reducedMotion = true;
    const m = mergeProfiles(a, b);
    expect(m.name).toBe('New Name');
    expect(m.settings.reducedMotion).toBe(true);
    expect(m.updatedAt).toBe(200);
  });
});

describe('resetProfileRecords', () => {
  it('clears stats/achievements/xp/daily but keeps coins, cosmetics and name', () => {
    const p = defaultProfile();
    p.name = 'Matt';
    p.coins = 640;
    p.xp = 3200;
    p.level = 7;
    p.stats.birdies = 22;
    p.stats.holeInOnes = 3;
    p.achievements = ['first-birdie', 'first-eagle'];
    p.cosmetics.owned.push('char_nova');
    p.clubUpgrades = { driver: 2 };
    p.dailyStreak = 5;
    resetProfileRecords(p, 999);
    expect(p.stats.birdies).toBe(0);
    expect(p.stats.holeInOnes).toBe(0);
    expect(p.achievements).toEqual([]);
    expect(p.xp).toBe(0);
    expect(p.level).toBe(1);
    expect(p.dailyStreak).toBe(0);
    // Purchases + identity survive a records reset.
    expect(p.coins).toBe(640);
    expect(p.name).toBe('Matt');
    expect(p.cosmetics.owned).toContain('char_nova');
    expect(p.clubUpgrades).toEqual({ driver: 2 });
    expect(p.updatedAt).toBe(999);
  });
});
