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
    backdrop: 'peaks', peakKeys: ['mountain_range_alpine'], blossomChance: 0,
    // NEW CC0 assets (Quaternius, keepTexture): detailed firs dominate the
    // alpine conifer wall, golden aspen mixes in; the flat Kenney pines are
    // gone. Detailed leafy shrub replaces the block bushes. Grey granite
    // boulders scatter through the rough (and mound behind greens as authored
    // landforms).
    // Owner tree choice: high-quality broadleafs (birch/aspen/poplar/oak) — a
    // golden-montane forest. The broken/dead-spar + fallen-log assets are OUT
    // (owner: they read as broken and lacked collision); every tree now is a
    // real canopy planted IN a stand, so it carries collision from
    // collectTreeBlobs. (The low-poly conifers stay out too.)
    treeKeys: ['tree_birch', 'tree_aspen', 'tree_poplar', 'tree_oak'],
    accentTreeKeys: ['tree_birch_b', 'tree_maple'],
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
    // Denser conifer backdrop wall (owner: "truly a mountain course in the
    // woods") — tighter than the old 46, but not so tight it buries the tee
    // camera in draw calls (step 32 timed out the h1 render).
    backdropTreeStep: 40,
    // Stronger planar reflection so the treeline reads clearly in the tarn.
    waterReflectStrength: 0.92,
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
        // RIGHT SIDE LINED WITH COLLIDABLE GRANITE (owner: "lined with the
        // rocks we're using on hole 2 WITH collision physics") — a boulder run
        // down the right mountainside; a drive leaked right caroms off real
        // rock instead of vanishing into scenery. All clear of the drive.
        { type: 'rock', cx: 748, cy: 1082, r: 25, height: 25, key: 'rock_granite_b', polygon: blob(748, 1082, 25, 25, 8, 0, 21) },
        { type: 'rock', cx: 750, cy: 1024, r: 21, height: 21, key: 'rock_granite_c', polygon: blob(750, 1024, 21, 21, 8, 0, 26) },
        { type: 'rock', cx: 758, cy: 968, r: 26, height: 26, key: 'rock_granite_a', polygon: blob(758, 968, 26, 26, 8, 0, 22) },
        { type: 'rock', cx: 766, cy: 908, r: 22, height: 22, key: 'rock_granite_b', polygon: blob(766, 908, 22, 22, 8, 0, 27) },
        { type: 'rock', cx: 770, cy: 848, r: 26, height: 26, key: 'rock_granite_c', polygon: blob(770, 848, 26, 26, 8, 0, 23) },
        { type: 'rock', cx: 774, cy: 788, r: 22, height: 22, key: 'rock_granite_a', polygon: blob(774, 788, 22, 22, 8, 0, 28) },
        { type: 'rock', cx: 774, cy: 728, r: 24, height: 24, key: 'rock_granite_b', polygon: blob(774, 728, 24, 24, 8, 0, 24) },
        { type: 'rock', cx: 766, cy: 674, r: 20, height: 20, key: 'rock_granite_c', polygon: blob(766, 674, 20, 20, 8, 0, 29) },
        { type: 'rock', cx: 750, cy: 620, r: 20, height: 20, key: 'rock_granite_a', polygon: blob(750, 620, 20, 20, 8, 0, 25) },
        { type: 'rock', cx: 726, cy: 566, r: 17, height: 17, key: 'rock_granite_b', polygon: blob(726, 566, 17, 17, 8, 0, 30) },
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
        // WOODED SHORELINE — dense stands right ON the tarn's banks (their
        // inner edge hugs the waterline the whole height of the pond), so the
        // treeline actually MIRRORS in the water instead of sitting back on dry
        // ground (owner: "trees closer to the lake so it actually reflects
        // them"). Clear of the straight tee-shot line up the middle.
        // treeR bumped so these bankside trees stand TALL — a taller tree
        // streaks its reflection further across the water, so the mirrored
        // treeline actually reads instead of a hairline at the shore.
        { type: 'trees', spacing: 28, visualSpacing: 18, treeR: 32, polygon: [[292, 545], [262, 636], [290, 706], [214, 712], [150, 660], [150, 520], [210, 478], [264, 500]] },
        { type: 'trees', spacing: 28, visualSpacing: 18, treeR: 32, polygon: [[688, 545], [712, 636], [686, 706], [762, 712], [826, 660], [826, 520], [766, 478], [712, 500]] },
        // NEAR-SHORE stands flanking the tee, closing the ring of forest around
        // the whole tarn (owner: "surrounded by trees ... all the way up to the
        // lake"). Clear of the tee-shot line up the middle.
        { type: 'trees', spacing: 30, visualSpacing: 20, treeR: 30, polygon: [[292, 720], [250, 800], [232, 884], [156, 876], [150, 752], [214, 700]] },
        { type: 'trees', spacing: 30, visualSpacing: 20, treeR: 30, polygon: [[688, 720], [730, 800], [748, 884], [824, 876], [830, 752], [766, 700]] },
        // The green is PINCHED both sides by sand now (owner: "something to make
        // the hole harder ... bunkers that come into play"): a deep pot short-
        // left AND a greenside pot right, so a bail either way off the water
        // finds sand, not safety.
        { type: 'bunker', depthMul: 1.4, polygon: blob(406, 486, 16, 12, 9, 0.3, 121) },
        { type: 'bunker', depthMul: 1.4, polygon: blob(546, 466, 15, 11, 9, 0.3, 122) }
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
      tee: [400, 1250],
      teeBox: { w: 32, d: 24 },
      green: { cx: 840, cy: 356, rx: 62, ry: 46, rot: -0.35 },
      slope: { angle: 2.7, strength: 0.32 },
      fairways: [
        // RIGHT fairway (MAIN, safe + longer): a wide arc up the right; ~300
        // off the tee leaves ~250 in with a clean, dry look at the green.
        { centerline: [[492, 1236], [660, 1030], [790, 850], [856, 700]], width: [54, 74, 82, 70] },
        // LEFT fairway (ALT, hard + direct): tighter line straight up the
        // middle-left; ~300 leaves ~200 — but over the pond and past the tree.
        { centerline: [[440, 1236], [512, 1008], [594, 796], [642, 664]], width: [46, 54, 58, 50] }
      ],
      // The LEFT fairway is the alternate route — exclude it from yardage.
      altFairways: 1,
      hazards: [
        // THE DENSE DIVIDER — a heavy block of trees BETWEEN the two fairways
        // (owner). Held clear of both corridors; a drive that leaks toward the
        // middle from either side finds the woods.
        { type: 'trees', spacing: 28, visualSpacing: 18, polygon: [[648, 860], [634, 762], [678, 652], [748, 656], [770, 762], [738, 862]] },
        // THE TREE IN THE WAY — a lone giant spruce standing in the LEFT
        // approach line: a straight go-for-the-green hits it, so the aggressor
        // must work the ball around it (owner).
        { type: 'trees', spacing: 22, visualSpacing: 14, treeR: 30, polygon: [[696, 586], [710, 538], [732, 552], [726, 582], [704, 594]] },
        // GREENSIDE GUARDIAN — short-right of the green.
        { type: 'trees', spacing: 30, visualSpacing: 20, treeR: 30, polygon: [[900, 452], [956, 436], [968, 378], [922, 350], [882, 404]] },
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
        // THE POND — sits right in front of the green. The LEFT approach must
        // carry it; the RIGHT approach comes in from straight below and stays
        // dry (owner).
        { type: 'water', polygon: [[708, 452], [732, 426], [768, 434], [786, 458], [772, 484], [734, 490], [710, 472]] },
        // Sand: a lone fairway bunker guarding the right's landing (the only
        // teeth on the safe route), a greenside pot right, and a back trap.
        { type: 'bunker', polygon: blob(884, 802, 22, 15, 10, 0.35, 131) },
        { type: 'bunker', depthMul: 1.4, polygon: blob(906, 420, 15, 12, 9, 0.3, 132) },
        { type: 'bunker', depthMul: 1.5, polygon: blob(884, 278, 19, 13, 9, 0.3, 133) }
      ],
      aiTargets: [[560, 1080], [720, 940], [808, 802], [846, 556], [842, 428]],
      landforms: [
        granite(908, 296, 12, 'rock_granite_b'), granite(300, 700, 10, 'rock_granite_c'),
        granite(772, 900, 11, 'rock_granite_a')
      ],
      elevation: [
        // ELEVATED TEE, then the land FALLS into a valley, then CLIMBS to the
        // green benched on the mountainside.
        { x: 400, y: 1250, h: 18, r: 140, shape: 'plateau', skirt: 0.5 },
        { x: 520, y: 1020, h: 8, r: 160 }, // first fall
        { x: 700, y: 820, h: 3, r: 160 }, // valley floor (go-for-it zone)
        { x: 840, y: 356, h: 16, r: 160, shape: 'plateau', skirt: 0.55 }, // green climb
        // Steep forested valley walls both sides.
        { x: 200, y: 1120, x2: 220, y2: 640, h: 32, r: 110 },
        { x: 1000, y: 900, x2: 980, y2: 500, h: 34, r: 130 },
        { x: 660, y: 600, h: 10, r: 140 } // rising ground behind the fall
      ]
    }
  ]
};

export { timberlineV2 };
