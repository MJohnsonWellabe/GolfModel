// Authoring generator for the two approved expansion courses (V2 content
// expansion). Emits schema-v2 course JSONs; geometry is deterministic so
// re-running the script reproduces the same files. Playability is enforced
// by tests/simulation/newCourses.test.ts (Monte-Carlo), visuals by capture.
import { writeFileSync } from 'node:fs';

// Deterministic jitter (mulberry-ish) so blobs are organic but reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = (v) => Math.round(v * 10) / 10;
/** Organic blob polygon around (cx,cy) with per-axis radii. */
function blob(cx, cy, rx, ry, n, jitter, seed, rot = 0) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rot;
    const k = 1 - jitter / 2 + r() * jitter;
    pts.push([R(cx + Math.cos(a) * rx * k), R(cy + Math.sin(a) * ry * k)]);
  }
  return pts;
}
/** A winding stream polygon along control points with width w. */
function stream(points, w, seed) {
  const r = rng(seed);
  const left = [], right = [];
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    const [px, py] = points[Math.max(0, i - 1)];
    const [nx2, ny2] = points[Math.min(points.length - 1, i + 1)];
    let dx = nx2 - px, dy = ny2 - py;
    const l = Math.hypot(dx, dy) || 1;
    const ox = (-dy / l) * (w / 2) * (0.85 + r() * 0.3);
    const oy = (dx / l) * (w / 2) * (0.85 + r() * 0.3);
    left.push([R(x + ox), R(y + oy)]);
    right.push([R(x - ox), R(y - oy)]);
  }
  return left.concat(right.reverse());
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rot2 = (x, y, r) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
function computedPins(h) {
  const g = h.green;
  const rv = g.rot ?? 0;
  const [lx, ly] = rot2(h.tee[0] - g.cx, h.tee[1] - g.cy, -rv);
  const ll = Math.hypot(lx, ly) || 1;
  const [ux, uy] = [lx / ll, ly / ll];
  const P = (ax, ay) => {
    const [wx, wy] = rot2(ax * g.rx, ay * g.ry, rv);
    return { x: R(g.cx + wx), y: R(g.cy + wy) };
  };
  return [P(ux * 0.55, uy * 0.55), P(-ux * 0.52, -uy * 0.52), P(-uy * 0.5, ux * 0.5)];
}
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function computedAltTee(h) {
  const cl = h.centerline ?? h.fairways[0].centerline;
  const aim = cl.length > 1 ? cl[1] : [h.green.cx, h.green.cy];
  let [tx, ty] = [aim[0] - h.tee[0], aim[1] - h.tee[1]];
  const l = Math.hypot(tx, ty) || 1;
  const [ux, uy] = [tx / l, ty / l];
  cand: for (const d of [72, -60, 110, -95]) {
    const x = R(h.tee[0] + ux * d), y = R(h.tee[1] + uy * d);
    const M = 40;
    if (x < M || y < M || x > h.world.width - M || y > h.world.height - M) continue;
    for (const hz of h.hazards) {
      for (const [ox, oy] of [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20]]) {
        if (pointInPoly(x + ox, y + oy, hz.polygon)) continue cand;
      }
    }
    if (Math.hypot(x - h.green.cx, y - h.green.cy) < Math.max(h.green.rx, h.green.ry) + 40) continue;
    return { x, y };
  }
  return null;
}

function pathYards(cl) {
  let d = 0;
  for (let i = 1; i < cl.length; i++) d += dist(cl[i - 1], cl[i]);
  return Math.round(d / 2); // PX_PER_YARD = 2
}

