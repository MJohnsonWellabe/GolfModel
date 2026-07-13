import { Golfer } from '../core/types';
import { ArchetypeId, archetypeById } from './archetypes';
import { CharacterKey } from './characters';
import { applyClubUpgrades } from './storeCatalog';

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
  clubUpgrades: Record<string, number> = {}
): Golfer {
  const arch = archetypeById(archetype);
  return {
    id: `${character}-${archetype}`,
    name: name.trim() || 'Player',
    color: arch.color,
    character,
    stats: applyClubUpgrades(arch.stats, clubUpgrades),
    // Carried through so effectiveCarryYards can apply the per-family carry
    // bonus directly — the stat bump above is capped at 100 and vanishes for a
    // golfer already maxed in the governing stat (e.g. a Big Hitter's driver).
    clubUpgrades
  };
}
