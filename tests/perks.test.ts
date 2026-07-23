import { describe, expect, it } from 'vitest';
import { defaultProfile, grantPerk, mergeProfiles, perkRemaining, PerkState } from '../src/profile/Profile';
import { PERKS, perkById, perkPerfectZoneMult, perkStatBoost } from '../src/data/perks';
import { assembleGolfer } from '../src/data/golfers';
import { effectiveCarryYards } from '../src/systems/PhysicsEngine';
import { clubById } from '../src/data/clubs';
import { SWING } from '../src/config';

const drive2 = perkById('perk_drive_t2_r5')!; // ++ driver, 5 rounds
const iron2 = perkById('perk_iron_t2_r3')!; // ++ irons, 3 rounds
const putt1 = perkById('perk_putt_t1_r5')!; // + putter, 5 rounds

describe('perk definitions', () => {
  it('ships exactly 5 perks with valid families/tiers/rounds', () => {
    expect(PERKS.length).toBe(5);
    for (const p of PERKS) {
      expect(['driver', 'irons', 'wedges', 'putter']).toContain(p.family);
      expect([1, 2]).toContain(p.tier);
      expect([1, 3, 5]).toContain(p.rounds);
    }
  });
});

describe('perkStatBoost', () => {
  it('only the driver perk lifts stats (drivingPower + accuracy)', () => {
    expect(perkStatBoost(drive2)).toEqual({ drivingPower: 6, drivingAccuracy: 6 });
    expect(perkStatBoost(iron2)).toEqual({});
    expect(perkStatBoost(putt1)).toEqual({});
  });
});

describe('driver perk = distance, layered on club upgrades', () => {
  it('adds carry on the driver beyond the base golfer', () => {
    const club = clubById('driver');
    const base = assembleGolfer('A', 'chip', 'sniper'); // sniper: not maxed in driving
    const perked = assembleGolfer('A', 'chip', 'sniper', {}, drive2);
    const d0 = effectiveCarryYards(club, base, 0, 'fairway');
    const d1 = effectiveCarryYards(club, perked, 0, 'fairway');
    expect(d1).toBeGreaterThan(d0);
  });

  it('layers ON TOP of a purchased driver upgrade (stacks, never replaces)', () => {
    const club = clubById('driver');
    const upgraded = assembleGolfer('A', 'chip', 'sniper', { driver: 2 });
    const upgradedPlusPerk = assembleGolfer('A', 'chip', 'sniper', { driver: 2 }, drive2);
    expect(effectiveCarryYards(club, upgradedPlusPerk, 0, 'fairway')).toBeGreaterThan(
      effectiveCarryYards(club, upgraded, 0, 'fairway')
    );
  });

  it('lengthens EVERY club (drivingPower is the global Power stat)', () => {
    // Skill model (owner): drivingPower = POWER, which sets the distance for
    // every club. So the driver perk's power boost lengthens irons/wedges/putts
    // too — the driver just gains the most (its woods-only carry multiplier
    // stacks on top, tested above). The old "driver perk is club-isolated for
    // distance" behaviour is intentionally gone under this model.
    const iron = clubById('7i');
    const base = assembleGolfer('A', 'chip', 'sniper');
    const perked = assembleGolfer('A', 'chip', 'sniper', {}, drive2);
    expect(effectiveCarryYards(iron, perked, 0, 'fairway')).toBeGreaterThan(
      effectiveCarryYards(iron, base, 0, 'fairway')
    );
  });
});

describe('non-driver perk = wider meter zone, no distance', () => {
  it('widens the perfect zone for the matching family only', () => {
    // irons perk applies to an iron, not to the putter or driver
    expect(perkPerfectZoneMult('7i', { family: 'irons', tier: 2 })).toBe(SWING.firePerfectMult);
    expect(perkPerfectZoneMult('putter', { family: 'irons', tier: 2 })).toBe(1);
    expect(perkPerfectZoneMult('driver', { family: 'driver', tier: 2 })).toBe(1); // driver buys distance
    expect(perkPerfectZoneMult('putter', { family: 'putter', tier: 1 })).toBeGreaterThan(1);
    expect(perkPerfectZoneMult('putter', null)).toBe(1);
  });

  it('an irons perk leaves iron distance untouched', () => {
    const iron = clubById('7i');
    const base = assembleGolfer('A', 'chip', 'ironMaiden');
    const perked = assembleGolfer('A', 'chip', 'ironMaiden', {}, iron2);
    expect(effectiveCarryYards(iron, perked, 0, 'fairway')).toBe(effectiveCarryYards(iron, base, 0, 'fairway'));
  });
});

describe('perk inventory (profile)', () => {
  it('grants stack rounds and remaining = granted − used', () => {
    const p = defaultProfile();
    grantPerk(p, 'perk_putt_t1_r5', 5);
    expect(perkRemaining(p.perks[0])).toBe(5);
    grantPerk(p, 'perk_putt_t1_r5', 3); // a second grant stacks
    expect(perkRemaining(p.perks[0])).toBe(8);
    p.perks[0].used = 8;
    expect(perkRemaining(p.perks[0])).toBe(0);
  });

  it('merge unions perks and takes the max grow-only counters (no resurrection)', () => {
    const a = defaultProfile();
    const b = defaultProfile();
    a.perks = [{ id: 'perk_putt_t1_r5', granted: 5, used: 3 }];
    b.perks = [
      { id: 'perk_putt_t1_r5', granted: 5, used: 1 }, // fewer used on this device
      { id: 'perk_iron_t2_r3', granted: 3, used: 0 }
    ];
    const m = mergeProfiles(a, b);
    const putt = m.perks.find((x: PerkState) => x.id === 'perk_putt_t1_r5')!;
    expect(putt.used).toBe(3); // the more-consumed value wins
    expect(perkRemaining(putt)).toBe(2);
    expect(m.perks.find((x: PerkState) => x.id === 'perk_iron_t2_r3')).toBeTruthy();
  });
});