// ---------------------------------------------------------------- Red Hollow
// Sand Hollow Resort x Wolf Creek: emerald ribbons through red-rock desert.
const redhollow = {
  name: 'Red Hollow',
  version: 2,
  theme: {
    skyTop: '#4f9bd9', skyBottom: '#f2d9b8', sunX: 520, sunY: 120,
    fairway: '#3e8f4a', fairwayDark: '#357c40',
    rough: '#bc6f42', roughDark: '#9a5530',
    fringe: '#5d9a52', green: '#3f9150', greenLight: '#57a962',
    sand: '#cf6438', sandDark: '#a34526',
    water: '#2b6f9e', waterDeep: '#1c4d74',
    // Dead-brown "tumbleweed" foliage: Red Hollow has no trees, so the
    // canopy slots only color bush_b — dry scrub for the creek bed/waste.
    treeCanopy: '#8a6a42', treeCanopyLight: '#a08050', treeTrunk: '#7a5238',
    haze: '#f0d9c0', hazeStrength: 0.55,
    horizonTint: '#eec39a', hillTint: '#b4633e',
    backdrop: 'peaks', blossomChance: 0,
    treeKeys: [],
    // Playtest round 3: NO boxy Kenney mesas — the horizon is only the
    // CC-BY range diorama (lit terracotta through its normal map), which
    // course3d LAYERS at several depths/sizes/mirrorings. Rocks are the
    // stylized cluster in dark volcanic + bright sunlit red; the boxy
    // rock_desert props and green sage bushes are gone.
    peakKeys: ['mountain_range_red'],
    wasteRimKeys: ['rocks_red_cluster', 'rocks_red_bright'],
    stoneTint: '#b0522f',
    bareRough: true,
    bushKeys: [],
    scatterKeys: ['rocks_red_cluster', 'rocks_red_bright'],
    sandPlantKeys: ['rocks_red_cluster', 'bush_b'],
    sandPlantStep: 70, sandPlantKeep: 0.45,
    sandSculpt: 0.25, bunkerDepthScale: 1.35, wasteDepthScale: 1.4,
    tuftDensity: 0.8, roughTuftHeight: 1.2,
    edgeWobble: 2.6, mowPattern: 'diagonal', mowWidth: 26,
    greenMowPattern: 'diagonal',
    atmosphere: 'desert'
  },
  holes: [
    {
      number: 1, name: 'Rimrock', par: 4,
      world: { width: 950, height: 1240 },
      tee: [330, 1130], teeBox: { w: 28, d: 20 },
      green: { cx: 560, cy: 330, rx: 66, ry: 52, rot: 0.35 },
      slope: { angle: 2.2, strength: 0.32 },
      centerline: [[330, 1100], [332, 960], [362, 820], [432, 690], [510, 560], [545, 448], [556, 385]],
      width: [46, 68, 82, 80, 66, 54, 44],
      hazards: [
        // Waste band at the great wall's base — the dogleg carry hugs it.
        { type: 'bunker', waste: true, polygon: blob(630, 860, 140, 210, 14, 0.32, 11, 0.4) },
        { type: 'bunker', waste: true, polygon: blob(680, 520, 85, 190, 12, 0.36, 16) },
        // Ravine-lip waste on the left — sand spilling over the drop.
        { type: 'bunker', waste: true, polygon: blob(225, 570, 115, 250, 12, 0.4, 12) },
        // The ravine floor itself, ~15 below the terrace.
        { type: 'bunker', waste: true, polygon: blob(60, 640, 66, 430, 14, 0.3, 15) },
        { type: 'bunker', polygon: blob(478, 300, 34, 26, 9, 0.3, 13) },
        { type: 'bunker', polygon: blob(636, 402, 30, 24, 9, 0.3, 14) }
      ],
      aiTargets: [[362, 820], [500, 570]],
      // HERO: THE CLIFF WALL — one massive 28-high red wall running the
      // entire right side (golf survives on the terrace at its base), a
      // 15-deep ravine along the left, and the wall wrapping around behind
      // the green so the approach plays into a rock amphitheater.
      elevation: [
        { x: 870, y: 1240, x2: 870, y2: 140, h: 34, r: 210, shape: 'plateau', skirt: 0.86 },
        // Near-south wall: the face crowds the drive half of the terrace
        // (~230px off the tee line) so the wall LOOMS from address.
        { x: 790, y: 1240, x2: 820, y2: 760, h: 30, r: 230, shape: 'plateau', skirt: 0.86 },
        { x: 600, y: 60, x2: 950, y2: 80, h: 24, r: 180, shape: 'plateau', skirt: 0.85 },
        // Amphitheater spur behind the green.
        { x: 700, y: 175, x2: 625, y2: 235, h: 16, r: 110, shape: 'plateau', skirt: 0.8 },
        // The terrace benches: tee up +5, green alcove +4.
        { x: 350, y: 1140, h: 5, r: 130, shape: 'plateau' },
        { x: 560, y: 330, h: 4, r: 110, shape: 'plateau' },
        // Gentle terrace rolls so the floor isn't a plane.
        { x: 430, y: 900, x2: 560, y2: 700, h: 1.6, r: 110 },
        { x: 300, y: 500, x2: 430, y2: 420, h: 1.4, r: 100 },
        // The ravine: sheer drop along the whole left edge.
        { x: 45, y: 1240, x2: 45, y2: 200, h: -15, r: 155, shape: 'plateau', skirt: 0.8 },
        // South edge flanks (tee camera corridor kept open mid-frame).
        { x: 80, y: 1220, x2: 240, y2: 1228, h: 7, r: 120 },
        { x: 560, y: 1228, x2: 900, y2: 1220, h: 10, r: 130 }
      ],
      landforms: [
        // Rock stacks crowning the wall + framing the terrace play.
        { key: 'rocks_red_bright', x: 872, y: 980, h: 14 },
        { key: 'rocks_red_cluster', x: 800, y: 1040, h: 13 },
        { key: 'rocks_red_cluster', x: 880, y: 620, h: 16 },
        { key: 'rocks_red_bright', x: 862, y: 760, h: 15 },
        { key: 'rocks_red_bright', x: 855, y: 300, h: 14 },
        { key: 'rocks_red_cluster', x: 700, y: 120, h: 13 },
        { key: 'rocks_red_bright', x: 250, y: 880, h: 9 },
        { key: 'rocks_red_cluster', x: 430, y: 205, h: 9 }
      ],
    },
    {
      number: 2, name: "Devil's Kitchen", par: 3,
      world: { width: 900, height: 950 },
      tee: [450, 800], teeBox: { w: 26, d: 18 },
      green: { cx: 450, cy: 430, rx: 62, ry: 50, rot: -0.2 },
      slope: { angle: 4.4, strength: 0.35 },
      // Par 3: a short apron ribbon on the mesa top only — the rest is canyon.
      centerline: [[450, 520], [450, 480]],
      width: [50, 56],
      hazards: [
        // The KITCHEN: the canyon floor between and around the mesas —
        // ~25 below the green surface, waste from wall to wall.
        { type: 'bunker', waste: true, polygon: blob(450, 668, 340, 98, 16, 0.26, 21) },
        { type: 'bunker', polygon: blob(360, 476, 30, 24, 9, 0.32, 22) },
        { type: 'bunker', polygon: blob(548, 452, 28, 22, 9, 0.32, 23) },
        { type: 'bunker', waste: true, polygon: blob(230, 550, 120, 210, 12, 0.4, 24) },
        { type: 'bunker', waste: true, polygon: blob(680, 535, 120, 220, 12, 0.4, 25) },
        { type: 'bunker', waste: true, polygon: blob(450, 205, 260, 70, 14, 0.3, 26) }
      ],
      aiTargets: [[450, 470]],
      // HERO: THE ISOLATED MESA — two mesas rising ~25 from a canyon
      // floor that IS the default ground, with a mesa field running to
      // every world edge so the canyon reads endless. The green mesa's
      // faces are near-vertical; everything that isn't mesa is the void.
      elevation: [
        { x: 450, y: 815, h: 27, r: 150, shape: 'plateau', skirt: 0.86 },
        { x: 450, y: 425, h: 22, r: 135, shape: 'plateau', skirt: 0.92 },
        // The mesa field: walls of rock continuing past every edge.
        { x: 120, y: 300, x2: 60, y2: 800, h: 26, r: 200, shape: 'plateau', skirt: 0.85 },
        { x: 800, y: 250, x2: 860, y2: 750, h: 28, r: 210, shape: 'plateau', skirt: 0.85 },
        { x: 200, y: 80, x2: 750, y2: 60, h: 30, r: 190, shape: 'plateau', skirt: 0.85 },
        { x: 130, y: 920, h: 22, r: 150, shape: 'plateau', skirt: 0.85 },
        { x: 780, y: 900, h: 24, r: 160, shape: 'plateau', skirt: 0.85 }
      ],
      landforms: [
        // Stacks crowning the mesa field + sentinels at the tee mesa.
        { key: 'rocks_red_bright', x: 100, y: 520, h: 16 },
        { key: 'rocks_red_cluster', x: 828, y: 420, h: 18 },
        { key: 'rocks_red_bright', x: 420, y: 70, h: 15 },
        { key: 'rocks_red_cluster', x: 680, y: 78, h: 13 },
        { key: 'rocks_red_cluster', x: 250, y: 828, h: 10 },
        { key: 'rocks_red_bright', x: 660, y: 850, h: 11 }
      ],
    },
    {
      number: 3, name: 'Wolf Run', par: 5,
      world: { width: 1150, height: 1560 },
      tee: [820, 1450], teeBox: { w: 30, d: 22 },
      green: { cx: 330, cy: 330, rx: 58, ry: 48, rot: 0.5 },
      green2: { cx: 282, cy: 288, rx: 40, ry: 34, rot: 0.5 },
      slope: { angle: 5.6, strength: 0.34 },
      // TWO fairway ribbons with a real GAP where Wolf Wash crosses — the
      // crossing is genuinely waste (physics and look), not paint under turf.
      fairways: [
        { centerline: [[820, 1420], [790, 1280], [700, 1150], [640, 1075]], width: [50, 72, 84, 80] },
        { centerline: [[520, 900], [450, 800], [428, 680], [390, 560], [352, 470], [338, 408]], width: [76, 74, 68, 58, 50, 44] }
      ],
      hazards: [
        // Wolf Wash: the dry rocky creek, rerouted so it genuinely CROSSES
        // the fairway between the first and second shelves (through the gap
        // between the two fairway ribbons), then runs up the second
        // ribbon's left flank. sandPlantKeys fills it with rock clusters +
        // dry scrub; the waste-rim system lines its banks.
        { type: 'bunker', waste: true, polygon: stream([[210, 1180], [330, 1090], [470, 1030], [600, 985], [700, 940], [660, 840], [560, 760], [520, 705], [480, 625], [450, 545], [438, 465], [430, 400]], 52, 31) },
        // Red waste flanking the first landing zone's right.
        { type: 'bunker', waste: true, polygon: blob(880, 1030, 130, 220, 13, 0.38, 32) },
        { type: 'bunker', waste: true, polygon: blob(655, 525, 115, 140, 12, 0.4, 33) },
        { type: 'bunker', polygon: blob(408, 288, 30, 24, 9, 0.3, 34) },
        { type: 'bunker', polygon: blob(276, 432, 26, 22, 9, 0.28, 35) }
      ],
      aiTargets: [[700, 1150], [470, 850], [400, 570]],
      // HERO: THE WINDING CANYON — the whole hole plays on the canyon
      // FLOOR between 20-24-high rim walls tracking the S-curve on both
      // sides, stepping down two shelves with the rocky wash crossing
      // between them; the green sits on a bench in the final canyon bend.
      elevation: [
        // East rim, following the S from tee to green.
        { x: 1045, y: 1520, x2: 975, y2: 1100, h: 20, r: 190, shape: 'plateau', skirt: 0.85 },
        { x: 940, y: 1100, x2: 770, y2: 640, h: 22, r: 200, shape: 'plateau', skirt: 0.85 },
        { x: 770, y: 640, x2: 570, y2: 190, h: 24, r: 200, shape: 'plateau', skirt: 0.85 },
        // West rim.
        { x: 470, y: 1460, x2: 330, y2: 1100, h: 18, r: 180, shape: 'plateau', skirt: 0.85 },
        { x: 250, y: 1000, x2: 120, y2: 520, h: 22, r: 200, shape: 'plateau', skirt: 0.85 },
        { x: 40, y: 330, x2: 230, y2: 90, h: 24, r: 160, shape: 'plateau', skirt: 0.85 },
        // Floor shelves inside the canyon.
        { x: 815, y: 1430, x2: 690, y2: 1140, h: 8, r: 150, shape: 'plateau' },
        { x: 495, y: 850, x2: 435, y2: 690, h: 3.5, r: 140, shape: 'plateau' },
        { x: 322, y: 352, h: 6, r: 140, shape: 'plateau' },
        // The wash bed: carved down, with eroded rocky bumps inside it.
        { x: 640, y: 1000, x2: 470, y2: 1030, h: -3.5, r: 75 },
        { x: 700, y: 940, x2: 640, y2: 1000, h: -3, r: 60 },
        { x: 585, y: 995, h: 1.2, r: 20 },
        { x: 520, y: 1015, h: 1.0, r: 16 },
        { x: 660, y: 965, h: 1.1, r: 18 }
      ],
      landforms: [
        // Rim-top formations + wash-bank rocks inside the canyon.
        { key: 'rocks_red_bright', x: 985, y: 1300, h: 13 },
        { key: 'rocks_red_cluster', x: 840, y: 780, h: 15 },
        { key: 'rocks_red_bright', x: 660, y: 330, h: 16 },
        { key: 'rocks_red_cluster', x: 170, y: 760, h: 14 },
        { key: 'rocks_red_bright', x: 350, y: 1260, h: 12 },
        { key: 'rocks_red_cluster', x: 690, y: 1085, h: 9 },
        { key: 'rocks_red_bright', x: 755, y: 1005, h: 8 },
        { key: 'rocks_red_cluster', x: 150, y: 190, h: 15 }
      ],
    }
  ]
};

