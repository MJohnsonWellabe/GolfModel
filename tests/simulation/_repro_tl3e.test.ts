import { describe, it } from 'vitest';
import { writeFileSync } from 'fs';
import timberlineV2 from '../../src/data/courses/v2/timberline.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { collectTreeBlobs } from '../../src/systems/treeField';
import { simulateRound } from '../../src/systems/RoundSimulator';
import { mulberry32 } from '../../src/utils/Random';
import { golferWith } from './simHelpers';
import { Hazard } from '../../src/core/types';

const OUT = '/tmp/claude-0/-home-user/dfe4e2d5-ec7d-58bc-86bb-a04745c2265b/scratchpad/repro5.txt';
const lines: string[] = [];
const log = (...a: unknown[]) => lines.push(a.map(String).join(' '));

const SPECIES = {
  trees: (timberlineV2 as any).theme.treeKeys as string[],
  accents: (timberlineV2 as any).theme.accentTreeKeys as string[]
};

// FINAL candidate stand — "LEFT-APPROACH GUARD".
const GUARD: Hazard = {
  type: 'trees', spacing: 16, visualSpacing: 12, treeR: 26,
  polygon: [[606, 596], [636, 566], [678, 566], [714, 572], [718, 594], [684, 616], [636, 624]]
} as Hazard;

function authoringWithGuard(withGuard: boolean): CourseAuthoring {
  const c = JSON.parse(JSON.stringify(timberlineV2)) as any;
  if (withGuard) {
    const h3 = c.holes.find((h: any) => h.number === 3);
    h3.hazards.push(GUARD);
  }
  return c as CourseAuthoring;
}

function meanToPar(course: CourseAuthoring, bounded = false) {
  const c = loadCourse(course);
  const golfer = golferWith(85);
  let sum = 0, unfinished = 0;
  const N = 60;
  const h3strokes: number[] = [];
  for (let s = 0; s < N; s++) {
    const r = simulateRound(c, golfer, 7000 + s * 17, undefined, bounded);
    sum += r.toPar;
    for (const h of r.holes) if (!h.holed) unfinished++;
    if (r.holes[2]) h3strokes.push(r.holes[2].strokes);
  }
  const h3mean = h3strokes.reduce((a, b) => a + b, 0) / h3strokes.length;
  return { mean: sum / N, unfinished, h3mean };
}

describe('REPRO TL East h3 — FINAL validation', () => {
  it('trunk safety + playability', () => {
    // 1. No guard trunk in water or on the fairway.
    const c = loadCourse(authoringWithGuard(true));
    const h3 = c.holes.find((h) => h.number === 3)!;
    const eng = new PhysicsEngine(h3 as any, null, mulberry32(1), SPECIES);
    const guardBlobs = collectTreeBlobs(h3 as any, 0, false, SPECIES)
      .filter((b) => b.x >= 600 && b.x <= 720 && b.y >= 560 && b.y <= 630 && !(Math.abs(b.x - 719) < 3 && Math.abs(b.y - 582) < 3));
    log('GUARD stand collision trunks:', guardBlobs.length);
    let inWater = 0, inFairway = 0, inRough = 0, other = 0;
    for (const b of guardBlobs) {
      const surf = String(eng.surfaceAt(b.x, b.y));
      if (surf === 'water') inWater++;
      else if (surf === 'fairway') inFairway++;
      else if (surf === 'rough') inRough++;
      else { other++; log('   trunk', b.x.toFixed(0), b.y.toFixed(0), 'surf', surf); }
    }
    log(`   surfaces: water ${inWater} fairway ${inFairway} rough ${inRough} other ${other}`);

    // 2. Playability: baseline vs guard.
    log('\n-- PLAYABILITY (60 rounds, golfer 85) --');
    const base = meanToPar(authoringWithGuard(false));
    const guard = meanToPar(authoringWithGuard(true));
    log(`   BASELINE:  mean ${base.mean.toFixed(2)}  unfinished ${base.unfinished}  h3mean ${base.h3mean.toFixed(2)}`);
    log(`   WITH GUARD: mean ${guard.mean.toFixed(2)}  unfinished ${guard.unfinished}  h3mean ${guard.h3mean.toFixed(2)}`);
    log('\n-- PLAYABILITY BOUNDED --');
    const baseB = meanToPar(authoringWithGuard(false), true);
    const guardB = meanToPar(authoringWithGuard(true), true);
    log(`   BASELINE:  mean ${baseB.mean.toFixed(2)}  unfinished ${baseB.unfinished}  h3mean ${baseB.h3mean.toFixed(2)}`);
    log(`   WITH GUARD: mean ${guardB.mean.toFixed(2)}  unfinished ${guardB.unfinished}  h3mean ${guardB.h3mean.toFixed(2)}`);

    writeFileSync(OUT, lines.join('\n'));
  }, 120000);
});
