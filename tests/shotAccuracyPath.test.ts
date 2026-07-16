import { describe, expect, it } from 'vitest';
import { PX_PER_YARD } from '../src/config';
import { clubById } from '../src/data/clubs';
import { PhysicsEngine } from '../src/systems/PhysicsEngine';
import { Golfer, SwingResult } from '../src/core/types';
import { openHole } from './simulation/simHelpers';

const hole = openHole();
const golfer: Golfer = {
  id: 'acc', name: 'Accuracy', color: 0xffffff, look: { skin: 0, shirt: 0, hat: null, hair: null },
  stats: { drivingPower: 85, drivingAccuracy: 85, approach: 85, chipping: 85, putting: 85 }
};
const club = clubById('7i');

function outcome(accuracy: number, power = 0.82) {
  const abs = Math.abs(accuracy);
  const swing: SwingResult = {
    power,
    powerQuality: power === 0.82 ? 'perfect' : abs < 0.12 ? 'good' : 'miss',
    accuracy,
    accuracyQuality: accuracy === 0 ? 'perfect' : abs < 0.12 ? 'good' : 'miss'
  };
  return new PhysicsEngine(hole).simulate({
    origin: { x: 1000, y: 2800 },
    aimAngle: -Math.PI / 2,
    swing,
    club,
    golfer,
    fireBoost: 0,
    lie: 'tee',
    wind: { angle: 0, speed: 0 },
    hole,
    preview: true
  });
}
const lateral = (accuracy: number) => Math.abs(outcome(accuracy).finalPos.x - 1000) / PX_PER_YARD;
const distance = (power: number) => Math.abs(outcome(0, power).finalPos.y - 2800) / PX_PER_YARD;

describe('shot resolution scales timing misses proportionally', () => {
  it('directional error grows monotonically for late timing misses', () => {
    const vals = [0, 0.015, 0.05, 0.11, 0.35, 1].map(lateral);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
    expect(vals[1]).toBeLessThan(vals[4] * 0.15);
  });

  it('early and late misses are symmetric enough that tiny misses cannot become extreme', () => {
    expect(lateral(-0.015)).toBeLessThan(lateral(-0.35) * 0.15);
    expect(Math.abs(lateral(-0.11) - lateral(0.11))).toBeLessThan(1.5);
  });

  it('distance error scales with supplied power misses independently of direction', () => {
    const ys = [0.82, 0.78, 0.7, 0.55, 0.35].map(distance);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThanOrEqual(ys[i - 1] + 0.01);
  });
});
