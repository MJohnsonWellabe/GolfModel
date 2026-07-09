import { describe, expect, it } from 'vitest';
import {
  defaultProfile,
  KVStorage,
  loadProfile,
  mergeProfiles,
  PlayerProfile,
  resetProfileRecords,
  saveProfile
} from '../src/profile/Profile';

function memStorage(): KVStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v)
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

describe('mergeProfiles — progress is never lost', () => {
  function pair(): [PlayerProfile, PlayerProfile] {
    const a = defaultProfile();
    const b = defaultProfile();
    a.updatedAt = 100;
    b.updatedAt = 200;
    return [a, b];
  }

  it('coins follow the most recent copy (spend must persist); xp still takes the max', () => {
    const [a, b] = pair(); // a.updatedAt=100, b.updatedAt=200 → b is newer
    a.coins = 500;
    b.coins = 90; // spent down on the newer device
    a.xp = 1000;
    b.xp = 2500;
    const m = mergeProfiles(a, b);
    // Coins are SPENDABLE: a plain max would resurrect currency the player just
    // spent, so the balance follows the last write instead of the max.
    expect(m.coins).toBe(90);
    // XP only ever grows, so it stays a max regardless of recency.
    expect(m.xp).toBe(2500);
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
