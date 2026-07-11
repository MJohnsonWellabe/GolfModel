import { describe, expect, it } from 'vitest';
import { PhysicsEngine, effectiveCarryYards } from '../../src/systems/PhysicsEngine';
import { buildHeightField } from '../../src/systems/HeightField';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { golferWith, PERFECT_SWING } from './simHelpers';
import type { HoleData } from '../../src/core/types';
import wildwood from '../../src/data/courses/wildwood.json';
import sablebay from '../../src/data/courses/sablebay.json';
import timberline from '../../src/data/courses/timberline.json';

/**
 * Driver distance guard. Carry is on-spec (~320 at power 100), but a big topspin
 * swipe used to run a low-struck drive out to 440+ yds (uncapped `spin.top` hit
 * the bounce-retention ceiling). Topspin is now capped (±1.5, main.ts
 * applySwipeSpin) and the ceiling lowered — worst case must stay sane on every
 * hole: full-power big hitter, low/flat strike, max topspin, max tailwind.
 */
const driver = clubById('driver');
const bigHitter = golferWith(100);
const courses = [wildwood, sablebay, timberline] as unknown as { holes: HoleData[] }[];

function worstCaseDrive(hole: HoleData): number {
  const origin = { ...hole.tee };
  const aim = Math.atan2(hole.pin.y - origin.y, hole.pin.x - origin.x);
  const out = new PhysicsEngine(hole, buildHeightField(hole), mulberry32(2)).simulate({
    origin,
    aimAngle: aim,
    swing: PERFECT_SWING(1.0),
    club: driver,
    golfer: bigHitter,
    fireBoost: 0,
    lie: 'tee',
    wind: { angle: aim, speed: 20 }, // max tailwind
    hole,
    launchMult: 0.35, // low, flat strike — lands hot
    spin: { side: 0, top: 1.5 } // topspin at the applied cap
  });
  return Math.hypot(out.finalPos.x - origin.x, out.finalPos.y - origin.y) / 2;
}

describe('driver distance stays sane with capped topspin', () => {
  it('no worst-case drive exceeds 370 yds on any hole', () => {
    for (const course of courses) {
      for (const hole of course.holes) {
        const total = worstCaseDrive(hole);
        expect(total, `${(hole as HoleData).name ?? 'hole'} total`).toBeLessThanOrEqual(370);
      }
    }
  });
});

/**
 * Playtest check ("woods out of the fairway go too short"): document, not change
 * (Matt's call). A wood's carry from the ROUGH vs a clean tee/fairway lie is
 * governed by PHYSICS.lieDistance (the wood-family driveDistanceScale applies to
 * both, so it cancels in the ratio). This locks the current ~25% rough loss so a
 * future retune is a deliberate, visible edit rather than a silent drift.
 */
describe('wood carry by lie (documented)', () => {
  for (const clubId of ['driver', '3w']) {
    it(`${clubId} keeps a sane fraction of its tee carry from the fairway and rough`, () => {
      const club = clubById(clubId);
      const g = golferWith(90);
      const tee = effectiveCarryYards(club, g, 0, 'tee');
      const fairway = effectiveCarryYards(club, g, 0, 'fairway');
      const rough = effectiveCarryYards(club, g, 0, 'rough');
      // A clean fairway lie plays the same as the tee (no penalty).
      expect(fairway / tee).toBeCloseTo(1, 5);
      // Rough currently costs ~25% (lieDistance.rough = 0.75). Guard a band so an
      // accidental change trips the test; tightening toward ≤10% is a config edit.
      expect(rough / tee).toBeGreaterThan(0.7);
      expect(rough / tee).toBeLessThan(0.8);
    });
  }
});
