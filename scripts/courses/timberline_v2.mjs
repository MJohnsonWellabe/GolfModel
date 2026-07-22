// TIMBERLINE v2 — full teardown/rebuild, iteration 2 (owner art+design notes,
// 2026-07-20: real assets, DRAMATIC elevation, challenge from terrain not
// length, h3 < 600 yd). Emitted to src/data/courses/v2/timberline.json,
// dev-only behind `courseRebuilds`.
//
// COURSE IDENTITY: a MOUNTAIN course. Trees guard greens & set doglegs; but
// the terrain is the star — elevated tees, downhill drives, uphill benched
// greens, steep forested mountainsides, granite. Challenge = elevation +
// trees, not yardage.
//
// Vertical unit ≈ 1.5 ft, so h:20 ≈ 30 ft. Framing mountainsides run h:24-38
// (steep, they READ as hills); playing elevation (tee vs green) runs 10-20 ft.
import { blob, rng, stream } from '../courselib.mjs';

// Granite landform helper (render-only alpine outcrop).
const granite = (x, y, h, key = 'rock_granite_b') => ({ key, x, y, h });

// H1 OBSIDIAN/GRANITE TALUS FIELD — a decorative rock apron spreading from the
// dogleg massif up the fairway's outer (north) shoulder toward the green: DENSE
// against the formation, thinning to nothing, big rocks with medium stones and
// small fragments filling the gaps (owner Phase-1 H1). Authored as LANDFORMS so
// every rock is render-only (no collision — "outside normal play"), grounded by
// placeProto at heightAt, and GPU-instanced (three shared granite source meshes).
// Deterministic (seeded) so regen is stable. Held off the fairway, green and the
// left "Point" tree stand.
function h1RockField() {
  const CL = [[700, 1080], [700, 940], [702, 800], [700, 672], [584, 566], [452, 470], [380, 438]];
  const W = [42, 58, 82, 82, 74, 58, 48];
  function nearest(px, py) {
    let best = { d: 1e9, qy: 0, hw: 0 };
    for (let i = 0; i < CL.length - 1; i++) {
      const ax = CL[i][0], ay = CL[i][1], bx = CL[i + 1][0], by = CL[i + 1][1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(px - qx, py - qy);
      if (d < best.d) best = { d, qy, hw: (W[i] + (W[i + 1] - W[i]) * t) / 2 };
    }
    return best;
  }
  const green = { cx: 360, cy: 420, r: 62 };
  const point = [[512, 700], [548, 606], [512, 522], [430, 540], [420, 636], [456, 706]];
  const pip = (px, py, poly) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) ins = !ins; } return ins; };
  const anchor = [726, 596];
  const keys = ['rock_granite_a', 'rock_granite_b', 'rock_granite_c'];
  const r = rng(7781);
  const out = [];
  for (let y = 398; y <= 666; y += 12) {
    for (let x = 430; x <= 786; x += 12) {
      const jx = x + (r() - 0.5) * 13, jy = y + (r() - 0.5) * 13;
      const n = nearest(jx, jy);
      const edge = n.d - n.hw;                       // distance OUTSIDE the fairway edge
      if (edge < 9 || edge > 96) continue;           // a band hugging the outer shoulder
      if (jy > n.qy + 6) continue;                   // outer (north/massif) side only
      if (Math.hypot(jx - green.cx, jy - green.cy) < green.r + 14) continue;
      if (pip(jx, jy, point)) continue;
      const dA = Math.hypot(jx - anchor[0], jy - anchor[1]);
      const dens = Math.max(0.05, 0.8 - dA / 300);   // dense near the massif -> thins out
      if (r() > dens) continue;
      // Mostly medium stones and small fragments; a few larger stones near the
      // massif (the massif itself owns the big-boulder note). ~45% fragments.
      const near = 1 - Math.min(1, dA / 260);
      const frag = r() < 0.45;
      const big = !frag && r() < 0.22 + near * 0.18;  // occasional larger stone, likelier near the massif
      const h = frag ? 1.6 + r() * 2.2 : big ? 6 + near * 4 + r() * 2 : 3.2 + near * 2.6 + r() * 1.6;
      out.push({ key: keys[Math.floor(r() * keys.length)], x: Math.round(jx), y: Math.round(jy), h: Math.round(h * 10) / 10 });
    }
  }
  return out;
}

