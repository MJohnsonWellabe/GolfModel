import { Golfer } from '../core/types';
import { AIPersonality } from '../systems/AIController';

/**
 * AI rivals/partners for 1v1 and scramble. Difficulty follows the GDD tiers
 * (Easy ≈ +2 · Medium ≈ E · Hard ≈ −2 · Legend ≈ −4 per 18, scaled to our
 * 3-hole rounds by the Phase 2 scoring calibration: stats ~74/82/90/95).
 * Personality changes HOW they attack holes, not just how well (GDD §AI:
 * "different AI golfers should attack holes differently").
 */

export interface AIOpponent extends Golfer {
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Legend';
  tagline: string;
  personality: AIPersonality;
}

export const OPPONENTS: AIOpponent[] = [
  {
    // id kept as 'sunny' — it's persisted in profiles as opponentId, so renaming
    // the id would orphan saved rival selections. Display name is JD.
    id: 'sunny',
    name: 'JD',
    color: 0xe8a13a,
    character: 'milo',
    difficulty: 'Easy',
    tagline: '100% swing, about 60% idea where it goes',
    // A big, aggressive bomber who sprays it — long off the tee, wild everywhere.
    personality: { aggression: 0.65, layupBias: 0.25, pinHunting: 0.45 },
    // Maxed distance, limited accuracy, solid-but-not-special elsewhere — overall
    // ≈ Sergio (OVR ~82), but the wildness makes him beatable (the Easy slot).
    stats: { drivingPower: 100, drivingAccuracy: 62, approach: 82, chipping: 82, putting: 82 }
  },
  {
    id: 'sergio',
    name: 'Sergio',
    color: 0xe0b03a,
    character: 'enzo',
    difficulty: 'Medium',
    tagline: 'Fairways and greens, never a gamble',
    personality: { aggression: 0.35, layupBias: 0.7, pinHunting: 0.35 },
    stats: { drivingPower: 82, drivingAccuracy: 86, approach: 83, chipping: 80, putting: 80 }
  },
  {
    id: 'phil',
    name: 'Phil',
    color: 0x3a3f4a,
    character: 'cole',
    difficulty: 'Hard',
    tagline: 'Short-game gambler — attacks every flag',
    personality: { aggression: 0.75, layupBias: 0.25, pinHunting: 0.9 },
    stats: { drivingPower: 88, drivingAccuracy: 84, approach: 91, chipping: 93, putting: 89 }
  },
  {
    id: 'tiger',
    name: 'Tiger',
    color: 0xcc2222,
    character: 'knox',
    difficulty: 'Legend',
    tagline: 'Relentless. Goes for everything, makes everything',
    personality: { aggression: 0.9, layupBias: 0.1, pinHunting: 0.8 },
    stats: { drivingPower: 96, drivingAccuracy: 92, approach: 95, chipping: 93, putting: 95 }
  }
];