// ------------------------------------------------------------ Kettle Barrens
// Erin Hills x Sand Valley (skewed Sand Valley): rolling fescue sand barrens.
const wildvalley = {
  name: 'Wild Valley',
  version: 2,
  theme: {
    skyTop: '#57a9e8', skyBottom: '#eef4e2', sunX: 420, sunY: 120,
    fairway: '#7cb551', fairwayDark: '#6ca344',
    rough: '#d6b060', roughDark: '#b6913f',
    fringe: '#8fbb58', green: '#6fae4a', greenLight: '#8cc95f',
    sand: '#f3e6bb', sandDark: '#dcc78e',
    water: '#3a7fae', waterDeep: '#235a84',
    treeCanopy: '#44603a', treeCanopyLight: '#587547', treeTrunk: '#6d5642',
    haze: '#eaf0e2', hazeStrength: 0.5,
    backdrop: 'none', cloudStyle: 'wispy', blossomChance: 0,
    // Playtest round 3: NO trees ("I don't think Wild Horse has trees
    // really") — open sand-hills horizon, golden fescue carries the look.
    treeKeys: [],
    bushKeys: [],
    heatherKeys: ['heather_fescue_a', 'heather_fescue_b', 'heather_fescue_c'],
    bunkerLipFescue: true,
    // Every bunker's edge packed with the golden fescue, and blowouts dug
    // into genuinely deep center-weighted bowls.
    bunkerLipPacked: true,
    lushGrass: true,
    stripeStrength: 1.3,
    tallGrass: { cap: 7, density: 24, waste: true },
    roughTuftHeight: 1.9,
    tuftDensity: 2.6,
    sandPlantKeys: ['heather_fescue_b'],
    sandPlantStep: 80, sandPlantKeep: 0.5,
    sandSculpt: 0.85, bunkerDepthScale: 2.3, wasteDepthScale: 2.8,
    edgeWobble: 3.0, mowPattern: 'classic', mowWidth: 28,
    greenMowPattern: 'checker',
    atmosphere: 'forest'
  },
  holes: [
    {
      number: 1, name: 'Blowout', par: 4,
      world: { width: 980, height: 1250 },
      tee: [470, 1130], teeBox: { w: 28, d: 20 },
      green: { cx: 510, cy: 300, rx: 64, ry: 52, rot: 0.25 },
      slope: { angle: 1.2, strength: 0.28 },
      centerline: [[470, 1100], [462, 960], [452, 830], [468, 700], [496, 560], [508, 440], [510, 372]],
      width: [50, 78, 92, 88, 78, 62, 48],
      // STRATEGIC bunkering (terrain pass): every trap answers a shot.
      // Drive zone: a deep pot pinches the aggressive inside line and a big
      // blowout catches the wide-left bailout. Approach: a cross-pot short-
      // right of the lay-up line; two pots defend the green shelf's front.
      hazards: [
        // Blowouts CUT INTO the great ridge's flank on the drive line.
        { type: 'bunker', waste: true, polygon: blob(612, 785, 82, 76, 12, 0.36, 41, 0.7) },
        { type: 'bunker', waste: true, polygon: blob(655, 600, 70, 82, 11, 0.4, 45) },
        // Bailout blowout under the counter-ridge.
        { type: 'bunker', waste: true, polygon: blob(302, 886, 88, 105, 12, 0.42, 42) },
        { type: 'bunker', polygon: blob(420, 468, 40, 30, 10, 0.34, 48) },
        { type: 'bunker', polygon: blob(444, 332, 32, 26, 9, 0.34, 43) },
        { type: 'bunker', polygon: blob(592, 342, 34, 26, 9, 0.34, 44) }
      ],
      aiTargets: [[455, 830], [495, 560]],
      // HERO: THE GREAT RIDGE — one huge wind-sculpted dune (h13) running
      // the whole right side, the fairway flowing down the broad valley at
      // its foot, a lower counter-ridge left, and edge dunes continuing the
      // system past every side. Blowouts are cut into the great ridge's
      // flank; the green is tucked where the valley pinches shut.
      elevation: [
        { x: 780, y: 1080, x2: 660, y2: 380, h: 15, r: 245 },
        { x: 190, y: 1000, x2: 290, y2: 480, h: 8, r: 175 },
        { x: 260, y: 170, x2: 790, y2: 240, h: 9, r: 180 },
        { x: 470, y: 1155, h: 6, r: 145, shape: 'plateau' },
        { x: 510, y: 292, h: 4, r: 112, shape: 'plateau' },
        { x: 350, y: 800, x2: 600, y2: 760, h: 2.2, r: 95 },
        { x: 380, y: 560, x2: 640, y2: 610, h: 2.5, r: 100 },
        // Edge dunes: the system continues beyond the playable frame.
        { x: 60, y: 700, x2: 100, y2: 200, h: 8, r: 160 },
        { x: 930, y: 820, x2: 960, y2: 300, h: 10, r: 180 },
        { x: 150, y: 1210, x2: 60, y2: 1000, h: 6, r: 140 }
      ],
    },
    {
      number: 2, name: 'The Kettle', par: 3,
      world: { width: 880, height: 920 },
      tee: [440, 760], teeBox: { w: 26, d: 18 },
      // KIDNEY-BEAN green (playtest: the flat par 3 had no challenge): two
      // lobes bending around a deep pot bunker tucked into the notch, with
      // the terrain tilting off the green INTO that bunker — a miss on the
      // fat side feeds down and gets caught.
      green: { cx: 400, cy: 440, rx: 62, ry: 50, rot: 0.3 },
      green2: { cx: 480, cy: 380, rx: 52, ry: 44, rot: 0.3 },
      slope: { angle: 3.1, strength: 0.34 },
      centerline: [[440, 600], [428, 530]],
      width: [56, 62],
      hazards: [
        // The notch bunker in the crook of the kidney.
        { type: 'bunker', polygon: blob(497, 472, 34, 30, 10, 0.3, 55) },
        // A second pot cut into the kettle's inner west face.
        { type: 'bunker', polygon: blob(332, 484, 30, 26, 9, 0.32, 56) },
        // Deep kettle blowout guarding the direct line front-right.
        { type: 'bunker', waste: true, polygon: blob(560, 562, 84, 80, 12, 0.34, 51) },
        { type: 'bunker', waste: true, polygon: blob(252, 600, 90, 115, 12, 0.42, 53) }
      ],
      aiTargets: [[400, 470]],
      // HERO: THE AMPHITHEATER — the kettle scaled to landform: a
      // horseshoe of 9.5-11-high dune walls enclosing the green (open only
      // at the front-right entrance), outer shoulders carrying the bowl's
      // rim past both edges, the green low on the bowl floor.
      elevation: [
        { x: 272, y: 560, x2: 262, y2: 368, h: 11, r: 150 },
        { x: 362, y: 274, x2: 488, y2: 252, h: 12.5, r: 155 },
        { x: 572, y: 334, x2: 588, y2: 470, h: 11, r: 140 },
        // Rim shoulders continuing the bowl beyond the frame.
        { x: 150, y: 250, x2: 60, y2: 600, h: 8, r: 160 },
        { x: 700, y: 250, x2: 800, y2: 550, h: 8, r: 160 },
        { x: 430, y: 420, h: 2, r: 150, shape: 'plateau' },
        { x: 360, y: 380, h: 2.2, r: 110 },
        { x: 440, y: 780, h: 4.5, r: 135, shape: 'plateau' },
        { x: 150, y: 680, x2: 360, y2: 640, h: 3, r: 105 },
        { x: 520, y: 680, x2: 700, y2: 620, h: 3.4, r: 115 }
      ],
    },
    {
      number: 3, name: 'Sandbox', par: 5,
      world: { width: 1200, height: 1560 },
      tee: [400, 1440], teeBox: { w: 30, d: 22 },
      green: { cx: 760, cy: 330, rx: 62, ry: 50, rot: -0.3 },
      slope: { angle: 0.4, strength: 0.3 },
      centerline: [[400, 1410], [420, 1270], [470, 1130], [540, 1010], [610, 880], [660, 750], [700, 620], [730, 500], [752, 420]],
      width: [54, 80, 96, 94, 88, 80, 70, 58, 48],
      // STRATEGIC bunkering: blowout on the outside of LZ1's bailout, a
      // carry pot at the first ridge's end, a blowout under the second
      // ridge at LZ2's aggressive line, the cross-pots at the lay-up
      // decision, and two green-complex pots (front-left saddle + right).
      hazards: [
        { type: 'bunker', waste: true, polygon: blob(272, 1196, 94, 122, 13, 0.4, 61) },
        { type: 'bunker', polygon: blob(608, 1062, 40, 32, 10, 0.34, 71) },
        // The HERO blowout complex torn from the second ridge's face.
        { type: 'bunker', waste: true, polygon: blob(790, 940, 100, 110, 12, 0.42, 62) },
        { type: 'bunker', waste: true, polygon: blob(700, 1020, 72, 78, 11, 0.4, 73) },
        { type: 'bunker', waste: true, polygon: blob(845, 872, 76, 70, 11, 0.38, 74) },
        { type: 'bunker', polygon: blob(684, 660, 28, 22, 10, 0.34, 63) },
        { type: 'bunker', polygon: blob(676, 690, 24, 20, 10, 0.3, 64) },
        { type: 'bunker', polygon: blob(682, 425, 36, 28, 9, 0.32, 72) },
        { type: 'bunker', polygon: blob(846, 380, 34, 26, 9, 0.34, 66) }
      ],
      aiTargets: [[470, 1130], [620, 860], [700, 600]],
      // HERO: THE BLOWOUT WALL — two mega-ridges crossing the hole, with
      // a giant three-bowl blowout complex torn out of the second ridge's
      // face at the aggressive line; the green rides high behind the last
      // ridge's shoulder, approach half-screened.
      elevation: [
        { x: 140, y: 1180, x2: 560, y2: 1060, h: 11, r: 210 },
        { x: 620, y: 960, x2: 1080, y2: 840, h: 12, r: 220 },
        { x: 300, y: 700, x2: 640, y2: 600, h: 7, r: 150 },
        { x: 560, y: 470, x2: 860, y2: 430, h: 10, r: 170 },
        { x: 400, y: 1460, h: 4, r: 140, shape: 'plateau' },
        { x: 760, y: 320, h: 6, r: 132, shape: 'plateau' },
        // Edge dunes continuing both ridge systems.
        { x: 180, y: 400, x2: 420, y2: 330, h: 4.5, r: 130 },
        { x: 1050, y: 640, x2: 1130, y2: 330, h: 9, r: 170 },
        { x: 240, y: 1330, x2: 560, y2: 1290, h: 2.4, r: 100 },
        { x: 80, y: 900, x2: 140, y2: 620, h: 6, r: 140 }
      ],
    }
  ]
};

