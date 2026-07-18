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
  const cl = h.centerline;
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
    rough: '#c2945f', roughDark: '#a67a48',
    fringe: '#5d9a52', green: '#3f9150', greenLight: '#57a962',
    sand: '#cf6438', sandDark: '#a34526',
    water: '#2b6f9e', waterDeep: '#1c4d74',
    treeCanopy: '#5a7a3d', treeCanopyLight: '#6f8f4a', treeTrunk: '#7a5238',
    haze: '#f0d9c0', hazeStrength: 0.55,
    horizonTint: '#eec39a', hillTint: '#b4633e',
    backdrop: 'peaks', blossomChance: 0,
    treeKeys: [],
    peakKeys: ['mesa_a', 'mesa_b', 'mesa_c'],
    stoneTint: '#a8543a',
    bareRough: true,
    scatterKeys: ['rock_desert_a', 'rock_desert_b', 'rock_desert_c', 'rock_desert_d', 'rock_desert_e', 'rock_desert_f', 'rock_desert_g', 'rock_desert_h'],
    sandPlantKeys: ['rock_desert_g', 'rock_desert_h', 'bush_b'],
    sandPlantStep: 90, sandPlantKeep: 0.4,
    sandSculpt: 0.25, bunkerDepthScale: 1.35,
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
        // The red-rock canyon cutting the dogleg's inside (carry = reward).
        { type: 'bunker', waste: true, polygon: blob(710, 840, 175, 240, 14, 0.32, 11, 0.4) },
        // Rim waste along the left edge (miss long-left finds red rock).
        { type: 'bunker', waste: true, polygon: blob(150, 560, 110, 260, 12, 0.4, 12) },
        { type: 'bunker', polygon: blob(478, 300, 34, 26, 9, 0.3, 13) },
        { type: 'bunker', polygon: blob(636, 402, 30, 24, 9, 0.3, 14) }
      ],
      aiTargets: [[362, 820], [500, 570]],
      elevation: [
        { x: 330, y: 1150, h: 1.8, r: 130, shape: 'plateau' },
        { x: 420, y: 700, h: 1.4, r: 170 },
        { x: 560, y: 330, h: 2.8, r: 128, shape: 'plateau' },
        { x: 700, y: 810, h: 3.4, r: 190 },
        { x: 130, y: 520, h: 3.0, r: 150 },
        { x: 840, y: 420, h: 3.8, r: 150 },
        { x: 90, y: 1000, h: 2.6, r: 130 }
      ],
    },
    {
      number: 2, name: "Devil's Kitchen", par: 3,
      world: { width: 900, height: 950 },
      tee: [450, 800], teeBox: { w: 26, d: 18 },
      green: { cx: 450, cy: 430, rx: 62, ry: 50, rot: -0.2 },
      slope: { angle: 4.4, strength: 0.35 },
      // Par 3: a short apron ribbon in front of the green only — the rest is chasm.
      centerline: [[450, 545], [450, 490]],
      width: [52, 58],
      hazards: [
        // The chasm: a full-width red-rock void between tee and green.
        { type: 'bunker', waste: true, polygon: blob(450, 668, 300, 78, 16, 0.26, 21) },
        { type: 'bunker', polygon: blob(360, 476, 30, 24, 9, 0.32, 22) },
        { type: 'bunker', polygon: blob(548, 452, 28, 22, 9, 0.32, 23) },
        // Red rock shoulders framing the green mesa.
        { type: 'bunker', waste: true, polygon: blob(160, 430, 100, 170, 12, 0.4, 24) },
        { type: 'bunker', waste: true, polygon: blob(748, 400, 100, 180, 12, 0.4, 25) }
      ],
      aiTargets: [[450, 470]],
      elevation: [
        { x: 450, y: 820, h: 2.6, r: 140, shape: 'plateau' },
        { x: 450, y: 430, h: 3.2, r: 130, shape: 'plateau' },
        { x: 150, y: 400, h: 4.2, r: 150 },
        { x: 760, y: 380, h: 4.6, r: 160 },
        { x: 120, y: 840, h: 2.8, r: 120 }
      ],
    },
    {
      number: 3, name: 'Wolf Run', par: 5,
      world: { width: 1150, height: 1560 },
      tee: [820, 1450], teeBox: { w: 30, d: 22 },
      green: { cx: 330, cy: 330, rx: 58, ry: 48, rot: 0.5 },
      green2: { cx: 282, cy: 288, rx: 40, ry: 34, rot: 0.5 },
      slope: { angle: 5.6, strength: 0.34 },
      centerline: [[820, 1420], [790, 1280], [700, 1150], [580, 1040], [488, 930], [450, 800], [428, 680], [390, 560], [352, 470], [338, 408]],
      width: [50, 72, 84, 82, 76, 72, 66, 58, 50, 44],
      hazards: [
        // Wolf Creek: winds up the left, crossing the lay-up zone once.
        { type: 'water', polygon: stream([[210, 1180], [300, 1080], [420, 990], [560, 940], [640, 860], [620, 740], [540, 640], [430, 600], [330, 540], [270, 450], [252, 380]], 46, 31) },
        // Red waste flanking the first landing zone's right.
        { type: 'bunker', waste: true, polygon: blob(940, 1050, 150, 240, 13, 0.38, 32) },
        { type: 'bunker', waste: true, polygon: blob(720, 520, 130, 150, 12, 0.4, 33) },
        { type: 'bunker', polygon: blob(408, 288, 30, 24, 9, 0.3, 34) },
        { type: 'bunker', polygon: blob(276, 432, 26, 22, 9, 0.28, 35) }
      ],
      aiTargets: [[700, 1150], [470, 850], [400, 570]],
      elevation: [
        { x: 820, y: 1470, h: 2.0, r: 140, shape: 'plateau' },
        { x: 620, y: 1090, h: 1.6, r: 190 },
        { x: 330, y: 320, h: 2.6, r: 132, shape: 'plateau' },
        { x: 960, y: 1030, h: 3.6, r: 190 },
        { x: 740, y: 500, h: 3.2, r: 160 },
        { x: 1030, y: 420, h: 4.0, r: 170 },
        { x: 130, y: 900, h: 3.0, r: 160 }
      ],
    }
  ]
};

