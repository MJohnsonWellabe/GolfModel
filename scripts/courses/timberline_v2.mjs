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
import { blob } from '../courselib.mjs';

// Granite landform helper (render-only alpine outcrop).
const granite = (x, y, h, key = 'rock_granite_b') => ({ key, x, y, h });

const timberlineV2 = {
  name: 'Timberline',
  version: 2,
  theme: {
    skyTop: '#5f86a8', skyBottom: '#cfe0e6', sunX: 460, sunY: 150,
    fairway: '#3f7f46', fairwayDark: '#356b3c',
    rough: '#4a6b41', roughDark: '#3a5533',
    fringe: '#54924e', green: '#438a47', greenLight: '#5aa25c',
    sand: '#d8cba0', sandDark: '#b3a072',
    water: '#3f7f9c', waterDeep: '#254f66', waterReflect: true,
    treeCanopy: '#2f5738', treeCanopyLight: '#3d6a44', treeTrunk: '#5b4632',
    haze: '#cfe0e6', hazeStrength: 0.5, horizonTint: '#bcd2da',
    backdrop: 'peaks', peakKeys: ['mountain_alps'], blossomChance: 0,
    // NEW CC0 assets (Quaternius, keepTexture): detailed firs dominate the
    // alpine conifer wall, golden aspen mixes in; the flat Kenney pines are
    // gone. Detailed leafy shrub replaces the block bushes. Grey granite
    // boulders scatter through the rough (and mound behind greens as authored
    // landforms).
    // Owner tree choice: high-quality broadleafs (birch/aspen/poplar/oak) —
    // a golden-montane forest — with standing dead spars + fallen logs mixed
    // in for character. (The low-poly conifers are out.)
    treeKeys: ['tree_birch', 'tree_aspen', 'tree_poplar', 'tree_oak'],
    accentTreeKeys: ['tree_broken', 'tree_birch_b'],
    // Detailed forest-pack shrubs (asset-packs/forest-nature-fbx): dense
    // leaf-card foliage masses that read as real undergrowth, NOT the smooth
    // low-poly bush_a/b/leafy blocks. Chosen off the in-game asset catalog
    // (treecatalog.html?set=bushes).
    bushKeys: ['bush_forest_a', 'bush_forest_b', 'bush_wolfberry', 'bush_juniper'],
    scatterKeys: ['rock_granite_a', 'rock_granite_b', 'rock_granite_c', 'tree_fallen', 'stump_a', 'log_a'],
    backdropTreeStep: 46,
    tuftDensity: 1.1, roughTuftHeight: 1.15,
    lushGrass: true, grassKeys: ['grass_c', 'grass_d', 'grass_e'],
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
        // Right forested mountainside wall (kept clear of the tee behind it).
        { type: 'trees', spacing: 40, visualSpacing: 24, polygon: [[858, 980], [928, 860], [934, 620], [880, 500], [820, 620], [834, 860]] },
        // Left treeline down the outside of the dogleg.
        { type: 'trees', spacing: 42, visualSpacing: 26, polygon: [[250, 900], [340, 820], [360, 640], [300, 520], [206, 600], [198, 820]] },
        // GREENSIDE GUARDIAN — spruce cluster front-left (guards the left pin;
        // approach from the drive zone stays open down the right).
        { type: 'trees', spacing: 36, visualSpacing: 22, polygon: [[248, 486], [320, 470], [336, 398], [276, 376], [236, 430]] },
        // Greenside sand front-right — green pinched between trees and sand.
        { type: 'bunker', depthMul: 1.35, polygon: blob(438, 470, 19, 14, 9, 0.3, 111) }
      ],
      aiTargets: [[700, 700], [560, 560], [360, 470]],
      landforms: [granite(600, 640, 12, 'rock_granite_a'), granite(660, 600, 9, 'rock_granite_c'), granite(316, 350, 11, 'rock_granite_a'), granite(250, 560, 8, 'rock_granite_c'), granite(900, 760, 14, 'rock_granite_b')],
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
        // Deep pot short-left, between tarn and green.
        { type: 'bunker', depthMul: 1.4, polygon: blob(406, 486, 16, 12, 9, 0.3, 121) }
      ],
      aiTargets: [],
      // Granite boulders sitting in the SADDLES between the three terrain
      // mounds behind the green (owner request: rocks between the mounds).
      landforms: [
        { key: 'rock_granite_a', x: 407, y: 268, h: 13 },
        { key: 'rock_granite_c', x: 533, y: 268, h: 13 }
      ],
      elevation: [
        // ELEVATED TEE ledge ~24 ft up.
        { x: 470, y: 830, h: 16, r: 120, shape: 'plateau', skirt: 0.5 },
        // Gently tiered green: a broad flat pad with a subtle raised back
        // shelf (~3 ft, wide transition so it stays puttable — additive, so
        // the shelf sums onto the pad). The real putting test is the tilt
        // (slope 2.6/0.34) breaking across it above the tarn.
        { x: 470, y: 440, h: 4, r: 168, shape: 'plateau', skirt: 0.6 }, // green pad (wide flat top)
        { x: 470, y: 406, h: 2.0, r: 92, shape: 'plateau', skirt: 0.35 }, // back shelf (+~3 ft, wide)
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
    // A reachable mountain par 5 UNDER 600 yd where the challenge is the
    // TERRAIN, not length: a downhill tee shot into a valley, then the hole
    // FALLS again over a tumbling bench before climbing to an elevated green
    // benched on the mountainside and guarded short-right by a lone giant
    // spruce. Go for it in two down the fall and the guardian + the uphill
    // pitch punish a miss; lay back and the tiered climb is still no gimme.
    {
      number: 3,
      name: 'Timberfall',
      par: 5,
      world: { width: 1160, height: 1420 },
      tee: [330, 1330],
      teeBox: { w: 32, d: 24 },
      green: { cx: 840, cy: 356, rx: 62, ry: 46, rot: -0.35 },
      slope: { angle: 2.7, strength: 0.32 },
      fairways: [
        // COMMON fairway — everyone drives to a shared landing.
        { centerline: [[330, 1300], [402, 1158], [506, 1030], [620, 904]], width: [46, 62, 82, 84] },
        // Fairway A — the RIGHT (safe, longer) route wrapping right of the
        // tree mass and climbing to the green.
        { centerline: [[620, 904], [742, 804], [798, 664], [812, 520], [838, 424]], width: [84, 72, 64, 58, 50] },
        // Fairway B — the LEFT (risky, tighter, SHORTER) branch hugging the
        // left of the tree mass to a left approach at the green: less club in
        // but pinched between the mass and the mountainside.
        { centerline: [[620, 904], [528, 802], [522, 668], [594, 584], [664, 548]], width: [84, 54, 50, 48, 46] }
      ],
      // Fairway B (the last ribbon) is the alternate route — exclude it from
      // the hole's yardage measurement.
      altFairways: 1,
      hazards: [
        // FIRST TREE PATCH — a stand LEFT of the drive fairway near the tee.
        { type: 'trees', spacing: 36, visualSpacing: 24, polygon: [[262, 1180], [348, 1146], [366, 1024], [306, 958], [228, 1030], [228, 1148]] },
        // GREENSIDE GUARDIAN — the lone giant spruce short-right of the green.
        { type: 'trees', spacing: 30, visualSpacing: 20, treeR: 32, polygon: [[892, 456], [948, 440], [962, 380], [918, 352], [876, 408]] },
        // THE TREE MASS filling the whole area between the two routes (owner
        // request): a big forested divide. A wraps right of it, B hugs left.
        { type: 'trees', spacing: 38, visualSpacing: 24, polygon: [[598, 858], [638, 762], [684, 678], [712, 700], [684, 788], [646, 864]] },
        // Collidable granite boulder at the mouth of the split.
        { type: 'rock', cx: 620, cy: 820, r: 15, height: 15, key: 'rock_granite_a', polygon: blob(620, 820, 15, 15, 8, 0, 1) },
        // Sand: cross bunker at the common landing's right; deep greenside pot.
        { type: 'bunker', polygon: blob(692, 900, 26, 18, 10, 0.35, 131) },
        { type: 'bunker', depthMul: 1.4, polygon: blob(786, 396, 18, 14, 9, 0.3, 132) }
      ],
      aiTargets: [[470, 1120], [620, 904], [730, 760], [800, 540], [838, 430]],
      landforms: [
        granite(836, 860, 13, 'rock_granite_a'), granite(720, 800, 10, 'rock_granite_c'),
        granite(908, 296, 12, 'rock_granite_b'), granite(232, 1150, 10, 'rock_granite_c')
      ],
      elevation: [
        // ELEVATED TEE, then the land FALLS into a valley and falls again.
        { x: 330, y: 1330, h: 20, r: 150, shape: 'plateau', skirt: 0.5 },
        { x: 420, y: 1160, h: 9, r: 170 }, // first landing (fallen ~16 ft)
        { x: 640, y: 980, h: 4, r: 160 }, // the valley floor
        { x: 772, y: 820, h: 2, r: 150 }, // the fall — lowest ground (go-for-it zone)
        // The green CLIMBS back up ~22 ft onto the mountainside bench.
        { x: 840, y: 356, h: 16, r: 160, shape: 'plateau', skirt: 0.55 },
        // Steep forested valley walls both sides (real mountainsides). Left
        // wall pulled out so the new left fairway isn't on its steep face.
        { x: 176, y: 1200, x2: 206, y2: 720, h: 34, r: 118 },
        { x: 980, y: 900, x2: 960, y2: 470, h: 36, r: 140 },
        { x: 660, y: 620, h: 12, r: 150 } // rising ground behind the fall
      ]
    }
  ]
};

export { timberlineV2 };
