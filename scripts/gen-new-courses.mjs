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
  // A hole may author its pins outright (absolute coords) when the default
  // front/back/side ring is wrong for it — Wild Prairie h2 favors the
  // back-right lobe of its kidney green, so its authored set leads there.
  if (h.pins) return h.pins.map(([x, y]) => ({ x: R(x), y: R(y) }));
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
  const cl = h.centerline ?? h.fairways[0]?.centerline ?? [[h.green.cx, h.green.cy]];
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
      // PASS 6: the bend is stronger still — after the drive the fairway
      // presses hard against the cliff edge (left edge riding within a few
      // px of the drop) and the whole second half wraps the mountainside
      // before cutting back right to the green shelf.
      centerline: [[330, 1100], [332, 960], [348, 820], [368, 690], [402, 580], [462, 470], [528, 392]],
      width: [46, 68, 82, 78, 64, 54, 44],
      hazards: [
        // PASS 6 — TRUE OUT OF BOUNDS from the SHELF EDGE down: the
        // boundary tracks the exact line where the shelf starts to fall
        // (sampled at h<8, ~4px into the fall), so crossing the fairway's
        // left edge means crossing into OB — stroke penalty, drop in the
        // rough where the ball crossed. Everything below is scenery.
        { type: 'ob', polygon: [[0, 1240], [274, 1240], [276, 1050], [281, 960], [297, 820], [318, 690], [356, 580], [400, 470], [428, 392], [430, 280], [430, 0], [0, 0]] },
        // Canyon floor dressing (inside the OB — visual only).
        { type: 'bunker', waste: true, polygon: blob(105, 900, 95, 330, 14, 0.3, 15) },
        { type: 'bunker', waste: true, polygon: blob(170, 420, 100, 240, 13, 0.32, 17) },
        { type: 'bunker', polygon: blob(478, 300, 34, 26, 9, 0.3, 13) },
        { type: 'bunker', polygon: blob(636, 402, 30, 24, 9, 0.3, 14) }
      ],
      aiTargets: [[350, 820], [412, 566]],
      // PASS 4 — THE SIDEHILL SHELF: tee, fairway and green share ONE
      // continuous +10 shelf cut into the mountainside. LEFT: the shelf
      // simply ends — a steep 24-unit drop right at the fairway edge
      // (physics accelerates anything landing there down to the canyon
      // floor). RIGHT: the mountainside rises immediately — the lower
      // slope kicks slight misses back onto the fairway; carrying fully
      // onto the +8 upper terrace is effectively out of bounds. The
      // great wall from pass 3 climbs from the terrace.
      elevation: [
        // The shelf itself (one broad base — nothing else overlaps it).
        { x: 450, y: 720, h: 10, r: 620, shape: 'plateau', skirt: 0.78 },
        // Gentle undulation along the shelf.
        { x: 350, y: 950, x2: 390, y2: 760, h: 1.2, r: 90 },
        { x: 412, y: 560, x2: 452, y2: 480, h: 1.0, r: 80 },
        // LEFT: the drop — rims re-tracked so the fall begins within a few
        // px of the fairway's left edge (the shelf TERMINATES at the edge;
        // no rough shoulder before the cliff).
        { x: 100, y: 1150, x2: 106, y2: 900, h: -24, r: 185, shape: 'plateau', skirt: 0.76 },
        { x: 106, y: 900, x2: 148, y2: 640, h: -24, r: 185, shape: 'plateau', skirt: 0.76 },
        { x: 148, y: 640, x2: 225, y2: 440, h: -24, r: 185, shape: 'plateau', skirt: 0.76 },
        { x: 225, y: 440, x2: 290, y2: 270, h: -24, r: 185, shape: 'plateau', skirt: 0.76 },
        // RIGHT: the wall begins DIRECTLY beside the fairway (no buffer),
        // runs nearly the whole hole, and rises harder (pass 6: h9).
        { x: 590, y: 1150, x2: 575, y2: 900, h: 9, r: 190, shape: 'plateau', skirt: 0.74 },
        { x: 575, y: 900, x2: 600, y2: 640, h: 9, r: 190, shape: 'plateau', skirt: 0.74 },
        // Final wall segment tapers as it nears the green complex (r170,
        // endpoint pulled NE) so the terrace skirt never crosses the putt.
        { x: 620, y: 640, x2: 728, y2: 470, h: 9, r: 170, shape: 'plateau', skirt: 0.74 },
        // The great wall rises from the terrace (pass-3 identity).
        { x: 855, y: 1240, x2: 855, y2: 140, h: 28, r: 200, shape: 'plateau', skirt: 0.86 },
        { x: 620, y: 60, x2: 950, y2: 80, h: 24, r: 170, shape: 'plateau', skirt: 0.85 },
        // Amphitheater spur wrapping behind the green (clear of the putt).
        { x: 740, y: 140, x2: 668, y2: 196, h: 14, r: 95, shape: 'plateau', skirt: 0.8 }
      ],
      landforms: [
        // PASS 5: rock outcrops as a defining feature — cliff-edge line,
        // wall crest, landing-zone frames, green complex.
        { key: 'rocks_red_bright', x: 852, y: 980, h: 14 },
        { key: 'rocks_red_cluster', x: 790, y: 1070, h: 12 },
        { key: 'rocks_red_cluster', x: 862, y: 620, h: 16 },
        { key: 'rocks_red_bright', x: 845, y: 300, h: 15 },
        { key: 'rocks_red_cluster', x: 700, y: 120, h: 13 },
        { key: 'rocks_red_cluster', x: 208, y: 1105, h: 7 },
        { key: 'rocks_red_bright', x: 165, y: 905, h: 8 },
        { key: 'rocks_red_cluster', x: 200, y: 660, h: 8 },
        { key: 'rocks_red_bright', x: 268, y: 455, h: 7 },
        { key: 'rocks_red_cluster', x: 330, y: 300, h: 8 },
        { key: 'rocks_red_bright', x: 448, y: 852, h: 6 },
        { key: 'rocks_red_cluster', x: 530, y: 640, h: 7 },
        { key: 'rocks_red_bright', x: 640, y: 330, h: 9 },
        { key: 'rocks_red_cluster', x: 470, y: 250, h: 8 },
        // PASS 6: h3-level rock density — upper-terrace crests, the dogleg
        // turn, an erosion break on the cliff line, extra green-complex
        // stone.
        { key: 'rocks_red_cluster', x: 600, y: 905, h: 17 },
        { key: 'rocks_red_bright', x: 636, y: 700, h: 17 },
        { key: 'rocks_red_cluster', x: 392, y: 612, h: 9 },
        { key: 'rocks_red_bright', x: 302, y: 522, h: 7 },
        { key: 'rocks_red_cluster', x: 590, y: 258, h: 12 }
      ],
    },
    {
      number: 2, name: "Devil's Kitchen", par: 3,
      world: { width: 900, height: 950 },
      tee: [450, 800], teeBox: { w: 26, d: 18 },
      green: { cx: 450, cy: 430, rx: 62, ry: 50, rot: -0.2 },
      slope: { angle: 4.4, strength: 0.35 },
      // PASS 4: NO fairway at all — this is a pure tee-to-mesa carry.
      fairways: [],
      hazards: [
        // The kitchen: canyon floor waste wall-to-wall between the mesas.
        { type: 'bunker', waste: true, polygon: blob(450, 668, 340, 98, 16, 0.26, 21) },
        // PASS 6: the two greenside craters are genuinely DEEP erosion
        // pits — visibly sunken, steep-walled, punishing but playable
        // (depthMul 3.2 ≈ 9-12 units below their rims).
        { type: 'bunker', depthMul: 3.2, polygon: blob(362, 478, 36, 30, 10, 0.34, 22) },
        { type: 'bunker', depthMul: 3.2, polygon: blob(548, 452, 34, 28, 10, 0.34, 23) },
        { type: 'bunker', waste: true, polygon: blob(230, 550, 120, 210, 12, 0.4, 24) },
        { type: 'bunker', waste: true, polygon: blob(680, 535, 120, 220, 12, 0.4, 25) },
        { type: 'bunker', waste: true, polygon: blob(450, 205, 260, 70, 14, 0.3, 26) }
      ],
      aiTargets: [[450, 470]],
      // PASS 4: mesas sculpted like NATURAL sandstone — irregular rims via
      // small promontory lobes (+) and erosion notches (−) placed on the
      // skirt ring, well clear of the smooth tee/putting surfaces.
      elevation: [
        // PASS 6: the tee mesa RAISED well above the green mesa (34 vs 22)
        // — a genuinely downhill carry, read by the HUD elevation delta.
        { x: 450, y: 815, h: 34, r: 150, shape: 'plateau', skirt: 0.86 },
        // Tee mesa erosion: two promontories, one bite.
        { x: 322, y: 872, h: 8, r: 52, shape: 'plateau', skirt: 0.6 },
        { x: 585, y: 748, h: 6, r: 46, shape: 'plateau', skirt: 0.6 },
        { x: 388, y: 700, h: -7, r: 40, shape: 'plateau', skirt: 0.62 },
        { x: 450, y: 425, h: 22, r: 135, shape: 'plateau', skirt: 0.92 },
        // PASS 6: TWO-TIER GREEN — a broad back tier (+2.2) with a wide,
        // smooth, puttable ramp between tiers (slope ≈0.45 per 8px, well
        // under the 1.2 putt-step gate; no lip, no cliff).
        { x: 426, y: 404, x2: 474, y2: 398, h: 2.2, r: 60, shape: 'plateau', skirt: 0.35 },
        // Green mesa erosion (all outside the green + fringe).
        { x: 330, y: 330, h: 7, r: 46, shape: 'plateau', skirt: 0.6 },
        { x: 578, y: 500, h: 6, r: 42, shape: 'plateau', skirt: 0.6 },
        { x: 540, y: 322, h: -6, r: 36, shape: 'plateau', skirt: 0.62 },
        { x: 352, y: 528, h: -6, r: 34, shape: 'plateau', skirt: 0.62 },
        // PASS 5: significant drop-off BEHIND the green — a broad erosion
        // shelf bitten out of the back rim so anything long tumbles off the
        // mesa. Kept clear of the putting surface (green edge y=380).
        { x: 398, y: 288, x2: 505, y2: 282, h: -9, r: 48, shape: 'plateau', skirt: 0.62 },
        // The mesa field to every edge (pass-3 identity).
        { x: 120, y: 300, x2: 60, y2: 800, h: 26, r: 200, shape: 'plateau', skirt: 0.85 },
        { x: 800, y: 250, x2: 860, y2: 750, h: 28, r: 210, shape: 'plateau', skirt: 0.85 },
        { x: 200, y: 80, x2: 750, y2: 60, h: 30, r: 190, shape: 'plateau', skirt: 0.85 },
        { x: 130, y: 920, h: 22, r: 150, shape: 'plateau', skirt: 0.85 },
        { x: 780, y: 900, h: 24, r: 160, shape: 'plateau', skirt: 0.85 }
      ],
      landforms: [
        { key: 'rocks_red_bright', x: 100, y: 520, h: 16 },
        { key: 'rocks_red_cluster', x: 828, y: 420, h: 18 },
        { key: 'rocks_red_bright', x: 420, y: 70, h: 15 },
        { key: 'rocks_red_cluster', x: 680, y: 78, h: 13 },
        { key: 'rocks_red_cluster', x: 250, y: 828, h: 10 },
        { key: 'rocks_red_bright', x: 660, y: 850, h: 11 },
        // PASS 5: exposed sandstone ringing the green mesa itself — rocks
        // studding the rim and skirt so the mesa reads as bare bedrock.
        { key: 'rocks_red_cluster', x: 332, y: 472, h: 19 },
        { key: 'rocks_red_bright', x: 566, y: 372, h: 19 },
        { key: 'rocks_red_cluster', x: 452, y: 292, h: 15 },
        { key: 'rocks_red_bright', x: 368, y: 318, h: 18 },
        { key: 'rocks_red_cluster', x: 555, y: 505, h: 14 },
        // The deep erosion craters' outer lips.
        { key: 'rocks_red_bright', x: 330, y: 452, h: 6 },
        { key: 'rocks_red_cluster', x: 578, y: 432, h: 6 },
        // PASS 6: the mesa base + canyon floor + tee mesa — the green
        // surrounded by exposed geology, the corridor itself left clear.
        { key: 'rocks_red_cluster', x: 386, y: 514, h: 12 },
        { key: 'rocks_red_bright', x: 518, y: 500, h: 12 },
        { key: 'rocks_red_cluster', x: 262, y: 692, h: 1 },
        { key: 'rocks_red_bright', x: 636, y: 706, h: 1 },
        { key: 'rocks_red_cluster', x: 380, y: 882, h: 30 },
        { key: 'rocks_red_bright', x: 508, y: 268, h: 10 }
      ],
    },
    {
      number: 3, name: 'Wolf Run', par: 5,
      world: { width: 1150, height: 1560 },
      tee: [820, 1450], teeBox: { w: 30, d: 22 },
      // PASS 6 — THE FINAL TURN: the green swung ~45° LEFT off the last
      // island's axis and sunk a FULL step below island level (−10 vs +4 —
      // the same vertical as the tee→island drop), inside a crater bowl.
      green: { cx: 300, cy: 480, rx: 56, ry: 46, rot: 0.7 },
      green2: { cx: 262, cy: 452, rx: 34, ry: 28, rot: 0.7 },
      slope: { angle: 5.6, strength: 0.34 },
      // PASS 4 — ISLAND PLATFORMS: three separate fairway islands carved
      // into the canyon (all at +4), reached by chosen carries. Island 1→3
      // is exactly driver range, so a big hitter can skip island 2.
      fairways: [
        { centerline: [[740, 1210], [660, 1100]], width: [96, 96] },
        { centerline: [[508, 962], [450, 885]], width: [86, 86] },
        { centerline: [[460, 700], [430, 575]], width: [86, 86] }
      ],
      hazards: [
        // Wolf Wash winding across the canyon floor between the islands.
        { type: 'bunker', waste: true, polygon: stream([[210, 1180], [330, 1090], [455, 1086], [600, 1032], [712, 976], [662, 848], [575, 770], [545, 715], [528, 648], [505, 560]], 50, 31) },
        // Canyon floor waste pools in the carry gaps.
        { type: 'bunker', waste: true, polygon: blob(880, 1320, 105, 115, 13, 0.36, 32) },
        { type: 'bunker', waste: true, polygon: blob(590, 1235, 82, 78, 12, 0.38, 36) },
        { type: 'bunker', waste: true, polygon: blob(320, 985, 88, 85, 12, 0.4, 37) },
        { type: 'bunker', waste: true, polygon: blob(620, 480, 88, 95, 12, 0.4, 33) },
        // Bowl-rim pots flanking the sunken green's entrance.
        { type: 'bunker', polygon: blob(374, 436, 26, 22, 9, 0.3, 34) },
        { type: 'bunker', polygon: blob(240, 548, 26, 22, 9, 0.28, 35) }
      ],
      aiTargets: [[700, 1155], [485, 935], [445, 640]],
      // Elevated tee (+18) → islands all at +4 → green INSIDE a bowl one
      // level lower, the bowl OPEN at the front (toward island 3). Canyon
      // rim walls keep the pass-3 identity around everything.
      elevation: [
        { x: 820, y: 1462, h: 18, r: 150, shape: 'plateau', skirt: 0.78 },
        // The three islands (equal height, own plateaus, canyon between).
        { x: 740, y: 1210, x2: 660, y2: 1100, h: 4, r: 96, shape: 'plateau', skirt: 0.7 },
        { x: 525, y: 985, x2: 450, y2: 885, h: 4, r: 88, shape: 'plateau', skirt: 0.7 },
        { x: 460, y: 700, x2: 430, y2: 575, h: 4, r: 88, shape: 'plateau', skirt: 0.7 },
        // The wash bed carved below the floor, rocky bumps inside.
        { x: 640, y: 1000, x2: 470, y2: 1030, h: -3, r: 70 },
        { x: 585, y: 995, h: 1.0, r: 18 },
        // PASS 6 — THE CRATER BOWL: the green sits at the bottom of a
        // sunken crater (−10, a full step below the +4 islands, matching
        // the tee→island vertical). The crater's own rim ramp is the open
        // front; cliff-like horseshoe walls stack LEFT/BACK/RIGHT on the
        // rim so those misses face steep uphill recoveries, while the
        // front-right entrance stays a rolling ramp in.
        { x: 300, y: 480, h: -10, r: 135, shape: 'plateau', skirt: 0.62 },
        { x: 172, y: 570, x2: 155, y2: 430, h: 9, r: 95 },
        { x: 195, y: 348, x2: 330, y2: 318, h: 10, r: 100 },
        { x: 418, y: 350, x2: 452, y2: 438, h: 9, r: 90 },
        // Canyon rim walls (pass-3 winding-canyon identity; the west rim
        // shortened + a NW continuation so the bowl owns its corner).
        { x: 1045, y: 1520, x2: 975, y2: 1100, h: 20, r: 190, shape: 'plateau', skirt: 0.85 },
        { x: 940, y: 1100, x2: 770, y2: 640, h: 22, r: 200, shape: 'plateau', skirt: 0.85 },
        { x: 770, y: 640, x2: 610, y2: 200, h: 24, r: 190, shape: 'plateau', skirt: 0.85 },
        { x: 470, y: 1460, x2: 330, y2: 1100, h: 18, r: 180, shape: 'plateau', skirt: 0.85 },
        { x: 250, y: 1000, x2: 110, y2: 720, h: 22, r: 200, shape: 'plateau', skirt: 0.85 },
        { x: 78, y: 430, x2: 130, y2: 240, h: 22, r: 150, shape: 'plateau', skirt: 0.85 },
        { x: 30, y: 340, x2: 90, y2: 140, h: 24, r: 140, shape: 'plateau', skirt: 0.85 }
      ],
      landforms: [
        { key: 'rocks_red_bright', x: 985, y: 1300, h: 13 },
        { key: 'rocks_red_cluster', x: 840, y: 780, h: 15 },
        { key: 'rocks_red_bright', x: 655, y: 340, h: 16 },
        { key: 'rocks_red_cluster', x: 170, y: 780, h: 14 },
        { key: 'rocks_red_bright', x: 350, y: 1260, h: 12 },
        { key: 'rocks_red_cluster', x: 690, y: 1085, h: 8 },
        { key: 'rocks_red_bright', x: 610, y: 1140, h: 7 },
        { key: 'rocks_red_cluster', x: 120, y: 200, h: 15 },
        // PASS 6: rocks crowning the crater bowl's horseshoe rim (left,
        // back, right — the entrance kept clear), the final-descent edge,
        // wash banks, and island-edge studs.
        { key: 'rocks_red_bright', x: 162, y: 486, h: 7 },
        { key: 'rocks_red_cluster', x: 250, y: 330, h: 9 },
        { key: 'rocks_red_bright', x: 448, y: 392, h: 8 },
        { key: 'rocks_red_cluster', x: 200, y: 592, h: 2 },
        { key: 'rocks_red_bright', x: 402, y: 300, h: 9 },
        { key: 'rocks_red_cluster', x: 528, y: 622, h: 0 },
        { key: 'rocks_red_bright', x: 388, y: 660, h: 3 },
        { key: 'rocks_red_cluster', x: 505, y: 720, h: 1 },
        { key: 'rocks_red_bright', x: 590, y: 820, h: 3 }
      ],
    }
  ]
};

