import { Golfer, HoleData, SwingResult } from '../../src/core/types';

/** Big flat open test hole: giant green, wide fairway corridor, no hazards. */
export function openHole(overrides: Partial<HoleData> = {}): HoleData {
  return {
    number: 1,
    par: 4,
    yardage: 400,
    world: { width: 3000, height: 3000 },
    tee: { x: 1500, y: 2800 },
    green: { cx: 1500, cy: 600, rx: 300, ry: 300 },
    slope: { angle: 0, strength: 0 },
    pin: { x: 1500, y: 600 },
    fairway: [
      [
        [1200, 2900],
        [1800, 2900],
        [1800, 100],
        [1200, 100]
      ]
    ],
    hazards: [],
    aiTargets: [],
    ...overrides
  };
}

export function golferWith(stat: number): Golfer {
  return {
    id: `sim${stat}`,
    name: `Sim ${stat}`,
    color: 0,
    stats: {
      drivingPower: stat,
      drivingAccuracy: stat,
      approach: stat,
      chipping: stat,
      putting: stat
    }
  };
}

export const PERFECT_SWING = (power: number): SwingResult => ({
  power,
  powerQuality: 'perfect',
  accuracy: 0,
  accuracyQuality: 'perfect'
});

export const SWING_OF = (power: number, quality: 'perfect' | 'good' | 'miss', accOffset: number): SwingResult => ({
  power,
  powerQuality: quality,
  accuracy: accOffset,
  accuracyQuality: quality
});

export const NO_WIND = { angle: 0, speed: 0 };

/** ft → world px (PX_PER_YARD = 2, 3ft per yard). */
export const ftToPx = (ft: number): number => (ft / 3) * 2;
