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
    id: 'sunny',
    name: 'Sunny',
    color: 0xe8a13a,
    character: 'sunny',
    difficulty: 'Easy',
    tagline: 'Plays it safe, smiles a lot',
    personality: { aggression: 0.2, layupBias: 0.8, pinHunting: 0.2 },
    stats: { drivingPower: 74, drivingAccuracy: 76, approach: 74, chipping: 72, putting: 74 }
  },
  {
    id: 'sergio',
    name: 'Sergio',
    color: 0xe0b03a,
    character: 'rio',
    difficulty: 'Medium',
    tagline: 'Fairways and greens, never a gamble',
    personality: { aggression: 0.35, layupBias: 0.7, pinHunting: 0.35 },
    stats: { drivingPower: 82, drivingAccuracy: 86, approach: 83, chipping: 80, putting: 80 }
  },
  {
    id: 'phil',
    name: 'Phil',
    color: 0x3a3f4a,
    character: 'dez',
    difficulty: 'Hard',
    tagline: 'Short-game gambler — attacks every flag',
    personality: { aggression: 0.75, layupBias: 0.25, pinHunting: 0.9 },
    stats: { drivingPower: 88, drivingAccuracy: 84, approach: 91, chipping: 93, putting: 89 }
  },
  {
    id: 'tiger',
    name: 'Tiger',
    color: 0xcc2222,
    character: 'kuro',
    difficulty: 'Legend',
    tagline: 'Relentless. Goes for everything, makes everything',
    personality: { aggression: 0.9, layupBias: 0.1, pinHunting: 0.8 },
    stats: { drivingPower: 96, drivingAccuracy: 92, approach: 95, chipping: 93, putting: 95 }
  }
];