// ------------------------------------------------------------- Wild Prairie
// Erin Hills x Sand Valley (skewed Sand Valley): rolling fescue sand barrens.
// (Course id stays 'wildvalley' for save/flag compatibility — only the
// visible name changed to Wild Prairie.)
const wildvalley = {
  name: 'Wild Prairie',
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
    // WILD PRAIRIE PASS: heather_fescue_c is a woody twiggy shrub card that
    // reads as an ORANGE BUSH in the field — removed from this course. The
    // two true golden-grass cards carry the native rough alone.
    heatherKeys: ['heather_fescue_a', 'heather_fescue_b'],
    bunkerLipFescue: true,
    // Every bunker's edge packed with the golden fescue, and blowouts dug
    // into genuinely deep center-weighted bowls.
    bunkerLipPacked: true,
    // Dense native prairie: value-noise clustering (large continuous
    // patches, double-planted cores, fairway-edge grass fingers).
    prairieClusters: true,
    lushGrass: true,
    stripeStrength: 1.3,
    tallGrass: { cap: 8, density: 30, waste: true },
    roughTuftHeight: 1.9,
    tuftDensity: 3.0,
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
      // WILD PRAIRIE PASS — the split moved to the DRIVER landing zone.
      // Monte Carlo audit (60 seeded drives, 85-stat golfer): rest band
      // y 534–653, mean (475,593) = 269yd. The fairway balloons to 150
      // around that band and the hole bends visibly after the split.
      centerline: [[470, 1100], [460, 960], [455, 830], [462, 700], [472, 590], [468, 470], [496, 385]],
      width: [50, 84, 110, 132, 150, 96, 56],
      hazards: [
        // THE SPLIT: a deep central bunker in the actual drive zone —
        // ~26yd wide, fully inside the 75yd-wide fairway, leaving ~24yd of
        // legitimate fairway lane on BOTH sides (carry it, or pick a lane).
        { type: 'bunker', polygon: blob(472, 592, 26, 30, 12, 0.42, 49) },
        // Flank blowouts pressed against the drive zone's edges (torn from
        // the great ridge's flank right, the counter-ridge left).
        { type: 'bunker', waste: true, polygon: blob(650, 650, 88, 96, 14, 0.52, 41, 0.7) },
        { type: 'bunker', waste: true, polygon: blob(286, 668, 94, 116, 14, 0.5, 42) },
        // Short-of-the-zone blowout that eats a mishit drive.
        { type: 'bunker', waste: true, polygon: blob(610, 834, 80, 74, 13, 0.46, 45) },
        // Lay-up cross-pot inside the fairway's left half.
        { type: 'bunker', polygon: blob(440, 476, 18, 22, 9, 0.34, 48) },
        // Green-front defenders.
        { type: 'bunker', polygon: blob(446, 334, 32, 26, 9, 0.34, 43) },
        { type: 'bunker', polygon: blob(586, 340, 34, 26, 9, 0.34, 44) }
      ],
      aiTargets: [[440, 700], [478, 468]],
      // HERO: THE GREAT RIDGE — one huge wind-sculpted dune (h13) running
      // the whole right side, the fairway flowing down the broad valley at
      // its foot, a lower counter-ridge left, and edge dunes continuing the
      // system past every side. Blowouts are cut into the great ridge's
      // flank; the green is tucked where the valley pinches shut.
      elevation: [
        { x: 780, y: 1080, x2: 700, y2: 430, h: 15, r: 235 },
        { x: 190, y: 1000, x2: 290, y2: 480, h: 8, r: 175 },
        { x: 260, y: 105, x2: 790, y2: 140, h: 9, r: 160 },
        { x: 470, y: 1155, h: 6, r: 145, shape: 'plateau' },
        { x: 510, y: 292, h: 4, r: 112, shape: 'plateau' },
        // WILD PRAIRIE PASS — restored hilliness: cross-ridges roll the
        // fairway itself (a carry ridge before the split, a saddle through
        // the drive zone, dune shoulders pinching the approach) without
        // flattening the broad landing area.
        { x: 340, y: 890, x2: 620, y2: 856, h: 3.2, r: 105 },
        { x: 350, y: 800, x2: 600, y2: 760, h: 2.2, r: 95 },
        { x: 360, y: 660, x2: 400, y2: 640, h: 2.6, r: 80 },
        { x: 560, y: 640, x2: 600, y2: 600, h: 2.8, r: 85 },
        { x: 380, y: 545, x2: 640, y2: 590, h: 2.5, r: 100 },
        { x: 400, y: 430, x2: 430, y2: 415, h: 2.2, r: 70 },
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
      // WILD PRAIRIE PASS — pins favor the BACK-RIGHT (the green2 lobe):
      // the default pin and two of three rotations sit there; front-left
      // on the main lobe stays in the mix.
      pins: [[492, 372], [436, 424], [372, 456]],
      hazards: [
        // The notch bunker in the crook of the kidney — enlarged: it now
        // guards the direct line at the back-right pin.
        { type: 'bunker', polygon: blob(500, 470, 40, 34, 11, 0.32, 55) },
        // West-face pot, enlarged — it eats the "safe" bailout away from
        // the back-right pin.
        { type: 'bunker', polygon: blob(330, 486, 36, 30, 10, 0.32, 56) },
        // Blowouts pulled ONTO the approach dispersion: a push-right miss
        // feeds the east blowout; a pull/short-left finds the west one.
        // Both pressed against the kettle floor's edge, deep and ragged.
        { type: 'bunker', waste: true, polygon: blob(568, 502, 92, 88, 14, 0.52, 51) },
        { type: 'bunker', waste: true, polygon: blob(262, 566, 104, 122, 14, 0.52, 53) }
      ],
      aiTargets: [[400, 470]],
      // HERO: THE AMPHITHEATER — the kettle scaled to landform: a
      // horseshoe of 9.5-11-high dune walls enclosing the green (open only
      // at the front-right entrance), outer shoulders carrying the bowl's
      // rim past both edges, the green low on the bowl floor.
      // WILD PRAIRIE PASS: enclosing walls raised — the amphitheater reads
      // again from the tee (the putting surface untouched, gate-checked).
      elevation: [
        { x: 245, y: 565, x2: 235, y2: 360, h: 12.5, r: 140 },
        { x: 362, y: 250, x2: 488, y2: 228, h: 14, r: 155 },
        { x: 600, y: 330, x2: 615, y2: 470, h: 12.5, r: 130 },
        // Rim shoulders continuing the bowl beyond the frame.
        { x: 150, y: 250, x2: 60, y2: 600, h: 8, r: 160 },
        { x: 700, y: 250, x2: 800, y2: 550, h: 8, r: 160 },
        { x: 430, y: 420, h: 2, r: 150, shape: 'plateau' },
        { x: 352, y: 372, h: 1.6, r: 120 },
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
      // WILD PRAIRIE PASS: the S-curve deepened (LZ1 pushed left, the turn
      // to LZ2 sharpened) and every bunker re-audited against the Monte
      // Carlo dispersion: drives rest x521–560 / y956–1057, second shots
      // y450–606 — the traps now live exactly there.
      centerline: [[400, 1410], [420, 1270], [468, 1130], [540, 1010], [618, 878], [655, 750], [688, 620], [726, 500], [752, 420]],
      width: [54, 80, 96, 98, 118, 84, 70, 58, 48],
      hazards: [
        // LZ1 bailout blowout pressed to the drive zone's left edge.
        { type: 'bunker', waste: true, polygon: blob(344, 1030, 84, 92, 13, 0.38, 61) },
        // Aggressive-line pot INSIDE the fairway at the drive zone's right.
        { type: 'bunker', polygon: blob(566, 1000, 24, 26, 10, 0.34, 71) },
        // The HERO blowout complex torn from the second ridge's face —
        // shifted onto the aggressive carry line over the ridge.
        { type: 'bunker', waste: true, polygon: blob(806, 914, 100, 110, 14, 0.52, 62) },
        { type: 'bunker', waste: true, polygon: blob(706, 1030, 70, 76, 13, 0.46, 73) },
        { type: 'bunker', waste: true, polygon: blob(820, 830, 82, 74, 13, 0.5, 74) },
        // Decision pot INSIDE the second landing zone (y450-606 band).
        { type: 'bunker', polygon: blob(722, 532, 18, 22, 10, 0.4, 75) },
        // Lay-up cross-pots at the corridor's left edge.
        { type: 'bunker', polygon: blob(676, 660, 24, 20, 10, 0.34, 63) },
        { type: 'bunker', polygon: blob(668, 692, 22, 18, 10, 0.3, 64) },
        // Green complex: a front cross-pot in the final fairway and the
        // right-side pot pressed against the green.
        { type: 'bunker', polygon: blob(742, 446, 20, 18, 9, 0.32, 72) },
        { type: 'bunker', polygon: blob(838, 362, 34, 26, 9, 0.34, 66) }
      ],
      aiTargets: [[468, 1130], [618, 874], [700, 600]],
      // HERO: THE BLOWOUT WALL — two mega-ridges crossing the hole, with
      // a giant three-bowl blowout complex torn out of the second ridge's
      // face at the aggressive line; the green rides high behind the last
      // ridge's shoulder, approach half-screened.
      elevation: [
        { x: 140, y: 1180, x2: 560, y2: 1060, h: 11, r: 210 },
        { x: 620, y: 960, x2: 1080, y2: 840, h: 12, r: 220 },
        { x: 300, y: 700, x2: 640, y2: 600, h: 7, r: 150 },
        { x: 560, y: 505, x2: 860, y2: 462, h: 10, r: 165 },
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
