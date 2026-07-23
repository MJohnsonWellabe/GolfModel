import { describe, it } from 'vitest';
import { writeFileSync } from 'fs';
import timberlineV2 from '../../src/data/courses/v2/timberline.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { PX_PER_YARD } from '../../src/config';
import { NO_WIND, SWING_OF, golferWith } from './simHelpers';
import { HoleData, Hazard } from '../../src/core/types';

const OUT = '/tmp/claude-0/-home-user/dfe4e2d5-ec7d-58bc-86bb-a04745c2265b/scratchpad/repro2.txt';
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

type Spot = { name: string; x: number; y: number; lie: string; aimAt?: {x:number;y:number} };
const IMPERFECT: Spot[] = [
  { name: 'rough-L 186yd(shot)', x: 585, y: 660, lie: 'rough' },
  { name: 'rough-midL 170yd', x: 610, y: 640, lie: 'rough' },
  { name: 'rough-L 200yd', x: 600, y: 690, lie: 'rough' },
  { name: 'rough-farL 190yd', x: 560, y: 640, lie: 'rough' }
];
// Perfect drive: fairway exit; the aggressor shapes AROUND the spruce (aim right of it).
const PERFECT: Spot[] = [
  { name: 'fw-exit straight', x: 660, y: 700, lie: 'fairway' },
  { name: 'fw-exit shaped(aim right of spruce)', x: 660, y: 700, lie: 'fairway', aimAt: { x: 900, y: 430 } }
];
// Safe RIGHT route second: from right fairway exit.
const SAFE: Spot[] = [
  { name: 'right-fw 250yd', x: 878, y: 840, lie: 'fairway' },
  { name: 'right-fw exit 170yd', x: 890, y: 694, lie: 'fairway' }
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

// Candidate blocking stands. Each is a `trees` hazard added to the hole.
const CANDIDATES: Record<string, Hazard[]> = {
  'NONE (baseline)': [],
  // A: diagonal wall NW of the spruce, covering the imperfect sightline band
  //    x[680,748] y[470,545], tight spacing so every gap closes.
  'A stand x685-748 y468-548 sp16': [
    { type: 'trees', spacing: 16, visualSpacing: 12, treeR: 24,
      polygon: [[686,548],[706,500],[730,470],[748,486],[730,520],[708,548]] }
  ],
  // B: same footprint but larger/denser + extend the spruce up
  'B stand x678-752 y460-556 sp15': [
    { type: 'trees', spacing: 15, visualSpacing: 11, treeR: 26,
      polygon: [[680,556],[700,504],[726,462],[752,478],[734,522],[712,552]] }
  ],
  // C: extend the lone spruce into a longer NW-running ridge
  'C spruce-ridge sp16': [
    { type: 'trees', spacing: 16, visualSpacing: 12, treeR: 26,
      polygon: [[690,556],[704,512],[724,476],[746,468],[752,494],[732,528],[710,556]] }
  ]
};

describe('REPRO TL East h3 — candidate walls', () => {
  it('dumps', () => {
    for (const [name, extra] of Object.entries(CANDIDATES)) {
      log(`\n===== CANDIDATE: ${name} =====`);
      log('  -- IMPERFECT (want: green LOW, trees/water HIGH) --');
      runSpots('imp', IMPERFECT, extra);
      log('  -- PERFECT drive corridor (want: shaped shot can still reach green) --');
      runSpots('perf', PERFECT, extra);
      log('  -- SAFE right route (want: UNAFFECTED, green reachable, no trees) --');
      runSpots('safe', SAFE, extra);
    }
    writeFileSync(OUT, lines.join('\n'));
  });
});