// ---- serialize to schema shape ------------------------------------------
function emit(course, id) {
  const out = {
    name: course.name,
    version: 2,
    theme: course.theme,
    holes: course.holes.map((h) => {
      // A hole authors either one ribbon (centerline+width) or several
      // (fairways: [{centerline,width}] — e.g. Wolf Run's wash-split pair).
      const ribbons = h.fairways ?? [{ centerline: h.centerline, width: h.width }];
      const pathPts = ribbons.flatMap((r) => r.centerline);
      return {
        number: h.number,
        name: h.name,
        par: h.par,
        yardage: pathYards([[h.tee[0], h.tee[1]], ...pathPts.slice(1), [h.green.cx, h.green.cy]]),
        world: h.world,
        tee: { x: h.tee[0], y: h.tee[1] },
        teeBox: h.teeBox,
        green: h.green,
        ...(h.green2 ? { green2: h.green2 } : {}),
        slope: h.slope,
        ...(() => {
          const pins = computedPins(h);
          const alt = computedAltTee(h);
          return { pin: pins[0], pins, ...(alt ? { tees: [alt] } : {}) };
        })(),
        fairway: ribbons,
        hazards: h.hazards,
        aiTargets: h.aiTargets.map(([x, y]) => ({ x, y })),
        elevation: h.elevation,
        ...(h.landforms ? { landforms: h.landforms } : {})
      };
    })
  };
  writeFileSync(`src/data/courses/${id}.json`, JSON.stringify(out, null, 2) + '\n');
  for (const h of out.holes) console.log(`${id} h${h.number} "${h.name}" par ${h.par} ${h.yardage}yd`);
}
emit(redhollow, 'redhollow');
emit(wildvalley, 'wildvalley');
