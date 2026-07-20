// TIMBERLINE v2 — full teardown/rebuild (dev-environment roadmap, owner
// directive 2026-07-20: "everything new; keep the FEATURE, not the hole").
// Emitted to src/data/courses/v2/timberline.json, loaded only behind
// `courseRebuilds` (dev). Nothing is copied from the shipped course — these
// are three all-new holes.
//
// COURSE IDENTITY (the features that MUST recur, per the owner + Bible):
//   - trees GUARD the greens (a stand or specimen at the green complex);
//   - doglegs bend AROUND tree stands (the trees, not sand, set the line);
//   - high-alpine: benched mountainside terrain, GRANITE outcrops (stone_d/
//     e/f landforms + a collidable boulder), a cold tarn, conifer walls that
//     ARE the horizon.
import { blob } from '../courselib.mjs';

// Granite landform helper (render-only alpine outcrop).
const granite = (x, y, h, key = 'stone_e') => ({ key, x, y, h });

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
    backdrop: 'peaks', peakKeys: [], blossomChance: 0,
    // Asset change vs the original four-species mix: a true conifer wall
    // (spruce + two pines) with birch accents and a GRANITE scatter (the
    // alpine floor is stone, fern, and deadwood — not lush parkland turf).
    treeKeys: ['tree_spruce', 'tree_pine_k1'],
    accentTreeKeys: ['tree_birch', 'tree_birch_b'],
    scatterKeys: ['stone_d', 'stone_e', 'fern_kenney', 'stump_a', 'log_a'],
    backdropTreeStep: 46,
    tuftDensity: 1.1, roughTuftHeight: 1.15,
    lushGrass: true, grassKeys: ['grass_c', 'grass_d', 'grass_e'],
    edgeWobble: 2.4, mowPattern: 'cross', mowWidth: 26,
    greenColumns: true, greenMowPattern: 'cross',
    cloudStyle: 'wispy', atmosphere: 'alpine'
  },
  holes: [
    // ============================================ h1 "Granite Bend" par 4
    // Dogleg LEFT that bends around a granite-and-spruce point sitting in the
    // crook of the elbow. The trees — not sand — set the tee-shot question:
    // fly the left shoulder of the point to cut the corner and open the
    // green, or bail right up the safe fairway and face an approach blocked
    // by the greenside spruce guardian. A collidable granite boulder anchors
    // the point.
    {
      number: 1,
      name: 'Granite Bend',
      par: 4,
      world: { width: 1040, height: 1200 },
      tee: [740, 1110],
      teeBox: { w: 30, d: 22 },
      green: { cx: 360, cy: 420, rx: 58, ry: 44, rot: 0.4 },
      slope: { angle: 2.3, strength: 0.3 },
      // A SHARP dogleg LEFT: the drive runs straight up the far-right edge to
      // a corner landing (~730,650), then the hole bends hard left to the
      // green. The direct tee→green diagonal runs far left of the drive
      // fairway — a wide gap where the forcing tree point lives without ever
      // touching the corridor.
      centerline: [[740, 1080], [738, 940], [732, 800], [724, 672], [592, 566], [452, 470], [380, 438]],
      width: [42, 58, 82, 82, 74, 58, 48],
      hazards: [
        // THE POINT — a spruce stand on a granite shoulder, in the gap
        // between the drive fairway (far right) and the direct tee→green line
        // (left). It blocks the greedy cut straight at the green; lay up to
        // the corner right of it, or carry its crown to shortcut the dogleg.
        { type: 'trees', spacing: 34, visualSpacing: 22, polygon: [[512, 700], [548, 606], [512, 522], [430, 540], [420, 636], [456, 706]] },
        // Collidable granite boulder at the point's tip.
        { type: 'rock', cx: 470, cy: 686, r: 15, height: 15, key: 'stone_e', polygon: blob(470, 686, 15, 15, 8, 0, 1) },
        // Right treeline wall the whole length (the safe side is still walled).
        { type: 'trees', spacing: 40, visualSpacing: 24, polygon: [[832, 1080], [900, 900], [906, 640], [852, 520], [792, 640], [806, 900]] },
        // Left treeline down the outside of the dogleg.
        { type: 'trees', spacing: 42, visualSpacing: 26, polygon: [[250, 900], [340, 820], [360, 640], [300, 520], [206, 600], [198, 820]] },
        // GREENSIDE GUARDIAN — a spruce cluster front-LEFT of the green
        // (trees guard the green): it frames and defends the left pin and the
        // pull, while the approach from the drive zone stays open down the
        // right. Left-pin days you must flirt it; right-pin days it looms.
        { type: 'trees', spacing: 36, visualSpacing: 22, polygon: [[248, 486], [320, 470], [336, 398], [276, 376], [236, 430]] },
        // Greenside sand front-RIGHT — the pushed approach catches it; the
        // green is thus pinched between trees (left) and sand (right).
        { type: 'bunker', depthMul: 1.35, polygon: blob(438, 470, 19, 14, 9, 0.3, 111) }
      ],
      aiTargets: [[730, 700], [560, 560], [360, 470]],
      landforms: [granite(576, 620, 8, 'stone_e'), granite(430, 660, 6, 'stone_d'), granite(316, 350, 8, 'stone_f'), granite(250, 560, 6, 'stone_d')],
      elevation: [
        { x: 740, y: 1110, h: 2.0, r: 130, shape: 'plateau' },
        // High forested shoulder on the right, fairway benched below it.
        { x: 900, y: 880, x2: 906, y2: 540, h: 10, r: 150 },
        { x: 520, y: 600, h: 5, r: 110 }, // the granite point rises
        { x: 720, y: 900, h: 3, r: 140 },
        { x: 620, y: 600, h: 2.2, r: 120 }, // corner landing bench
        // Green terrace benched into the slope, flat top over the whole green.
        { x: 360, y: 420, h: 3.0, r: 150, shape: 'plateau', skirt: 0.55 },
        { x: 250, y: 460, x2: 250, y2: 340, h: 7, r: 130 }, // left backdrop rise
        { x: 400, y: 1060, h: 2.2, r: 120 }
      ]
    },
    // ================================================= h2 "The Tarn" par 3
    // Carry a cold alpine tarn to a shelf green PINCHED between two spruce
    // stands — trees guard the green on both flanks, so the shot must be
    // both long enough (water) and straight enough (trees). A granite bluff
    // stands behind. Bail short-right to a chipping bench (recovery zone).
    {
      number: 2,
      name: 'The Tarn',
      par: 3,
      world: { width: 940, height: 900 },
      tee: [470, 780],
      teeBox: { w: 30, d: 22 },
      green: { cx: 470, cy: 430, rx: 54, ry: 40, rot: 0 },
      slope: { angle: 1.8, strength: 0.3 },
      centerline: [[470, 766], [470, 744]],
      width: [40, 40],
      hazards: [
        // The tarn — the whole front carry.
        { type: 'water', polygon: [[300, 560], [470, 540], [640, 562], [676, 632], [640, 700], [470, 724], [300, 706], [268, 634]] },
        // LEFT guardian spruce stand at the green.
        { type: 'trees', spacing: 34, visualSpacing: 22, polygon: [[318, 500], [400, 470], [418, 370], [360, 320], [280, 380], [278, 460]] },
        // RIGHT guardian spruce stand at the green.
        { type: 'trees', spacing: 34, visualSpacing: 22, polygon: [[622, 500], [700, 470], [712, 360], [648, 322], [572, 380], [582, 468]] },
        // A single deep pot short-left, between tarn and green, for the pull.
        { type: 'bunker', depthMul: 1.4, polygon: blob(408, 500, 16, 12, 9, 0.3, 121) }
      ],
      aiTargets: [],
      landforms: [granite(470, 300, 12, 'stone_f'), granite(408, 316, 8, 'stone_e'), granite(536, 312, 8, 'stone_d')],
      elevation: [
        { x: 470, y: 800, h: 2.6, r: 120, shape: 'plateau' },
        // Green shelf: a flat pad just above the tarn, granite bluff behind.
        { x: 470, y: 430, h: 2.0, r: 130, shape: 'plateau', skirt: 0.55 },
        { x: 470, y: 300, x2: 470, y2: 240, h: 9, r: 140 }, // granite bluff wall
        { x: 300, y: 420, h: 5, r: 120 },
        { x: 640, y: 420, h: 5, r: 120 },
        { x: 470, y: 640, h: -1.4, r: 150 } // the tarn basin
      ]
    },
    // ============================================== h3 "Timberfall" par 5
    // A forest S: dogleg RIGHT off the tee around a spruce nose, then dogleg
    // LEFT down a falling avenue to a green set on a shelf and GUARDED by a
    // lone giant spruce short-right. Two tree corners, one downhill finish —
    // the trees set both bends. A granite scree field flanks the second turn.
    {
      number: 3,
      name: 'Timberfall',
      par: 5,
      world: { width: 1260, height: 1680 },
      tee: [360, 1560],
      teeBox: { w: 32, d: 24 },
      green: { cx: 880, cy: 360, rx: 62, ry: 46, rot: -0.35 },
      slope: { angle: 2.7, strength: 0.32 },
      fairways: [
        { centerline: [[360, 1530], [372, 1400], [430, 1270], [560, 1180]], width: [46, 60, 84, 86] },
        { centerline: [[560, 1180], [700, 1120], [790, 1000], [800, 860]], width: [86, 82, 74, 70] },
        { centerline: [[800, 860], [770, 700], [800, 540], [872, 432]], width: [70, 66, 60, 52] }
      ],
      hazards: [
        // FIRST BEND: a spruce nose on the inside-left of the tee shot forces
        // the drive right.
        { type: 'trees', spacing: 36, visualSpacing: 24, polygon: [[300, 1400], [430, 1340], [470, 1200], [400, 1140], [280, 1220], [270, 1340]] },
        // SECOND BEND: a big stand on the inside-right forces the second shot
        // back left, down the avenue.
        { type: 'trees', spacing: 34, visualSpacing: 22, polygon: [[860, 1080], [980, 1020], [1000, 860], [930, 760], [820, 840], [810, 1000]] },
        // GREENSIDE GUARDIAN — the lone giant spruce short-right of the green.
        { type: 'trees', spacing: 30, visualSpacing: 20, treeR: 30, polygon: [[928, 470], [986, 452], [1000, 388], [956, 360], [912, 418]] },
        // Left avenue wall.
        { type: 'trees', spacing: 42, visualSpacing: 26, polygon: [[560, 1080], [660, 1000], [700, 800], [660, 620], [560, 700], [540, 940]] },
        // Granite scree flanking the second turn — a collidable boulder in
        // the layup zone the greedy line flirts with.
        { type: 'rock', cx: 792, cy: 900, r: 18, height: 18, key: 'stone_f', polygon: blob(792, 900, 18, 18, 8, 0, 1) },
        // Sand: a cross bunker at the first landing's outside, and one deep
        // greenside pot front-left (the guardian owns the right).
        { type: 'bunker', polygon: blob(470, 1250, 26, 18, 10, 0.35, 131) },
        { type: 'bunker', depthMul: 1.4, polygon: blob(816, 402, 18, 14, 9, 0.3, 132) }
      ],
      aiTargets: [[452, 1300], [640, 1150], [796, 940], [800, 560], [872, 440]],
      landforms: [
        granite(870, 880, 9, 'stone_f'), granite(740, 820, 7, 'stone_d'),
        granite(940, 300, 8, 'stone_e'), granite(320, 1240, 7, 'stone_d')
      ],
      elevation: [
        { x: 360, y: 1560, h: 2.6, r: 130, shape: 'plateau' },
        // The land FALLS from tee to green (timber-fall): a high shoulder at
        // the start, benches stepping down through the two turns.
        { x: 420, y: 1360, h: 5, r: 170 },
        { x: 620, y: 1160, h: 3.6, r: 170 },
        { x: 800, y: 900, h: 2.2, r: 160 },
        // Green shelf low at the finish, flat over the whole green.
        { x: 880, y: 360, h: 1.6, r: 150, shape: 'plateau', skirt: 0.55 },
        // Forested valley walls both sides.
        { x: 230, y: 1300, x2: 300, y2: 760, h: 8, r: 150 },
        { x: 1080, y: 1000, x2: 1060, y2: 520, h: 9, r: 160 },
        { x: 700, y: 640, h: -1.4, r: 150 }
      ]
    }
  ]
};

export { timberlineV2 };
