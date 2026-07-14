import { Golfer, GolferStats } from '../core/types';
import { ArchetypeId, archetypeById } from './archetypes';
import { CharacterKey } from './characters';
import { applyClubUpgrades } from './storeCatalog';
import { PerkDef, perkModifier, perkStatBoost } from './perks';

/**
 * A golfer's identity is assembled at runtime from three independent choices
 * the player makes on the setup screen — a typed **name**, a cosmetic
 * **character** avatar, and a gameplay **archetype** — rather than being a
 * fixed roster entry. This keeps the two axes orthogonal (any character can
 * play as any archetype) and leaves `Golfer.stats` as the single seam the
 * physics engine reads.
 */
export function assembleGolfer(
  name: string,
  character: CharacterKey,
  archetype: ArchetypeId,
  /** Purchased club upgrades (family → tier); each tier adds +3, capped 100. */
  clubUpgrades: Record<string, number> = {},
  /** Equipped season-pass perk for this round (layers on top of upgrades). */
  perk?: PerkDef
): Golfer {
  const arch = archetypeById(archetype);
  return {
    id: `${character}-${archetype}`,
    name: name.trim() || 'Player',
    color: arch.color,
    character,
    // Perk stat boost (driver perk only) layers on top of the club-upgrade
    // stats — same 110 sanity bound applyClubUpgrades uses.
    stats: addStatBoost(applyClubUpgrades(arch.stats, clubUpgrades), perkStatBoost(perk)),
    // Carried through so effectiveCarryYards can apply the per-family carry
    // bonus directly — the stat bump above is capped at 100 and vanishes for a
    // golfer already maxed in the governing stat (e.g. a Big Hitter's driver).
    clubUpgrades,
    perk: perkModifier(perk)
  };
}

/** Add a stat delta on top of an existing block, bounded at 110 (the same
 *  sanity cap applyClubUpgrades uses). */
function addStatBoost(stats: GolferStats, boost: Partial<GolferStats>): GolferStats {
  const out = { ...stats };
  for (const k of Object.keys(boost) as Array<keyof GolferStats>) {
    out[k] = Math.min(110, out[k] + (boost[k] ?? 0));
  }
  return out;
}
