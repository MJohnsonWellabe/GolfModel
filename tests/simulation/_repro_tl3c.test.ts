import { describe, it } from 'vitest';
import { writeFileSync } from 'fs';
import timberlineV2 from '../../src/data/courses/v2/timberline.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { NO_WIND, SWING_OF, golferWith } from './simHelpers';
import { HoleData } from '../../src/core/types';

const OUT = '/tmp/claude-0/-home-user/dfe4e2d5-ec7d-58bc-86bb-a04745c2265b/scratchpad/repro3.txt';
const lines: string[] = [];
const log = (...a: unknown[]) => lines.push(a.map(String).join(' '));

const SPECIES = {
  trees: (timberlineV2 as any).theme.treeKeys as string[],
  accents: (timberlineV2 as any).theme.accentTreeKeys as string[]
};
const PIN = { x: 827.3, y: 377.5 };

function getHole(): HoleData {
  const c = loadCourse(timberlineV2 as unknown as CourseAuthoring);
  return c.holes.find((h) => h.number === 3) as unknown as HoleData;
}

// Monkeypatch: wrap surfaceAt? No — instead re-implement a trajectory probe by
// stepping through simulate and reading the returned path if available.
describe('trajectory height probe', () => {
  it('dumps flight height over the tree corridor', () => {
    const hole = getHole();
    // Instrument: run several shots, but we need per-step height. simulate returns
    // finalPos only. So temporarily hook the private integrate by sampling the
    // engine's exposed trajectory if present.
    const club = clubById('3w');
    const spots = [
      { name: 'rough-L 186yd', x: 585, y: 660, lie: 'rough' },
      { name: 'rough-midL 170yd', x: 610, y: 640, lie: 'rough' },
      { name: 'fw-exit 182yd', x: 660, y: 700, lie: 'fairway' }
    ];
    for (const spot of spots) {
      const aimA = Math.atan2(PIN.y - spot.y, PIN.x - spot.x);
      const eng = new PhysicsEngine(hole, null, mulberry32(50), SPECIES);
      const out: any = eng.simulate({
        origin: { x: spot.x, y: spot.y }, aimAngle: aimA,
        swing: SWING_OF(1.0, 'perfect', 0),
        club, golfer: golferWith(82), fireBoost: 0, lie: spot.lie as any, wind: NO_WIND, hole, stroke: 1
      });
      log(`\n${spot.name}: finalPos (${out.finalPos.x.toFixed(0)},${out.finalPos.y.toFixed(0)}) surf ${out.surface} hitTrees ${out.hitTrees}`);
      log('  out keys:', Object.keys(out).join(','));
      const path = out.trajectory ?? out.path ?? out.samples ?? null;
      if (path) {
        log('  path length', path.length);
        for (const p of path) {
          const px = p.x ?? p[0], py = p.y ?? p[1], pz = p.z ?? p[2];
          // ground ~ 0 baseline for these; log height where x in tree corridor
          if (px >= 660 && px <= 800) log(`   x${px.toFixed(0)} y${py.toFixed(0)} z${(pz??0).toFixed(1)}`);
        }
      } else {
        log('  NO trajectory array on result');
      }
    }
    writeFileSync(OUT, lines.join('\n'));
  });
});