const timberlineV2 = {
  name: 'Timberline East',
  version: 2,
  theme: {
    skyTop: '#5f86a8', skyBottom: '#cfe0e6', sunX: 460, sunY: 150,
    fairway: '#3f7f46', fairwayDark: '#356b3c',
    rough: '#4a6b41', roughDark: '#3a5533',
    fringe: '#54924e', green: '#438a47', greenLight: '#5aa25c',
    sand: '#d8cba0', sandDark: '#b3a072',
    // Production Timberline's water look (owner: prod H3 water read better) —
    // brighter cerulean/navy body + the softer 0.62 fresnel default (no strength
    // override below), so the reflection doesn't blow out to a white mirror.
    water: '#2f83c0', waterDeep: '#1d5488', waterReflect: true,
    treeCanopy: '#2f5738', treeCanopyLight: '#3d6a44', treeTrunk: '#5b4632',
    haze: '#cfe0e6', hazeStrength: 0.5, horizonTint: '#bcd2da',
    backdrop: 'peaks', peakKeys: ['mountain_range_alpine'], blossomChance: 0,
    // NEW CC0 assets (Quaternius, keepTexture): detailed firs dominate the
    // alpine conifer wall, golden aspen mixes in; the flat Kenney pines are
    // gone. Detailed leafy shrub replaces the block bushes. Grey granite
    // boulders scatter through the rough (and mound behind greens as authored
    // landforms).
    // Owner tree choice (revised): detailed Quaternius ALPINE PINES dominate the
    // forest so "Timberline" reads as an evergreen mountain course, not an autumn
    // broadleaf wood (and a cleaner, layered conifer silhouette than the blobby
    // firs — owner: "find a better conifer"). Golden aspen mixes in for seasonal
    // colour. Every tree is a full canopy planted IN a stand, so it carries
    // collision from collectTreeBlobs; the broken/dead-spar + fallen-log stay OUT.
    treeKeys: ['tree_pine_q1', 'tree_pine_q2', 'tree_aspen'],
    accentTreeKeys: ['tree_pine_q1', 'tree_maple'],
    // UNDERSTORY — the forest-pack "bush" meshes ship WITHOUT their leaf-cutout
    // texture (the fbx references a missing C:\ leaf png), so they render as
    // solid boxes. The foliage that reads as REAL 3D growth is the photo-
    // textured, alpha-cut kind: alpine HEATHER (purple bloom) + golden fescue
    // in clumps through the rough (theme.heatherKeys + a light, CLUSTERED
    // tallGrass — an alpine meadow understory, not a links wall), and 3D FERNS
    // as the near-tree forest floor (bushKeys).
    // No card-scatter bushes at all — every card-foliage mesh we own (forest
    // bushes, ferns) ships without its alpha leaf texture and renders as a
    // solid box. The heather field (below) is the ONLY foliage that reads as
    // real 3D growth (photo-textured, alpha-cut).
    bushKeys: [],
    heatherKeys: ['heather_purple', 'heather_purple', 'heather_fescue_a', 'heather_purple'],
    tallGrass: { cap: 5, density: 5 },
    prairieClusters: true,
    // Rough scatter: granite boulders only. The deadwood (tree_fallen / stump /
    // log) is gone — it read as broken litter and, as visual-only scatter,
    // carried no collision.
    scatterKeys: ['rock_granite_a', 'rock_granite_b', 'rock_granite_c'],
    // Broken granite rims the h2 waste tongue (only waste on the course) so the
    // scree wash below the green reads as rock, not bare sand.
    wasteRimKeys: ['rock_granite_a', 'rock_granite_b', 'rock_granite_c'],
    // Denser conifer backdrop wall (owner: "truly a mountain course in the
    // woods") — tighter than the old 46, but not so tight it buries the tee
    // camera in draw calls (step 32 timed out the h1 render).
    backdropTreeStep: 40,
    tuftDensity: 1.1, roughTuftHeight: 1.15,
    // grass_c/d/e/f/i render as SOLID low-poly BLOBS (the "green boxes" in the
    // rough — the game's own comment warns grass cards "read as 2D blocks the
    // taller they get"). grass_g/h are the ones that render as real thin
    // BLADES, so the rough reads as soft grass, not boxes.
    lushGrass: true, grassKeys: ['grass_g', 'grass_h'],
    edgeWobble: 2.4, mowPattern: 'cross', mowWidth: 26,
    greenColumns: true, greenMowPattern: 'cross',
    cloudStyle: 'wispy', atmosphere: 'alpine'
  },
  holes: [
    // ============================================ h1 "Granite Bend" par 4
    // Elevated tee on a granite shoulder: the drive plays DOWNHILL and left,
    // bending around a spruce-and-granite point, to a corner bench ~25 ft
    // below the tee. Then the approach climbs UPHILL to a green benched into
    // the mountainside, guarded front-left by a tree stand and front-right by
    // sand. Challenge: judge the downhill drive AND the uphill approach, on a
    // dogleg the trees define.
    {
      number: 1,
      name: 'Granite Bend',
      par: 4,
      world: { width: 1040, height: 1200 },
      // Tee kept LEFT of x=740 (the hardcoded right backdrop-tree band starts
      // there — a tee on the edge plants a scenery tree right at the camera).
      tee: [700, 1110],
      teeBox: { w: 30, d: 22 },
      green: { cx: 360, cy: 420, rx: 58, ry: 44, rot: 0.4 },
      slope: { angle: 2.3, strength: 0.3 },
      centerline: [[700, 1080], [700, 940], [702, 800], [700, 672], [584, 566], [452, 470], [380, 438]],
      width: [42, 58, 82, 82, 74, 58, 48],
      hazards: [
        // THE POINT — spruce-on-granite in the gap between the drive fairway
        // (right) and the direct line (left); blocks the greedy cut.
        { type: 'trees', spacing: 34, visualSpacing: 22, polygon: [[512, 700], [548, 606], [512, 522], [430, 540], [420, 636], [456, 706]] },
        { type: 'rock', cx: 470, cy: 686, r: 16, height: 16, key: 'rock_granite_a', polygon: blob(470, 686, 16, 16, 8, 0, 1) },
        // GRANITE MASSIF AT THE DOGLEG — a tall STACK of collidable boulders
        // piled at the FAR END of the straightaway, dead ahead in the tee camera
        // right where the fairway bends left (owner: "put about 10 of the rocks
        // at the end of the fairway straight out where it bends left" — and
        // twice flagged the old rocks as invisible from the tee). Built on the
        // OUTSIDE of the corner (the fairway swings left off x700, opening room
        // there) and stacked TALL — a ~44-unit peak at the back — so the outcrop
        // reads as a landmark from 250 yd. A drive that turns the dogleg is
        // clean; a ball flown straight past the bend caroms off real rock.
        { type: 'rock', cx: 742, cy: 560, r: 34, height: 44, key: 'rock_granite_a', polygon: blob(742, 560, 34, 34, 8, 0, 21) },
        { type: 'rock', cx: 734, cy: 582, r: 32, height: 42, key: 'rock_granite_b', polygon: blob(734, 582, 32, 32, 8, 0, 22) },
        { type: 'rock', cx: 720, cy: 562, r: 30, height: 40, key: 'rock_granite_c', polygon: blob(720, 562, 30, 30, 8, 0, 23) },
        { type: 'rock', cx: 746, cy: 602, r: 32, height: 40, key: 'rock_granite_a', polygon: blob(746, 602, 32, 32, 8, 0, 24) },
        { type: 'rock', cx: 758, cy: 626, r: 30, height: 38, key: 'rock_granite_b', polygon: blob(758, 626, 30, 30, 8, 0, 25) },
        { type: 'rock', cx: 700, cy: 566, r: 28, height: 36, key: 'rock_granite_c', polygon: blob(700, 566, 28, 28, 8, 0, 26) },
        { type: 'rock', cx: 768, cy: 650, r: 27, height: 34, key: 'rock_granite_a', polygon: blob(768, 650, 27, 27, 8, 0, 27) },
        { type: 'rock', cx: 716, cy: 586, r: 28, height: 34, key: 'rock_granite_b', polygon: blob(716, 586, 28, 28, 8, 0, 28) },
        { type: 'rock', cx: 750, cy: 622, r: 26, height: 32, key: 'rock_granite_c', polygon: blob(750, 622, 26, 26, 8, 0, 29) },
        { type: 'rock', cx: 730, cy: 606, r: 25, height: 32, key: 'rock_granite_a', polygon: blob(730, 606, 25, 25, 8, 0, 30) },
        // THE RIDGE TAIL — the outcrop doesn't stop at the corner: it runs LEFT
        // along the fairway's outer (north) edge toward the green, tracking the
        // dogleg and THINNING to nothing (owner: "extend that rock line to the
        // left ... follow the fairway line left there then thin out"). A granite
        // spine down the mountainside shoulder; each rock held ~8px off the
        // fairway edge and well clear of the green.
        { type: 'rock', cx: 678, cy: 556, r: 24, height: 30, key: 'rock_granite_b', polygon: blob(678, 556, 24, 24, 8, 0, 31) },
        { type: 'rock', cx: 606, cy: 503, r: 20, height: 26, key: 'rock_granite_c', polygon: blob(606, 503, 20, 20, 8, 0, 32) },
        { type: 'rock', cx: 571, cy: 484, r: 16, height: 20, key: 'rock_granite_a', polygon: blob(571, 484, 16, 16, 8, 0, 33) },
        { type: 'rock', cx: 536, cy: 465, r: 13, height: 16, key: 'rock_granite_b', polygon: blob(536, 465, 13, 13, 8, 0, 34) },
        { type: 'rock', cx: 504, cy: 448, r: 10, height: 12, key: 'rock_granite_c', polygon: blob(504, 448, 10, 10, 8, 0, 35) },
        { type: 'rock', cx: 480, cy: 435, r: 8, height: 10, key: 'rock_granite_a', polygon: blob(480, 435, 8, 8, 8, 0, 36) },
        // LEFT TREELINE — extends the corner cluster UP the left of the drive
        // all the way to the tee (owner: "trees on the left all the way down...
        // extend it all the way"). This + the corner cluster + the greenside
        // guardian make a continuous left wall; clear of the drive corridor.
        { type: 'trees', spacing: 40, visualSpacing: 24, polygon: [[652, 1092], [640, 900], [604, 726], [548, 720], [556, 900], [596, 1092]] },
        // GREENSIDE GUARDIAN — spruce cluster front-left (guards the left pin;
        // approach from the drive zone stays open down the right).
        { type: 'trees', spacing: 36, visualSpacing: 22, polygon: [[248, 486], [320, 470], [336, 398], [276, 376], [236, 430]] },
        // BACKDROP WOODS directly behind the green — pulled IN over the green's
        // own width (not trailing 100+ px off to the dead left) so the green
        // sits IN the forest on the mountainside.
        { type: 'trees', spacing: 40, visualSpacing: 24, polygon: [[292, 348], [362, 300], [452, 300], [492, 214], [340, 186], [292, 250]] },
        // Greenside sand FRONT of the green — a DEEP, cleanly-defined pot the
        // uphill approach must carry (owner Round 2 H1: deeper, more defined
        // edges, prettier). depthMul 1.35->1.95 sinks the floor to a real ~5.3 ft
        // scoop; the polygon is re-cut with more vertices (9->16) and far less
        // jitter (0.30->0.13) so the rim reads as a crisp, sculpted oval instead
        // of a ragged blob, canted (rot 0.34) to sit square across the front-right
        // approach line into the benched green.
        { type: 'bunker', depthMul: 1.95, polygon: blob(438, 470, 19, 14, 16, 0.12, 111) }
      ],
      aiTargets: [[700, 700], [560, 560], [360, 470]],
      landforms: [granite(600, 640, 12, 'rock_granite_a'), granite(660, 600, 9, 'rock_granite_c'), granite(316, 350, 11, 'rock_granite_a'), granite(250, 560, 8, 'rock_granite_c'), granite(900, 760, 14, 'rock_granite_b'), ...h1RockField()],
      elevation: [
        // ELEVATED TEE — a granite shoulder ~21 ft up (kept modest enough
        // that the tee camera sits cleanly above it, not buried in the skirt).
        { x: 700, y: 1110, h: 14, r: 130, shape: 'plateau', skirt: 0.42 },
        // The drive falls: the corner bench sits ~20 ft below the tee.
        { x: 690, y: 860, h: 8, r: 150 },
        { x: 600, y: 600, h: 3, r: 140 }, // corner landing (low)
        // STEEP right mountainside (pulled to the world edge so it frames
        // without crowding the tee camera).
        { x: 948, y: 900, x2: 952, y2: 540, h: 32, r: 110 },
        { x: 540, y: 640, h: 9, r: 90 }, // the granite point rises out of the low ground
        // The approach CLIMBS to a benched green ~16 ft above the corner.
        // High skirt → wide flat top (>green) so the surface stays smooth.
        { x: 360, y: 420, h: 14, r: 170, shape: 'plateau', skirt: 0.6 },
        // Left mountainside framing + backdrop rise behind the green — kept
        // BEYOND the green's reach so their skirts don't bleed onto the putt.
        { x: 180, y: 760, x2: 160, y2: 380, h: 30, r: 100 },
        { x: 250, y: 250, h: 22, r: 105 }
      ]
    },
    // ================================================= h2 "The Tarn" par 3
    // A dramatic DOWNHILL par 3: an elevated tee on a granite ledge drops ~20
    // ft across a cold tarn to a gently tiered shelf green pinched between
    // spruce stands, with THREE separate granite mounds rising behind it
    // (boulders in the saddles between them). Trees guard, water carries, the
    // green's tilt bites.
    {
      number: 2,
      name: 'The Tarn',
      par: 3,
      world: { width: 940, height: 940 },
      tee: [470, 820],
      teeBox: { w: 30, d: 22 },
      green: { cx: 470, cy: 420, rx: 56, ry: 42, rot: 0 },
      slope: { angle: 2.6, strength: 0.34 },
      centerline: [[470, 806], [470, 784]],
      width: [40, 40],
      hazards: [
        // The tarn — the whole front carry.
        { type: 'water', polygon: [[300, 560], [470, 540], [640, 562], [676, 632], [640, 700], [470, 724], [300, 706], [268, 634]] },
        // LEFT + RIGHT guardian spruce stands pinching the green.
        { type: 'trees', spacing: 34, visualSpacing: 22, polygon: [[316, 486], [396, 456], [412, 360], [356, 312], [278, 372], [276, 448]] },
        { type: 'trees', spacing: 34, visualSpacing: 22, polygon: [[624, 486], [702, 456], [714, 350], [650, 312], [574, 372], [584, 456]] },
        // FAR-SHORE banks — trees right ON the far waterline, left and right of
        // the green, closing the gap between the guardian spruces (set back at
        // y312-486) and the water's edge (y540-562) so the FAR coast reads as
        // treed all the way across, not bare grass (owner: "trees lining the
        // water need to go all down the visible coast — it's not even close").
        // Stop short of the green's front line (x412-574 stays open).
        { type: 'trees', spacing: 26, visualSpacing: 17, treeR: 30, polygon: [[300, 558], [410, 548], [412, 494], [352, 470], [296, 496]] },
        // Right far-shore band — widened to CONNECT to the right bank stand (x688)
        // so the coast right of the green is continuous, not gappy (Matt review:
        // "finish the right side of the coastline").
        { type: 'trees', spacing: 26, visualSpacing: 17, treeR: 30, polygon: [[576, 548], [650, 562], [692, 566], [694, 500], [624, 470], [580, 494]] },
        // FAR-SHORE SAPLING INFILL — the far (north) waterline used to read bare
        // in the two banks flanking the central waste tongue: x412->446 (between
        // the left far-shore band and the wash) and x495->576 (between the wash
        // and the right far-shore band). Owner: the far shore must be lined
        // CONTINUOUSLY with saplings across its whole visible width. These are
        // SHORT saplings (small treeR) hugging the bank BELOW the green shelf, so
        // the far coast reads treed all the way across from the tee AND aerial
        // while the descending par-3 approach still clears them (the existing
        // wash firs prove short trees here don't stop the shot). Kept south of
        // the green front (y>=500) and off the straight tee-shot lane.
        { type: 'trees', spacing: 20, visualSpacing: 13, treeR: 15, polygon: [[406, 548], [446, 542], [447, 508], [410, 502]] },
        { type: 'trees', spacing: 20, visualSpacing: 13, treeR: 15, polygon: [[498, 508], [576, 502], [578, 546], [500, 548]] },
        // WOODED SHORELINE — dense stands right ON the tarn's banks (their
        // inner edge hugs the waterline the whole height of the pond), so the
        // treeline actually MIRRORS in the water instead of sitting back on dry
        // ground (owner: "trees closer to the lake so it actually reflects
        // them"). Clear of the straight tee-shot line up the middle.
        // treeR bumped so these bankside trees stand TALL — a taller tree
        // streaks its reflection further across the water, so the mirrored
        // treeline actually reads instead of a hairline at the shore.
        { type: 'trees', spacing: 24, visualSpacing: 16, treeR: 32, polygon: [[292, 545], [262, 636], [290, 706], [214, 712], [150, 660], [150, 520], [210, 478], [264, 500]] },
        { type: 'trees', spacing: 24, visualSpacing: 16, treeR: 32, polygon: [[688, 545], [712, 636], [686, 706], [762, 712], [826, 660], [826, 520], [766, 478], [712, 500]] },
        // NEAR-SHORE stands flanking the tee, closing the ring of forest around
        // the whole tarn (owner: "surrounded by trees ... all the way up to the
        // lake"). Clear of the tee-shot line up the middle.
        { type: 'trees', spacing: 30, visualSpacing: 20, treeR: 30, polygon: [[292, 720], [250, 800], [232, 884], [156, 876], [150, 752], [214, 700]] },
        { type: 'trees', spacing: 30, visualSpacing: 20, treeR: 30, polygon: [[688, 720], [730, 800], [748, 884], [824, 876], [830, 752], [766, 700]] },
        // SOUTH-SHORE stands lining the near bank ALL the way across (owner:
        // "trees lining hole 2 water need to go all down the visible coast") —
        // REAL collidable stands (they carry hitboxes AND reflect, unlike the old
        // decorative landform saplings). They close the gap between the near-shore
        // corner stands and hug the waterline, leaving only the straight tee-shot
        // lane (x428-512) open up the middle.
        { type: 'trees', spacing: 28, visualSpacing: 18, treeR: 28, polygon: [[292, 704], [356, 708], [428, 720], [424, 754], [350, 756], [286, 742]] },
        { type: 'trees', spacing: 28, visualSpacing: 18, treeR: 28, polygon: [[512, 720], [584, 708], [688, 704], [694, 742], [590, 756], [516, 754]] },
        // The green is PINCHED both sides by sand now (owner: "something to make
        // the hole harder ... bunkers that come into play"): a deep pot short-
        // left AND a greenside pot right, so a bail either way off the water
        // finds sand, not safety.
        { type: 'bunker', depthMul: 1.4, polygon: blob(406, 486, 16, 12, 9, 0.3, 121) },
        { type: 'bunker', depthMul: 1.4, polygon: blob(546, 466, 15, 11, 9, 0.3, 122) },
        // ROCKY WASTE TONGUE — a long thin waste bunker spilling straight off
        // the front of the green DOWN to the tarn (owner). Flat sand (waste, not
        // a dug pot), threaded between the two greenside pots so it doesn't
        // crater them; theme.wasteRimKeys rims it in broken granite and granite/
        // sapling landforms sit IN it, so it reads as a rocky scree wash — a
        // short miss trickles down the rocks toward the water.
        { type: 'bunker', waste: true, polygon: [[454, 466], [488, 466], [491, 498], [495, 522], [476, 538], [456, 536], [446, 516], [450, 490]] },
        // BACK-OF-GREEN GRANITE ROW — a line of BIG COLLIDABLE boulders standing
        // directly behind the green, in the gap between the two guardian spruce
        // stands and in FRONT of the three terrain mounds (owner Round 2 H2:
        // "line the back of the green with collidable big stones like H1's").
        // Authored as `type:'rock'` carom hazards exactly like H1's granite massif
        // — real swept-cylinder collision, so a shot flown long off the tarn
        // caroms off the rock wall instead of trickling away. Kept ~65 px behind
        // the green's back edge (clear of the putting surface) and threaded
        // between the guardian stands (x412–574 gap) so they don't bury a stand.
        { type: 'rock', cx: 416, cy: 314, r: 18, height: 22, key: 'rock_granite_a', polygon: blob(416, 314, 18, 18, 8, 0, 41) },
        { type: 'rock', cx: 452, cy: 305, r: 20, height: 26, key: 'rock_granite_b', polygon: blob(452, 305, 20, 20, 8, 0, 42) },
        { type: 'rock', cx: 490, cy: 301, r: 21, height: 27, key: 'rock_granite_c', polygon: blob(490, 301, 21, 21, 8, 0, 43) },
        { type: 'rock', cx: 528, cy: 305, r: 20, height: 26, key: 'rock_granite_a', polygon: blob(528, 305, 20, 20, 8, 0, 44) },
        { type: 'rock', cx: 564, cy: 314, r: 18, height: 22, key: 'rock_granite_b', polygon: blob(564, 314, 18, 18, 8, 0, 45) }
      ],
      aiTargets: [],
      // Granite boulders sitting in the SADDLES between the three terrain mounds
      // behind the green (owner request: rocks between the mounds), plus the
      // rocks + tiny fir saplings scattered IN the waste tongue (owner: "rocky
      // waste ... little tiny saplings in the rocks"). The waste rocks/saplings
      // are decorative landforms (no collision) — the wash plays as sand.
      landforms: [
        { key: 'rock_granite_a', x: 407, y: 268, h: 13 },
        { key: 'rock_granite_c', x: 533, y: 268, h: 13 },
        { key: 'rock_granite_b', x: 462, y: 482, h: 4 },
        { key: 'rock_granite_c', x: 480, y: 500, h: 3.2 },
        { key: 'rock_granite_a', x: 464, y: 516, h: 3.6 },
        { key: 'rock_granite_b', x: 482, y: 528, h: 3 },
        { key: 'tree_fir_a', x: 470, y: 490, h: 14 },
        { key: 'tree_fir_c', x: 457, y: 506, h: 12 },
        { key: 'tree_fir_b', x: 485, y: 520, h: 13 }
        // (The tarn-boundary trees are now REAL collidable stands in `hazards`,
        //  not collision-less landform firs — see the SHORELINE stands there.)
      ],
      elevation: [
        // ELEVATED TEE ledge ~24 ft up.
        { x: 470, y: 830, h: 16, r: 120, shape: 'plateau', skirt: 0.5 },
        // Gently tiered green: a broad flat pad with a subtle raised back
        // shelf (~3 ft, wide transition so it stays puttable — additive, so
        // the shelf sums onto the pad). The real putting test is the tilt
        // (slope 2.6/0.34) breaking across it above the tarn.
        { x: 470, y: 440, h: 4, r: 168, shape: 'plateau', skirt: 0.6 }, // green pad (wide flat top)
        { x: 470, y: 402, h: 2.6, r: 90, shape: 'plateau', skirt: 0.32 }, // back shelf — firmer upper tier (owner: harder)
        // THREE SEPARATE terrain mounds behind the green (owner request):
        // rounded domes with saddles between them (granite boulders fill the
        // saddles). Spaced/sized so their skirts stay clear of the green.
        { x: 344, y: 260, h: 24, r: 74, shape: 'dome' },
        { x: 470, y: 246, h: 30, r: 82, shape: 'dome' },
        { x: 596, y: 260, h: 24, r: 74, shape: 'dome' },
        { x: 470, y: 632, h: -1.4, r: 150 } // the tarn basin
      ]
    },
    // ============================================== h3 "Timberfall" par 5
    // A reachable mountain par 5 with a genuine two-route decision (owner
    // spec). TWO fairways run up a forested valley, split by a heavy stand of
    // trees, each side walled by woods:
    //   LEFT  — direct + HARD: a ~300 drive leaves a ~200 forced carry over a
    //           pond sitting right in front of the green, with a lone tree to
    //           shape around on the way in. Eagle bait; double-bogey teeth.
    //   RIGHT — wider + SAFE: a ~300 drive leaves ~250 in, but no water and no
    //           trees that block a shot — the lay-up-and-wedge par route.
    // Tee sits up the diagonal so the green is ~500 yd on the direct (left)
    // line, which is what makes the left's "300 + 200" geometry real.
    {
      number: 3,
      name: 'Timberfall',
      par: 5,
      world: { width: 1160, height: 1420 },
      // Tee set so the DIRECT (left) line to the green is ~500 yd and the safe
      // right arc is ~550 yd (owner Round 2 H3: right=550, left=500). The
      // straight tee->green chord is ~498 yd, so the left route (near-direct, a
      // ~300 drive + ~190 forced water carry) measures ~500 yd while the right
      // fairway's rightward bow measures ~551 yd. Pulled UP from the old y1360:
      // the old chord was already 550 yd, which made a sub-550 left route
      // geometrically impossible — the tee had to come forward to open the
      // 50-yard split between the two routes.
      // Tee pulled back ~25yd (owner: H3 "too easy") — the whole par 5 now plays
      // 25yd longer, so the go-for-it second is a genuinely longer carry over the
      // front pond. Moved the tee (not the green) so the pond/creek/pot guarding
      // and the pin-flatness/playability gates all stay exactly as tuned.
      tee: [444, 1322],
      teeBox: { w: 32, d: 24 },
      // Green trimmed (62->52 / 46->39): a smaller target the long go-for-it
      // second holds far less often, so more reach attempts spill into the front
      // sand (below) for a hard up-and-down instead of a tap-in.
      green: { cx: 840, cy: 356, rx: 52, ry: 39, rot: -0.35 },
      slope: { angle: 2.7, strength: 0.32 },
      fairways: [
        // RIGHT fairway (MAIN, safe + longer = ~551 yd): a wide arc bowed out to
        // the right; ~300 off the tee leaves ~250 in with a clean, dry look at
        // the green. The rightward bow is what buys the extra 50 yards over the
        // direct left line.
        { centerline: [[554, 1206], [744, 1024], [876, 840], [890, 694]], width: [54, 74, 82, 70] },
        // LEFT fairway (ALT, hard + direct = ~500 yd): near-straight line up the
        // middle-left; a ~310 drive leaves a ~190 forced carry over the pond and
        // past the lone tree.
        { centerline: [[500, 1200], [560, 1010], [628, 820], [664, 690]], width: [46, 54, 58, 50] }
      ],
      // The LEFT fairway is the alternate route — exclude it from yardage.
      altFairways: 1,
      hazards: [
        // THE DENSE DIVIDER — a heavy stand of trees separating the two fairways,
        // now EXTENDED ~50 yd UP the gap toward the green (owner Round 2 H3:
        // "extend the divider trees up another ~50 yards"). Runs from the fork
        // (y1190) up to y944 (~123 yd, up from the old y1042 top), tracking the
        // gap CENTERLINE the whole way — computed to stay inside the shrinking
        // corridor between the left- and right-fairway edges (gap center runs
        // x535@y1190 -> x684@y950), tapering to a spindle at the fork so it walls
        // neither drive while still forcing the two-route decision.
        { type: 'trees', spacing: 28, visualSpacing: 18, polygon: [[712, 944], [683, 1000], [651, 1050], [611, 1100], [571, 1150], [541, 1190], [529, 1190], [551, 1150], [577, 1100], [603, 1050], [631, 1000], [660, 944]] },
        // DIVIDER REINFORCEMENT (owner Round 3 H3: "add more trees in the divider
        // that'll catch bad tee shots to the left fairway that go right of the
        // left fairway"). A second dense clump filling the gap on the LEFT side
        // of the divider, right in the left-fairway drive-landing band (y~1000–
        // 1120), so a drive aimed at the left fairway that leaks right no longer
        // finds open gap — it's in the trees. Sits inside the corridor between
        // the two fairway edges, clear of both ribbons.
        { type: 'trees', spacing: 26, visualSpacing: 16, polygon: [[598, 1010], [662, 1000], [672, 1064], [648, 1116], [606, 1126], [586, 1064]] },
        // THE TREE IN THE WAY — a lone giant spruce standing in the LEFT
        // approach line: a straight go-for-the-green hits it, so the aggressor
        // must work the ball around it (owner).
        { type: 'trees', spacing: 22, visualSpacing: 14, treeR: 30, polygon: [[696, 586], [710, 538], [732, 552], [726, 582], [704, 594]] },
        // END-OF-LEFT-FAIRWAY TREE (owner Round 3 H3: "a tree at the very end of
        // that left fairway to force a shaped shot around it"). A lone spruce
        // pinching the exit of the left fairway (~y700, just right of its
        // centerline end) so the aggressive left drive must be worked around it
        // to hold the direct line to the green.
        { type: 'trees', spacing: 22, visualSpacing: 14, treeR: 26, polygon: [[664, 710], [684, 698], [696, 716], [682, 736], [662, 728]] },
        // (GREENSIDE GUARDIAN REMOVED — owner Round 2 H3: "remove all the trees
        //  around the pond, between the end of the right fairway and the green,
        //  so the right path has a clean approach." The short-right stand is gone;
        //  the right approach corridor up x840-890 to the green is now clear of
        //  every tree. The lone LEFT carry tree below stays — it's the hazard the
        //  aggressive left route must shape around.)
        // LEFT-OF-LEFT WOODS — a dense band lining the left of the left fairway
        // for most of its length, but pulled back off the tee end so the drive
        // INTO the left fairway is clearly open, not walled off (owner: "you
        // still need to be able to hit into the left fairway ... trees shouldn't
        // completely block that tee shot"). Lines y660–1120, opens below.
        { type: 'trees', spacing: 32, visualSpacing: 22, polygon: [[600, 668], [548, 800], [476, 1010], [430, 1130], [338, 1150], [300, 940], [300, 700], [356, 516]] },
        // RIGHT-OF-RIGHT WOODS — lines the whole right side of the right
        // fairway, top to bottom (owner).
        { type: 'trees', spacing: 40, visualSpacing: 26, polygon: [[900, 1290], [944, 1000], [952, 640], [904, 470], [1052, 500], [1086, 820], [1052, 1120], [956, 1300]] },
        // Behind-green woods (mountainside).
        { type: 'trees', spacing: 42, visualSpacing: 26, polygon: [[760, 258], [860, 214], [980, 236], [1000, 168], [840, 146], [740, 200]] },
        // THE FRONT POND — wraps the LEFT and FRONT-CENTER of the green so the
        // aggressive go-for-it second is a WATER carry, not a dry look (make it a
        // real 3-shot hole — owner). A long second that leaks short or a touch
        // left finds water (a penalty, the thing elite chippers can't save), so
        // going for the green in two is genuinely low-percentage. The east arm is
        // held to x826 so the SAFE right layup-and-wedge line (up x843) stays dry
        // — the smart play still finishes cleanly. Level in the enlarged basin.
        { type: 'water', polygon: [[636, 520], [652, 472], [692, 448], [734, 450], [780, 456], [814, 468], [826, 494], [806, 520], [762, 542], [716, 560], [672, 556], [646, 544]] },
        // THE CREEK — the pond narrows into a creek that winds up the LEFT side
        // of the green, behind it, and continues off screen (owner P1 H3). Shares
        // the pond's water level; its own flat channel (see elevation) keeps it
        // level. Varied natural width from the stream jitter. Held west of the
        // green bench so it never undercuts the putting shelf.
        { type: 'water', polygon: stream([[700, 486], [664, 452], [648, 404], [666, 350], [700, 300], [690, 240], [644, 180], [588, 132], [512, 74]], 30, 415) },
        // Sand: a links POT set fully INSIDE the widened right-fairway landing
        // (the only teeth on the safe route — the safe drive must avoid it), a
        // greenside pot right, and a back trap. Kept clear of the ribbon edges so
        // it reads as authored mid-fairway sand, not a scallop bitten out of the
        // fairway boundary.
        { type: 'bunker', polygon: blob(880, 800, 18, 13, 10, 0.24, 131) },
        { type: 'bunker', depthMul: 1.4, polygon: blob(906, 420, 15, 12, 9, 0.3, 132) },
        { type: 'bunker', depthMul: 1.5, polygon: blob(884, 278, 19, 13, 9, 0.3, 133) },
        // FRONT-OF-GREEN DEFENSE (make it a real 3-shot hole — owner: going for
        // the green in two must be a LOW-percentage play, a layup the smart line).
        // The RIGHT (safe) route used to leave a completely DRY look at the green,
        // so a strong hitter reached in two almost every time (birdie machine).
        // FRONT-RIGHT POT — guards the one dry sliver right of the front pond, so
        // even the safe right approach must flirt a hazard to a small green.
        { type: 'bunker', depthMul: 1.5, polygon: blob(872, 446, 16, 11, 9, 0.3, 135) }
      ],
      aiTargets: [[604, 1086], [778, 926], [890, 776], [898, 556], [862, 428]],
      landforms: [
        granite(908, 296, 12, 'rock_granite_b'), granite(300, 700, 10, 'rock_granite_c'),
        granite(772, 900, 11, 'rock_granite_a')
      ],
      elevation: [
        // ELEVATED TEE, then the land FALLS into a valley, then CLIMBS to the
        // green benched on the mountainside. (Tee shelf follows the tee back 25yd.)
        { x: 444, y: 1322, h: 18, r: 140, shape: 'plateau', skirt: 0.5 },
        { x: 520, y: 1020, h: 8, r: 160 }, // first fall
        { x: 700, y: 820, h: 3, r: 160 }, // valley floor (go-for-it zone)
        // GREEN BENCHED a full step above the pond (owner). Skirt EASED to 0.6
        // (a ~51px face instead of the old 34px) and height trimmed 16->12 so the
        // front-left face is CHIPPABLE (owner: "left of the green ... too steep to
        // chip up ... you get stuck") — max grade ~0.35 vs the old 0.76 — while
        // the radius still holds the skirt short of the pond so the water stays
        // level. Green-to-pond step is still ~14 units (a clear bench).
        // Radius trimmed 128->110 so the mesa flat top ends further north, clear
        // of the front pond now pushed up onto the approach line (keeps the water
        // level instead of riding up the bench).
        { x: 840, y: 356, h: 12, r: 110, shape: 'plateau', skirt: 0.6 },
        // POND BASIN — a flat shelf 2 units below grade that the front pond sits
        // IN, so the water reads as a level lake in a hollow instead of pasted on
        // a slope. Enlarged/recentred to span the whole wrapped pond (its east
        // front-center arm included); skirt = the lip.
        { x: 736, y: 498, h: -2, r: 140, shape: 'plateau', skirt: 0.7 },
        // CREEK CHANNEL — a narrow flat trough (same -2 level as the pond) cut
        // along the creek so the water stays level up the left of the green and
        // off screen. Held west of the green bench (clear of the putting shelf).
        { x: 700, y: 486, x2: 664, y2: 452, h: -2, r: 26, shape: 'plateau', skirt: 0.5 },
        { x: 664, y: 452, x2: 648, y2: 404, h: -2, r: 26, shape: 'plateau', skirt: 0.5 },
        { x: 648, y: 404, x2: 666, y2: 350, h: -2, r: 26, shape: 'plateau', skirt: 0.5 },
        { x: 666, y: 350, x2: 700, y2: 300, h: -2, r: 26, shape: 'plateau', skirt: 0.5 },
        { x: 700, y: 300, x2: 690, y2: 240, h: -2, r: 26, shape: 'plateau', skirt: 0.5 },
        { x: 690, y: 240, x2: 644, y2: 180, h: -2, r: 26, shape: 'plateau', skirt: 0.5 },
        { x: 644, y: 180, x2: 588, y2: 132, h: -2, r: 26, shape: 'plateau', skirt: 0.5 },
        { x: 588, y: 132, x2: 512, y2: 74, h: -2, r: 26, shape: 'plateau', skirt: 0.5 },
        // Steep forested valley walls both sides.
        { x: 200, y: 1120, x2: 220, y2: 640, h: 32, r: 110 },
        { x: 1000, y: 900, x2: 980, y2: 500, h: 34, r: 130 },
        { x: 620, y: 680, h: 10, r: 130 } // rising valley ground (clear of the pond)
      ]
    }
  ]
};

export { timberlineV2 };
