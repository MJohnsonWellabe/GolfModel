import { grantPerk, PlayerProfile } from '../profile/Profile';
import { SeasonDef, SeasonReward } from '../data/seasonPass';
import { STORE_BY_ID } from '../data/storeCatalog';
import { perkById } from '../data/perks';
import { levelForXp } from '../data/progression';
import { BuyResult } from './StoreEngine';

/**
 * Pure season-pass logic (mirrors StoreEngine/ProgressionEngine style).
 * Everyone accrues pass XP while the season is live; claiming a reward
 * requires owning the pass. Claims stay open after the season ends (grace —
 * earned rewards are never taken away), only accrual stops.
 *
 * XP grants from the track raise profile XP/level but deliberately do NOT
 * feed back into season XP — pass progress comes from playing rounds only,
 * which keeps the ~1000-rounds-to-max pacing honest.
 */

export type ClaimState = 'locked' | 'needsPass' | 'claimable' | 'claimed';

/** [start 00:00, end 24:00) in the player's local time. */
export function seasonActive(def: SeasonDef, now: number): boolean {
  const start = new Date(`${def.start}T00:00:00`).getTime();
  const endEx = new Date(`${def.end}T00:00:00`).getTime() + 86400000;
  return now >= start && now < endEx;
}

/** Pass level for an XP total (level 0 = nothing reached yet). */
export function seasonLevel(def: SeasonDef, xp: number): number {
  return Math.min(def.levels, Math.floor(xp / def.xpPerLevel));
}

/** Accrue pass XP from a finished round. No-op outside the season window or
 *  if the profile is tracking a different season. */
export function addSeasonXp(profile: PlayerProfile, def: SeasonDef, amount: number, now: number): void {
  if (!seasonActive(def, now)) return;
  if (profile.season.id !== def.id) return;
  profile.season.xp += Math.max(0, amount);
}

export function claimState(profile: PlayerProfile, def: SeasonDef, level: number): ClaimState {
  if (profile.season.claimed.includes(level)) return 'claimed';
  if (seasonLevel(def, profile.season.xp) < level) return 'locked';
  return profile.season.owned ? 'claimable' : 'needsPass';
}

/** Claim the reward for a reached level. Grants the reward and records the
 *  claim; the caller persists + cloud-syncs (same as a store buy). */
export function claimReward(profile: PlayerProfile, def: SeasonDef, level: number): BuyResult {
  if (level < 1 || level > def.levels) return { ok: false, reason: 'No such level' };
  const state = claimState(profile, def, level);
  if (state === 'claimed') return { ok: false, reason: 'Already claimed' };
  if (state === 'locked') return { ok: false, reason: 'Level not reached' };
  if (state === 'needsPass') return { ok: false, reason: 'Season Pass required' };
  const reward = def.rewards[level - 1];
  grantReward(profile, reward);
  profile.season.claimed.push(level);
  return { ok: true };
}

function grantReward(profile: PlayerProfile, reward: SeasonReward): void {
  if ('item' in reward) {
    // Granting an already-owned item (e.g. a track character bought earlier
    // in the store) is a harmless no-op — the claim still marks done.
    if (!profile.cosmetics.owned.includes(reward.item)) profile.cosmetics.owned.push(reward.item);
  } else if ('perk' in reward) {
    const def = perkById(reward.perk);
    if (def) grantPerk(profile, def.id, def.rounds);
  } else if ('coins' in reward) {
    profile.coins += reward.coins;
    profile.coinsEarned += reward.coins; // grow-only lifetime tally
  } else {
    profile.xp += reward.xp;
    profile.level = levelForXp(profile.xp);
  }
}

/** Display label + emoji for a reward card. */
export function rewardLabel(reward: SeasonReward): { icon: string; name: string } {
  if ('coins' in reward) return { icon: '🪙', name: `${reward.coins} J-Coins` };
  if ('xp' in reward) return { icon: '✨', name: `${reward.xp} XP` };
  if ('perk' in reward) return { icon: '⚡', name: perkById(reward.perk)?.name ?? 'Perk' };
  const item = STORE_BY_ID.get(reward.item);
  if (!item) return { icon: '🎁', name: reward.item };
  const icons: Record<string, string> = {
    ball: '⛳',
    trail: '💫',
    character: '🧑',
    outfit: '👕',
    clubskin: '🏌️',
    pal: '🐾'
  };
  return { icon: icons[item.kind] ?? '🎁', name: item.name };
}
