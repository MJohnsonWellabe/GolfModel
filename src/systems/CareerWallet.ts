import { activePro, cpTargetId, grantCpTo, proCp, raiseAttr } from '../data/career';
import type { StatKey } from '../data/archetypes';
import type { PlayerProfile } from '../profile/Profile';
import { proRetired } from './TourSeason';

/**
 * CP, at the profile level: WHO earned it and WHO may spend it.
 *
 * `data/career.ts` owns the per-Pro ledger and the maths; it is pure and knows
 * nothing about retirement. This module is the seam where the ledger meets the
 * rest of the profile — the record book (`tourHistory`) is what says a Pro has
 * played out their SEASON_LIMIT seasons, and a retired Pro is done growing.
 * Every reward path and the Locker's spend button go through here, so there is
 * exactly one answer to "whose CP is this?".
 *
 * THE RETIREMENT RULE (owner intent: unspent CP "shouldn't go away in case
 * you're not done with the first golfer" — the worry is an UNFINISHED Pro):
 * a retired Pro's CP is NEVER forfeited. Their ledger row stands as the record
 * of what that career earned and spent, exactly like their wins and majors.
 * It is simply no longer SPENDABLE: the career is over, so the attributes stop
 * moving. Nothing is deleted, so the rule can be relaxed later without having
 * destroyed anything. CP a retired Pro goes on earning in casual rounds is
 * credited to them too — the ledger stays an honest record of who played — and
 * the game already tells the player the one thing that changes that: start a
 * new Pro, who earns from their first round.
 */

/** The ledger row the next CP earned belongs to: the active Pro, or the
 *  unclaimed bucket when no career has been started yet (which the first Pro's
 *  balance includes). */
export function cpEarnerId(profile: PlayerProfile): string {
  return cpTargetId(profile.career);
}

/**
 * Credit earned CP to the Pro who earned it. With no `proId` it goes to
 * whoever is playing now (`cpEarnerId`) — which is what every reward path
 * wants, because CP is only ever paid for a round somebody just played.
 * Returns the ledger row credited, for analytics/summary lines.
 */
export function grantCareerCp(profile: PlayerProfile, amount: number, proId?: string): string {
  const target = proId ?? cpEarnerId(profile);
  profile.career = grantCpTo(profile.career, target, amount);
  return target;
}

/** What ONE named Pro has left — a retired Pro's balance still reads true
 *  here (it is kept, not forfeited); `spendableCp` is what may be SPENT. */
export function proCpBalance(profile: PlayerProfile, proId: string): number {
  return proCp(profile.career, proId);
}

/** True once this Pro has played out their SEASON_LIMIT seasons: their record
 *  is closed and their remaining CP is frozen. */
export function proCpFrozen(profile: PlayerProfile, proId: string): boolean {
  return proRetired(profile.tourHistory, proId);
}

/** What the player can spend RIGHT NOW: the active Pro's own balance, and
 *  zero when there is no active Pro or that Pro has retired. This is the
 *  number a "CP to spend" prompt should read — `profile.career.cp` is the
 *  active Pro's raw balance and does not know about retirement. */
export function spendableCp(profile: PlayerProfile): number {
  const pro = activePro(profile.career);
  if (!pro || proCpFrozen(profile, pro.id)) return 0;
  return proCp(profile.career, pro.id);
}

/**
 * Buy +1 on one attribute of the ACTIVE Pro, paid out of that Pro's own CP.
 * Mutates `profile.career` and returns true when the point was bought; false
 * (nothing changed) when there is no active Pro, that Pro has retired, the
 * attribute is capped, the point would be dead (base + upgrade bonus already
 * at the engine's 100 ceiling), or their balance falls short.
 */
export function buyProAttrPoint(profile: PlayerProfile, key: StatKey, upgradeBonus = 0): boolean {
  const pro = activePro(profile.career);
  if (!pro || proCpFrozen(profile, pro.id)) return false;
  const next = raiseAttr(profile.career, key, upgradeBonus);
  if (!next) return false;
  profile.career = next;
  return true;
}