// ------------------------------------------------------------ Kettle Barrens
// Erin Hills x Sand Valley (skewed Sand Valley): rolling fescue sand barrens.
const kettlebarrens = {
  name: 'Kettle Barrens',
  version: 2,
  theme: {
    skyTop: '#66aede', skyBottom: '#e9f0e4', sunX: 420, sunY: 120,
    fairway: '#93a75a', fairwayDark: '#81964d',
    rough: '#a89a5e', roughDark: '#877946',
    fringe: '#8aa05c', green: '#7c9e54', greenLight: '#92b366',
    sand: '#e3cf9e', sandDark: '#c2a871',
    water: '#3a7fae', waterDeep: '#235a84',
    treeCanopy: '#44603a', treeCanopyLight: '#587547', treeTrunk: '#6d5642',
    haze: '#eaf0e2', hazeStrength: 0.5,
    backdrop: 'none', cloudStyle: 'wispy', blossomChance: 0,
    treeKeys: ['tree_spruce', 'tree_pine'],
    accentTreeKeys: ['tree_birch'],
    backdropTreeStep: 96,
    scatterKeys: ['fern_kenney', 'stone_d', 'bush_b'],
    heatherKeys: ['heather_fescue_a', 'heather_fescue_b', 'heather_fescue_c', 'heather_purple'],
    bunkerLipFescue: true,
    tallGrass: { cap: 6, density: 7, waste: true },
    sandPlantKeys: ['heather_fescue_b', 'bush_b'],
    sandPlantStep: 88, sandPlantKeep: 0.45,
    sandSculpt: 0.5, bunkerDepthScale: 1.55,
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
      hazards: [
        // The signature diagonal blowout splitting the drive zone.
        { type: 'bunker', waste: true, polygon: blob(705, 775, 140, 120, 14, 0.36, 41, 0.7) },
        { type: 'bunker', waste: true, polygon: blob(210, 900, 130, 180, 12, 0.42, 42) },
        { type: 'bunker', polygon: blob(430, 340, 34, 26, 9, 0.34, 43) },
        { type: 'bunker', polygon: blob(596, 330, 30, 24, 9, 0.34, 44) },
        // A kettle-moraine pine stand right of the approach.
        { type: 'trees', spacing: 66, keepGround: true, polygon: blob(800, 420, 110, 150, 10, 0.35, 45) }
      ],
      aiTargets: [[455, 830], [495, 560]],
      elevation: [
        { x: 470, y: 1150, h: 1.6, r: 130, shape: 'plateau' },
        { x: 510, y: 300, h: 2.2, r: 126, shape: 'plateau' },
        { x: 300, y: 650, h: 2.4, r: 170 },
        { x: 700, y: 980, h: 2.8, r: 180 },
        { x: 850, y: 560, h: 2.2, r: 150 },
        { x: 140, y: 380, h: 2.6, r: 150 },
        { x: 620, y: 180, h: 2.0, r: 140 }
      ],
    },
    {
      number: 2, name: 'The Kettle', par: 3,
      world: { width: 880, height: 920 },
      tee: [440, 760], teeBox: { w: 26, d: 18 },
      green: { cx: 430, cy: 430, rx: 70, ry: 58, rot: 0 },
      slope: { angle: 3.1, strength: 0.3 },
      centerline: [[440, 600], [434, 520]],
      width: [56, 62],
      hazards: [
        // Deep kettle blowout guarding the direct line front-right.
        { type: 'bunker', waste: true, polygon: blob(602, 578, 88, 84, 12, 0.34, 51) },
        { type: 'bunker', polygon: blob(330, 500, 34, 26, 9, 0.34, 52) },
        { type: 'bunker', waste: true, polygon: blob(180, 600, 110, 140, 12, 0.42, 53) },
        { type: 'trees', spacing: 70, keepGround: true, polygon: blob(730, 360, 100, 140, 10, 0.35, 54) }
      ],
      aiTargets: [[434, 500]],
      elevation: [
        { x: 440, y: 780, h: 1.8, r: 130, shape: 'plateau' },
        // The punchbowl: a ring of dune shoulders cupping the green.
        { x: 300, y: 380, h: 2.8, r: 110 },
        { x: 560, y: 380, h: 2.8, r: 110 },
        { x: 430, y: 250, h: 3.0, r: 120 },
        { x: 430, y: 430, h: 1.2, r: 150, shape: 'plateau' },
        { x: 150, y: 700, h: 2.4, r: 130 }
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
      hazards: [
        // Barrens both sides — the fairway is an island of turf in sand.
        { type: 'bunker', waste: true, polygon: blob(180, 1050, 160, 320, 15, 0.4, 61) },
        { type: 'bunker', waste: true, polygon: blob(900, 1120, 190, 260, 14, 0.42, 62) },
        // Cross-cluster at the second-shot decision point.
        { type: 'bunker', polygon: blob(560, 700, 44, 30, 10, 0.34, 63) },
        { type: 'bunker', polygon: blob(572, 706, 34, 26, 10, 0.3, 64) },
        { type: 'bunker', waste: true, polygon: blob(320, 520, 130, 170, 12, 0.42, 65) },
        { type: 'bunker', polygon: blob(846, 380, 34, 26, 9, 0.34, 66) },
        { type: 'trees', spacing: 68, keepGround: true, polygon: blob(1050, 700, 110, 190, 10, 0.35, 67) }
      ],
      aiTargets: [[470, 1130], [620, 860], [700, 600]],
      elevation: [
        { x: 400, y: 1460, h: 1.8, r: 140, shape: 'plateau' },
        { x: 760, y: 330, h: 2.4, r: 130, shape: 'plateau' },
        { x: 250, y: 1000, h: 2.6, r: 180 },
        { x: 880, y: 1100, h: 2.8, r: 190 },
        { x: 500, y: 650, h: 2.2, r: 170 },
        { x: 1020, y: 480, h: 2.4, r: 160 },
        { x: 160, y: 300, h: 2.2, r: 150 }
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
    holes: course.holes.map((h) => ({
      number: h.number,
      name: h.name,
      par: h.par,
      yardage: pathYards([[h.tee[0], h.tee[1]], ...h.centerline.slice(1), [h.green.cx, h.green.cy]]),
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
      fairway: [{ centerline: h.centerline, width: h.width }],
      hazards: h.hazards,
      aiTargets: h.aiTargets.map(([x, y]) => ({ x, y })),
      elevation: h.elevation
    }))
  };
  writeFileSync(`src/data/courses/${id}.json`, JSON.stringify(out, null, 2) + '\n');
  for (const h of out.holes) console.log(`${id} h${h.number} "${h.name}" par ${h.par} ${h.yardage}yd`);
}
emit(redhollow, 'redhollow');
emit(kettlebarrens, 'kettlebarrens');
