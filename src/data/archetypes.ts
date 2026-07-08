/**
 * Archetypes — the gameplay half of a golfer's identity (the cosmetic half is
 * the Character avatar in ./characters.ts). The player picks a name, a
 * character and one of these archetypes; the runtime golfer is assembled from
 * all three (see ./golfers.ts). Physics only ever reads Golfer.stats, so an
 * archetype is defined *entirely* by its stat block — no gameplay code branches
 * on which archetype is selected (per docs/04_TECHNICAL_ARCHITECTURE.md).
 *
 * Design (GDD 02 §Golfer Attributes + Master Vision): each archetype is elite
 * (100) in exactly one of the five stats and solid-to-good (79–87) in the rest,
 * so every archetype rounds to the SAME overall rating of 87 — identities are
 * sharply distinct while overalls stay close. The 79↔100 driving-power spread
 * maps through PhysicsEngine.effectiveCarryYards to roughly a 250→320-yard
 * driver, hitting the Appendix-A power range.
 */
import { GolferStats } from '../core/types';

export type StatKey = keyof GolferStats;

export type ArchetypeId = 'bigHitter' | 'sniper' | 'ironMaiden' | 'shortGame' | 'puttKing';

export interface Archetype {
  id: ArchetypeId;
  name: string;
  /** One-line identity shown on the select card. */
  tagline: string;
  /** The single stat this archetype is elite in. */
  signature: StatKey;
  /** Accent color for the card, aim marker and HUD. */
  color: number;
  stats: GolferStats;
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'bigHitter',
    name: 'Big Hitter',
    tagline: 'Bombs it off the tee.',
    signature: 'drivingPower',
    color: 0xe8562f,
    stats: { drivingPower: 100, drivingAccuracy: 83, approach: 86, chipping: 84, putting: 82 }
  },
  {
    id: 'sniper',
    name: 'Sniper',
    tagline: 'Splits every fairway.',
    signature: 'drivingAccuracy',
    color: 0x2f7fd8,
    stats: { drivingPower: 85, drivingAccuracy: 100, approach: 85, chipping: 83, putting: 82 }
  },
  {
    id: 'ironMaiden',
    name: 'Iron Maiden',
    tagline: 'Deadly from the fairway.',
    signature: 'approach',
    color: 0x8455d0,
    stats: { drivingPower: 84, drivingAccuracy: 85, approach: 100, chipping: 84, putting: 82 }
  },
  {
    id: 'shortGame',
    name: 'Short-Game Maestro',
    tagline: 'Magic around the greens.',
    signature: 'chipping',
    color: 0x3fae5c,
    stats: { drivingPower: 79, drivingAccuracy: 85, approach: 86, chipping: 100, putting: 85 }
  },
  {
    id: 'puttKing',
    name: 'Putt King',
    tagline: 'Never misses inside ten.',
    signature: 'putting',
    color: 0xd9a441,
    stats: { drivingPower: 79, drivingAccuracy: 84, approach: 85, chipping: 87, putting: 100 }
  }
];

const BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));

export function archetypeById(id: string): Archetype {
  const a = BY_ID.get(id as ArchetypeId);
  if (!a) throw new Error(`Unknown archetype: ${id}`);
  return a;
}
