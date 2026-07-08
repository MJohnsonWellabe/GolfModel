import { describe, expect, it } from 'vitest';
import {
  defaultProfile,
  KVStorage,
  loadProfile,
  mergeProfiles,
  PlayerProfile,
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

  it('coins/xp take the max regardless of recency', () => {
    const [a, b] = pair();
    a.coins = 500;
    b.coins = 90;
    a.xp = 1000;
    b.xp = 2500;
    const m = mergeProfiles(a, b);
    expect(m.coins).toBe(500);
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
