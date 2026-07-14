import { GolferStats } from '../core/types';
import { SWING } from '../config';
import { UpgradeFamily, upgradeFamilyForClub } from './storeCatalog';

/**
 * Perks — consumable, per-round skill boosts (season-pass rewards). Each perk
 * mirrors the matching STORE CLUB UPGRADE so its behavior is already understood:
 *
 *  - a **driver** perk buys distance (a stat bump + the same +3%/+6% carry
 *    multiplier a driver upgrade grants — see PhysicsEngine.upgradeCarryMult);
 *  - an **irons / wedges / putter** perk changes NO distance and NO stat; it
 *    widens the swing-meter perfect/good zone exactly like that family's club
 *    upgrade (perkPerfectZoneMult, layered on top of any owned upgrade + fire).
 *
 * A perk has a number of ROUNDS of use; a charge is spent only on a round the
 * player equips it (Locker Room). Perks are inventory items on the profile, not
 * cosmetics — they are never bought with coins.
 */

export interface PerkDef {
  id: string;
  /** Card label, e.g. "Driver Boost ++". */
  name: string;
  /** Which club family the boost applies to (mirrors upgradeFamilyForClub). */
  family: UpgradeFamily;
  /** 1 = "+" (like upgrade tier 1), 2 = "++" (like upgrade tier 2). */
  tier: 1 | 2;
  /** Rounds of use granted. */
  rounds: 1 | 3 | 5;
}

const def = (id: string, name: string, family: UpgradeFamily, tier: 1 | 2, rounds: 1 | 3 | 5): PerkDef => ({
  id,
  name,
  family,
  tier,
  rounds
});

/** The five season-1 perks (the ++ / 5-round driver is the major last-page one). */
export const PERKS: PerkDef[] = [
  def('perk_drive_t1_r1', 'Driver Boost +', 'driver', 1, 1),
  def('perk_wedge_t1_r3', 'Short Game +', 'wedges', 1, 3),
  def('perk_iron_t2_r3', 'Approach ++', 'irons', 2, 3),
  def('perk_putt_t1_r5', 'Putting +', 'putter', 1, 5),
  def('perk_drive_t2_r5', 'Driver Boost ++', 'driver', 2, 5)
];

const PERK_BY_ID = new Map(PERKS.map((p) => [p.id, p]));
export const perkById = (id: string | null | undefined): PerkDef | undefined =>
  id ? PERK_BY_ID.get(id) : undefined;

/** How much a perk lifts stats. Only the DRIVER perk touches stats (drivingPower
 *  + drivingAccuracy, +3/+6). Iron/wedge/putter perks return {} — they widen the
 *  meter zone instead (perkPerfectZoneMult), never distance. */
export function perkStatBoost(perk: PerkDef | undefined): Partial<GolferStats> {
  if (!perk || perk.family !== 'driver') return {};
  const d = perk.tier * 3;
  return { drivingPower: d, drivingAccuracy: d };
}

/** The compact modifier carried on the runtime Golfer so the physics seams
 *  (carry multiplier + meter perfect zone) can read the equipped perk. */
export function perkModifier(perk: PerkDef | undefined): { family: UpgradeFamily; tier: number } | undefined {
  return perk ? { family: perk.family, tier: perk.tier } : undefined;
}

/** Swing-meter perfect-zone multiplier from an equipped perk, for a given club.
 *  Mirrors upgradePerfectZoneMult tier-for-tier and returns 1 for the driver
 *  family (which buys distance instead) or a non-matching club. The caller
 *  MULTIPLIES this with the upgrade zone and fire, so a perk always layers on
 *  top of everything the player already has. */
export function perkPerfectZoneMult(clubId: string, perk: { family: UpgradeFamily; tier: number } | null | undefined): number {
  if (!perk || perk.family === 'driver') return 1;
  if (upgradeFamilyForClub(clubId) !== perk.family) return 1;
  const fire = SWING.firePerfectMult;
  return perk.tier === 1 ? 1 + (fire - 1) * 0.5 : fire;
}

/** Short human effect line for the Locker Room card. */
export function perkEffectLabel(perk: PerkDef): string {
  const skill =
    perk.family === 'driver' ? 'driving distance'
    : perk.family === 'irons' ? 'approach control'
    : perk.family === 'wedges' ? 'short-game control'
    : 'putting control';
  return perk.family === 'driver'
    ? `+${perk.tier * 3} ${skill}`
    : `Wider perfect zone — ${skill}`;
}
