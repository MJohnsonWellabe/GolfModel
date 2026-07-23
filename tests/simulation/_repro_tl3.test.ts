import { describe, it } from 'vitest';
import { writeFileSync } from 'fs';
import timberlineV2 from '../../src/data/courses/v2/timberline.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { collectTreeBlobs } from '../../src/systems/treeField';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { PX_PER_YARD } from '../../src/config';
import { golferWith, NO_WIND, SWING_OF } from './simHelpers';
import { HoleData } from '../../src/core/types';

const OUT = '/tmp/claude-0/-home-user/dfe4e2d5-ec7d-58bc-86bb-a04745c2265b/scratchpad/repro.txt';
const lines: string[] = [];
const log = (...a: unknown[]) => lines.push(a.map(String).join(' '));

const SPECIES = {
  trees: (timberlineV2 as any).theme.treeKeys as string[],
  accents: (timberlineV2 as any).theme.accentTreeKeys as string[]
};

function getHole(): HoleData {
  const c = loadCourse(timberlineV2 as unknown as CourseAuthoring);
  return c.holes.find((h) => h.number === 3) as unknown as HoleData;
}

const GREEN = { cx: 840, cy: 356, rx: 52, ry: 39, rot: -0.35 };
function onGreen(x: number, y: number): boolean {
  const dx = x - GREEN.cx, dy = y - GREEN.cy;
  const c = Math.cos(-GREEN.rot), s = Math.sin(-GREEN.rot);
  const rx = dx * c - dy * s, ry = dx * s + dy * c;
  return (rx * rx) / (GREEN.rx * GREEN.rx) + (ry * ry) / (GREEN.ry * GREEN.ry) <= 1;
}
const PIN = { x: 827.3, y: 377.5 };
const ydTo = (x: number, y: number, tx: number, ty: number) => Math.hypot(tx - x, ty - y) / PX_PER_YARD;

