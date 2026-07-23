import { describe, it } from 'vitest';
import { writeFileSync } from 'fs';
import timberlineV2 from '../../src/data/courses/v2/timberline.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { collectTreeBlobs } from '../../src/systems/treeField';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { PX_PER_YARD } from '../../src/config';
import { NO_WIND, SWING_OF, golferWith } from './simHelpers';
import { HoleData, Hazard } from '../../src/core/types';

const OUT = '/tmp/claude-0/-home-user/dfe4e2d5-ec7d-58bc-86bb-a04745c2265b/scratchpad/repro4.txt';
const lines: string[] = [];
const log = (...a: unknown[]) => lines.push(a.map(String).join(' '));

const SPECIES = {
  trees: (timberlineV2 as any).theme.treeKeys as string[],
  accents: (timberlineV2 as any).theme.accentTreeKeys as string[]
};
const GREEN = { cx: 840, cy: 356, rx: 52, ry: 39, rot: -0.35 };
function onGreen(x: number, y: number): boolean {
  const dx = x - GREEN.cx, dy = y - GREEN.cy;
  const c = Math.cos(-GREEN.rot), s = Math.sin(-GREEN.rot);
  const rx = dx * c - dy * s, ry = dx * s + dy * c;
  return (rx * rx) / (GREEN.rx * GREEN.rx) + (ry * ry) / (GREEN.ry * GREEN.ry) <= 1;
}
const PIN = { x: 827.3, y: 377.5 };
const ydTo = (x: number, y: number, tx: number, ty: number) => Math.hypot(tx - x, ty - y) / PX_PER_YARD;

function baseHole(extra: Hazard[]): HoleData {
  const c = loadCourse(timberlineV2 as unknown as CourseAuthoring);
  const h = JSON.parse(JSON.stringify(c.holes.find((hh) => hh.number === 3))) as HoleData;
  (h.hazards as Hazard[]).push(...extra);
  return h;
}

type Spot = { name: string; x: number; y: number; lie: string; aimAt?: { x: number; y: number } };
const IMPERFECT: Spot[] = [
  { name: 'rough-L 186yd(shot)', x: 585, y: 660, lie: 'rough' },
  { name: 'rough-midL 170yd', x: 610, y: 640, lie: 'rough' },
  { name: 'rough-L 200yd', x: 600, y: 690, lie: 'rough' },
  { name: 'rough-farL 190yd', x: 560, y: 640, lie: 'rough' }
];
const PERFECT: Spot[] = [
  { name: 'fw-exit straight', x: 660, y: 700, lie: 'fairway' },
  { name: 'fw-exit shaped(aim R of spruce)', x: 660, y: 700, lie: 'fairway', aimAt: { x: 905, y: 430 } }
];
const SAFE: Spot[] = [
  { name: 'right-fw 233yd', x: 878, y: 840, lie: 'fairway' },
  { name: 'right-fw exit 161yd', x: 890, y: 694, lie: 'fairway' }
];

function runSpots(label: string, spots: Spot[], extra: Hazard[], club = clubById('3w')) {
  for (const spot of spots) {
    let reached = 0, treeHits = 0, water = 0;
    const N = 60;
    const target = spot.aimAt ?? PIN;
    const aimA = Math.atan2(target.y - spot.y, target.x - spot.x);
    for (let s = 0; s < N; s++) {
      const hole = baseHole(extra);
      const eng = new PhysicsEngine(hole, null, mulberry32(50 + s * 13), SPECIES);
      const out = eng.simulate({
        origin: { x: spot.x, y: spot.y }, aimAngle: aimA,
        swing: SWING_OF(1.0, s % 4 === 0 ? 'perfect' : 'good', 0),
        club, golfer: golferWith(82), fireBoost: 0, lie: spot.lie as any, wind: NO_WIND, hole, stroke: 1
      });
      if (out.hitTrees) treeHits++;
      if (out.waterPenalty) water++;
      if (onGreen(out.finalPos.x, out.finalPos.y)) reached++;
    }
    log(`   [${label}] ${spot.name} (${ydTo(spot.x,spot.y,PIN.x,PIN.y).toFixed(0)}yd): green ${reached}/${N} trees ${treeHits}/${N} water ${water}/${N}`);
  }
}

// Pond-aware blocking stands, placed in the DRY rough SOUTH of the front pond,
// on the imperfect-drive->green diagonal. Pond south shore runs
// (636,520)-(646,544)-(672,556)-(716,560)-(762,542); stays north of these.
const CANDIDATES: Record<string, Hazard[]> = {
  'NONE (baseline)': [],
  'D pond-south sp18': [
    { type: 'trees', spacing: 18, visualSpacing: 13, treeR: 24,
      polygon: [[628,584],[636,562],[672,568],[712,572],[716,590],[690,608],[650,610]] }
  ],
  'E pond-south wider sp16': [
    { type: 'trees', spacing: 16, visualSpacing: 12, treeR: 26,
      polygon: [[606,596],[636,566],[678,566],[714,572],[718,594],[684,616],[636,624]] }
  ],
  'F pond-south long sp16': [
    { type: 'trees', spacing: 16, visualSpacing: 12, treeR: 26,
      polygon: [[590,610],[624,572],[672,566],[714,572],[718,596],[680,622],[624,636],[588,634]] }
  ]
};

describe('REPRO TL East h3 — pond-aware walls', () => {
  it('dumps', () => {
    for (const [name, extra] of Object.entries(CANDIDATES)) {
      log(`\n===== CANDIDATE: ${name} =====`);
      if (extra.length) {
        const blobs = collectTreeBlobs(baseHole(extra), 0, false, SPECIES);
        const inBox = blobs.filter((b) => b.x >= 580 && b.x <= 730 && b.y >= 540 && b.y <= 650);
        log('  new-stand collision trunks in band:', inBox.length,
            inBox.map((b) => `(${b.x.toFixed(0)},${b.y.toFixed(0)})`).join(' '));
      }
      log('  -- IMPERFECT (want: green LOW, trees HIGH) --');
      runSpots('imp', IMPERFECT, extra);
      log('  -- PERFECT drive corridor (want: shaped shot still reaches green) --');
      runSpots('perf', PERFECT, extra);
      log('  -- SAFE right route (want: UNAFFECTED) --');
      runSpots('safe', SAFE, extra);
    }
    writeFileSync(OUT, lines.join('\n'));
  });
});
