import { Golfer, GolferStats } from '../core/types';
import { ArchetypeId, archetypeById, ARCHETYPES } from './archetypes';
import { CAREER_ARCHETYPE_ID } from './career';
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
 *
 * CAREER MODE adds a sixth "archetype": the player's own Pro. Its id is
 * `career` and its stat block comes from the profile (`careerStats`), not the
 * preset table — everything downstream (upgrades, perks, physics, recording,
 * replay) treats it identically, which is what keeps a career round exactly
 * as verifiable as a preset one.
 */
export function assembleGolfer(
  name: string,
  character: CharacterKey,
  archetype: ArchetypeId | typeof CAREER_ARCHETYPE_ID,
  /** Purchased club upgrades (family → tier); each tier adds +3, capped 100. */
  clubUpgrades: Record<string, number> = {},
  /** Equipped season-pass perk for this round (layers on top of upgrades). */
  perk?: PerkDef,
  /** The Pro's attributes, REQUIRED when archetype === 'career' (the caller
   *  owns where they come from — live profile, or a recording being
   *  replayed). */
  careerStats?: GolferStats
): Golfer {
  const isCareer = archetype === CAREER_ARCHETYPE_ID;
  if (isCareer && !careerStats) throw new Error('career golfer needs careerStats');
  const arch = isCareer ? null : archetypeById(archetype);
  const baseStats = isCareer ? (careerStats as GolferStats) : (arch as NonNullable<typeof arch>).stats;
  return {
    id: `${character}-${archetype}`,
    name: name.trim() || 'Player',
    // The Pro wears its starting style's accent when it has one; a neutral
    // gold otherwise. Cosmetic only.
    color: arch?.color ?? 0xd9a441,
    character,
    // Perk stat boost (driver perk only) layers on top of the club-upgrade
    // stats — same 110 sanity bound applyClubUpgrades uses.
    stats: addStatBoost(applyClubUpgrades(baseStats, clubUpgrades), perkStatBoost(perk)),
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

/** Whether an archetype string names a preset (ARCHETYPES) rather than the
 *  career Pro — the guard callers use before archetypeById. */
export function isPresetArchetype(id: string): id is ArchetypeId {
  return ARCHETYPES.some((a) => a.id === id);
}