describe('REPRO TL East h3', () => {
  it('dumps repro', () => {
    const hole = getHole();

    // --- collidable trunk map for the key left stands ---
    const blobs = collectTreeBlobs(hole, 0, false, SPECIES);
    const renderBlobs = collectTreeBlobs(hole, 0, true, SPECIES);
    log('=== TRUNK COUNTS (collision vs render) ===');
    log('collision trunks total', blobs.length, 'render trunks total', renderBlobs.length);
    // Trees in the left approach corridor box roughly x[520,760] y[520,760]
    const inBox = (b: {x:number;y:number}, x0:number,x1:number,y0:number,y1:number) => b.x>=x0&&b.x<=x1&&b.y>=y0&&b.y<=y1;
    const cCorr = blobs.filter(b => inBox(b,520,760,520,760));
    const rCorr = renderBlobs.filter(b => inBox(b,520,760,520,760));
    log('LEFT-APPROACH BOX x[520,760]y[520,760]: collision', cCorr.length, 'render', rCorr.length);
    log('collision trunk (x,y,r) in box:');
    cCorr.forEach(b => log('  ', b.x.toFixed(0), b.y.toFixed(0), 'r'+b.r.toFixed(0), 'canopyR'+(b.hb?b.hb.canopyR.toFixed(0):'-')));

    // === PART A: mid-skill drive on the LEFT route ===
    // Aim down the left fairway centerline: tee (444,1322) -> aim ~ (628,820) area.
    // Left fairway centerline end ~[664,690]; landing band for a ~300yd(600px) drive.
    const tee = { x: 444, y: 1322 };
    const golfer = golferWith(78); // mid-skill
    const driver = clubById('driver');
    // aim at a point up the left fairway
    const aimPt = { x: 612, y: 720 }; // up the left fairway line
    const aimAngle = Math.atan2(aimPt.y - tee.y, aimPt.x - tee.x);
    log('\n=== PART A: DRIVE on left route (mid-skill 78), aim', JSON.stringify(aimPt), '===');
    const landings: {x:number;y:number;surf:string;hitTrees:boolean}[] = [];
    for (let s = 0; s < 60; s++) {
      const eng = new PhysicsEngine(hole, null, mulberry32(1000 + s * 7), SPECIES);
      const out = eng.simulate({
        origin: { ...tee }, aimAngle,
        swing: SWING_OF(0.99, s % 5 === 0 ? 'perfect' : 'good', 0),
        club: driver, golfer, fireBoost: 0, lie: 'tee', wind: NO_WIND, hole, stroke: 0
      });
      landings.push({ x: out.finalPos.x, y: out.finalPos.y, surf: String(out.surface), hitTrees: out.hitTrees });
    }
    const cx = landings.reduce((a,l)=>a+l.x,0)/landings.length;
    const cy = landings.reduce((a,l)=>a+l.y,0)/landings.length;
    log('landing centroid', cx.toFixed(0), cy.toFixed(0), 'yd from tee', ydTo(tee.x,tee.y,cx,cy).toFixed(0));
    const surfCount: Record<string,number> = {};
    landings.forEach(l => surfCount[l.surf]=(surfCount[l.surf]||0)+1);
    log('landing surfaces', JSON.stringify(surfCount), 'hitTrees on drive', landings.filter(l=>l.hitTrees).length);
    log('sample landings (x,y,surf):');
    landings.slice(0,12).forEach(l=>log('  ',l.x.toFixed(0),l.y.toFixed(0),l.surf,l.hitTrees?'TREE':''));

    // === PART B: go-for-green SECOND shot from representative spots ===
    // A perfectly-placed drive: end of left fairway ~ (655,700) (dry, good angle)
    // A slightly-off drive in the rough: left, short ~ (585,660) 192yd out per screenshot
    const spots: {name:string;x:number;y:number;lie:string}[] = [
      { name: 'PERFECT left-fw exit', x: 660, y: 700, lie: 'fairway' },
      { name: 'OFF rough left ~192yd (screenshot)', x: 585, y: 660, lie: 'rough' },
      { name: 'OFF rough left-short', x: 560, y: 720, lie: 'rough' },
      { name: 'OFF rough mid-left', x: 610, y: 640, lie: 'rough' }
    ];
    const club3w = clubById('3w');
    const clubById4h = clubById('4h');
    for (const spot of spots) {
      log('\n=== PART B: 2nd shot from', spot.name, `(${spot.x},${spot.y})`, spot.lie,
          'dist to pin', ydTo(spot.x,spot.y,PIN.x,PIN.y).toFixed(0)+'yd ===');
      for (const club of [club3w, clubById4h]) {
        let reached = 0, treeHits = 0, water = 0;
        const N = 60;
        const aimA = Math.atan2(PIN.y - spot.y, PIN.x - spot.x); // straight at pin
        for (let s = 0; s < N; s++) {
          const eng = new PhysicsEngine(hole, null, mulberry32(50 + s * 13), SPECIES);
          const out = eng.simulate({
            origin: { x: spot.x, y: spot.y }, aimAngle: aimA,
            swing: SWING_OF(1.0, s % 4 === 0 ? 'perfect' : 'good', 0),
            club, golfer: golferWith(80), fireBoost: 0, lie: spot.lie as any, wind: NO_WIND, hole, stroke: 1
          });
          if (out.hitTrees) treeHits++;
          if (out.waterPenalty) water++;
          if (onGreen(out.finalPos.x, out.finalPos.y)) reached++;
        }
        log(`  ${club.name}: reachedGreen ${reached}/${N}  hitTrees ${treeHits}/${N}  water ${water}/${N}`);
      }
    }

    // === PART C: with treeRecoveryMult effectively removed (stroke=0) for comparison ===
    log('\n=== PART C: same 2nd shots but stroke=0 (NO recoveryMult shrink) — isolates the mult ===');
    for (const spot of spots) {
      const aimA = Math.atan2(PIN.y - spot.y, PIN.x - spot.x);
      let reached = 0, treeHits = 0;
      const N = 60;
      for (let s = 0; s < N; s++) {
        const eng = new PhysicsEngine(hole, null, mulberry32(50 + s * 13), SPECIES);
        const out = eng.simulate({
          origin: { x: spot.x, y: spot.y }, aimAngle: aimA,
          swing: SWING_OF(1.0, s % 4 === 0 ? 'perfect' : 'good', 0),
          club: club3w, golfer: golferWith(80), fireBoost: 0, lie: spot.lie as any, wind: NO_WIND, hole, stroke: 0
        });
        if (out.hitTrees) treeHits++;
        if (onGreen(out.finalPos.x, out.finalPos.y)) reached++;
      }
      log(`  ${spot.name}: 3W stroke0 reachedGreen ${reached}/${N}  hitTrees ${treeHits}/${N}`);
    }

    writeFileSync(OUT, lines.join('\n'));
  });
});
