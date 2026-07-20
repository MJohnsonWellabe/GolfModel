// TIMBERLINE WEST — a NEW dev course built from the PRODUCTION Timberline
// routing (Pine Alley / The Hollow / The Gauntlet), rebuilt to the "Timberline
// East" presentation + terrain standard. Emitted to
// src/data/courses/v2/timberlinewest.json, dev-only behind `courseRebuilds`.
//
// RELATION TO EAST: same visual language (alpine sky + peaks, granite/obsidian
// rock, reflective water, v2 authored elevation + benched, contoured greens),
// but DIFFERENT routing and strategy — West keeps production's tree-corridor
// par 4, tree-ringed hollow par 3, and dogleg-right "gauntlet" par 5, where
// East is a granite dogleg / downhill tarn / two-route par 5. Production
// timberline.json is untouched (this is a separate id + file).
//
// Vertical unit ≈ 1.5 ft, so h:20 ≈ 30 ft.
import { blob, stream } from '../courselib.mjs';

// Granite landform helper (render-only alpine outcrop) — the East rock language.
const granite = (x, y, h, key = 'rock_granite_b') => ({ key, x, y, h });

const timberlineWestV2 = {
  name: 'Timberline West',
  version: 2,
  theme: {
    skyTop: '#5f86a8', skyBottom: '#cfe0e6', sunX: 460, sunY: 150,
    fairway: '#3f7f46', fairwayDark: '#356b3c',
    rough: '#4a6b41', roughDark: '#3a5533',
    fringe: '#54924e', green: '#438a47', greenLight: '#5aa25c',
    sand: '#d8cba0', sandDark: '#b3a072',
    // Production Timberline water look (softer 0.62 fresnel default, no strength
    // override) — brighter cerulean body, reflection that doesn't blow out.
    water: '#2f83c0', waterDeep: '#1d5488', waterReflect: true,
    treeCanopy: '#2f5738', treeCanopyLight: '#3d6a44', treeTrunk: '#5b4632',
    haze: '#cfe0e6', hazeStrength: 0.5, horizonTint: '#bcd2da',
    backdrop: 'peaks', peakKeys: ['mountain_range_alpine'], blossomChance: 0,
    treeKeys: ['tree_birch', 'tree_aspen', 'tree_poplar', 'tree_oak'],
    accentTreeKeys: ['tree_birch_b', 'tree_maple'],
    bushKeys: [],
    heatherKeys: ['heather_purple', 'heather_purple', 'heather_fescue_a', 'heather_purple'],
    tallGrass: { cap: 5, density: 5 },
    prairieClusters: true,
    scatterKeys: ['rock_granite_a', 'rock_granite_b', 'rock_granite_c'],
    backdropTreeStep: 40,
    tuftDensity: 1.1, roughTuftHeight: 1.15,
    lushGrass: true, grassKeys: ['grass_g', 'grass_h'],
    edgeWobble: 2.4, mowPattern: 'cross', mowWidth: 26,
    greenColumns: true, greenMowPattern: 'cross',
    cloudStyle: 'wispy', atmosphere: 'alpine'
  },
  holes: [
    // ============================================ h1 "Pine Alley" par 4
    // The production namesake: a tree-corridor drive up a straight alley that
    // then bends LEFT to a green benched into the upper-left mountainside. West
    // modernizes it — an elevated tee playing downhill into the alley, a
    // granite scree wall lining the right treeline, a reflective pond guarding a
    // bail-out right off the approach, and a benched, gently tiered green.
    {
      number: 1,
      name: 'Pine Alley',
      par: 4,
      world: { width: 900, height: 1200 },
      tee: [450, 1080],
      teeBox: { w: 30, d: 22 },
      green: { cx: 300, cy: 330, rx: 60, ry: 46, rot: -0.3 },
      slope: { angle: 1.8, strength: 0.3 },
      centerline: [[450, 1050], [452, 860], [446, 690], [418, 560], [356, 440], [312, 368]],
      width: [40, 58, 78, 74, 60, 48],
      hazards: [
        // LEFT alley wall — spruce/broadleaf down the whole left of the drive,
        // bending with the dogleg to wall the green's left.
        { type: 'trees', spacing: 40, visualSpacing: 24, polygon: [[408, 1104], [400, 860], [384, 640], [352, 470], [300, 384], [244, 430], [258, 700], [292, 980], [350, 1116]] },
        // RIGHT alley wall — the other side of the corridor.
        { type: 'trees', spacing: 40, visualSpacing: 24, polygon: [[492, 1104], [500, 860], [514, 648], [500, 486], [560, 452], [612, 700], [586, 1000], [522, 1124]] },
        // GRANITE SCREE lining the right treeline base (East rock language) — a
        // drive leaked right caroms off real rock. Clear of the drive corridor.
        { type: 'rock', cx: 548, cy: 900, r: 22, height: 26, key: 'rock_granite_b', polygon: blob(548, 900, 22, 22, 8, 0, 41) },
        { type: 'rock', cx: 556, cy: 820, r: 20, height: 24, key: 'rock_granite_a', polygon: blob(556, 820, 20, 20, 8, 0, 42) },
        { type: 'rock', cx: 560, cy: 738, r: 24, height: 28, key: 'rock_granite_c', polygon: blob(560, 738, 24, 24, 8, 0, 43) },
        { type: 'rock', cx: 556, cy: 656, r: 19, height: 22, key: 'rock_granite_b', polygon: blob(556, 656, 19, 19, 8, 0, 44) },
        // THE CREEK ACROSS THE FAIRWAY — a production Pine Alley staple (owner:
        // "what happened to the creek running across the fairway"): a stream that
        // cuts diagonally across the corridor between the drive zone and the
        // green, so the approach is a forced carry. Sits in a level channel (see
        // elevation). Runs off both sides into the treelines.
        { type: 'water', polygon: stream([[306, 632], [382, 600], [452, 566], [524, 534], [592, 508]], 28, 811) },
        // THE FAIRWAY TREE — a lone spruce standing in the corridor (production
        // staple: "the fairway tree you had to avoid"). Right-center of the
        // fairway just past the creek, so the drive/approach must work around it.
        { type: 'trees', spacing: 20, visualSpacing: 13, treeR: 27, polygon: [[452, 672], [468, 654], [486, 670], [478, 692], [456, 690]] },
        // GREENSIDE SAND — front-right of the benched green (the safe miss short).
        { type: 'bunker', depthMul: 1.3, polygon: blob(356, 398, 18, 13, 9, 0.3, 141) },
        // BACKDROP WOODS on the mountainside behind the green.
        { type: 'trees', spacing: 40, visualSpacing: 24, polygon: [[236, 320], [300, 262], [382, 280], [360, 190], [258, 200], [204, 262]] }
      ],
      aiTargets: [[452, 790], [372, 470], [300, 362]],
      landforms: [
        granite(600, 640, 12, 'rock_granite_a'), granite(212, 460, 10, 'rock_granite_c'),
        granite(250, 240, 12, 'rock_granite_b'), granite(640, 900, 11, 'rock_granite_a')
      ],
      elevation: [
        // ELEVATED TEE on a shoulder; the drive plays downhill into the alley.
        { x: 450, y: 1080, h: 12, r: 130, shape: 'plateau', skirt: 0.42 },
        { x: 450, y: 820, h: 6, r: 150 },        // drive-zone bench (downhill)
        // BENCHED, gently TIERED green on the upper-left mountainside — a wide
        // flat pad (puttable) with a subtle back tier summed on top.
        { x: 300, y: 330, h: 13, r: 165, shape: 'plateau', skirt: 0.6 },
        { x: 276, y: 296, h: 1.4, r: 96, shape: 'plateau', skirt: 0.5 }, // gentle back tier (wide, puttable)
        // CREEK CHANNEL — a level trough (2 units down) along the fairway-crossing
        // creek so the water reads flat; runs off into the treelines both sides.
        { x: 306, y: 632, x2: 382, y2: 600, h: -2, r: 26, shape: 'plateau', skirt: 0.5 },
        { x: 382, y: 600, x2: 452, y2: 566, h: -2, r: 26, shape: 'plateau', skirt: 0.5 },
        { x: 452, y: 566, x2: 524, y2: 534, h: -2, r: 26, shape: 'plateau', skirt: 0.5 },
        { x: 524, y: 534, x2: 592, y2: 508, h: -2, r: 26, shape: 'plateau', skirt: 0.5 },
        // Framing mountainsides both flanks + backdrop rise behind the green.
        { x: 150, y: 720, x2: 170, y2: 320, h: 30, r: 100 },
        { x: 760, y: 780, x2: 778, y2: 420, h: 28, r: 112 },
        { x: 228, y: 186, h: 20, r: 90 } // backdrop rise behind green — held clear of the putting surface
      ]
    },
    // ============================================= h2 "The Hollow" par 3
    // Production's pinpoint par 3: a small green cradled in a tree-ringed
    // HOLLOW, pincered by a front-left and back-right bunker with a lone
    // specimen tree short-left. West modernizes the hollow into REAL terrain —
    // the green sits low in a genuine bowl ringed by raised, forested rims — and
    // gives the small green a gentle tier plus granite on the rim.
    {
      number: 2,
      name: 'The Hollow',
      par: 3,
      world: { width: 900, height: 1000 },
      tee: [450, 730],
      teeBox: { w: 30, d: 22 },
      green: { cx: 452, cy: 430, rx: 42, ry: 32, rot: 0.4 },
      slope: { angle: 2.3, strength: 0.32 },
      centerline: [[450, 716], [450, 694]],
      width: [40, 40],
      hazards: [
        // The two pincer pots (front-left, back-right) that defend the small green.
        { type: 'bunker', depthMul: 1.4, polygon: blob(402, 470, 15, 12, 9, 0.3, 151) },
        { type: 'bunker', depthMul: 1.4, polygon: blob(502, 392, 15, 11, 9, 0.3, 152) },
        // LEFT + RIGHT tree horseshoes cradling the green — the ring of the hollow.
        { type: 'trees', spacing: 34, visualSpacing: 22, polygon: [[286, 468], [356, 438], [372, 548], [360, 708], [296, 762], [258, 598]] },
        { type: 'trees', spacing: 34, visualSpacing: 22, polygon: [[618, 468], [548, 438], [532, 548], [544, 708], [608, 762], [646, 598]] },
        // Backdrop stand behind the green closing the ring.
        { type: 'trees', spacing: 36, visualSpacing: 22, polygon: [[300, 306], [382, 270], [448, 288], [426, 198], [318, 208], [276, 268]] },
        // LONE SPECIMEN TREE short-left — the direct-line obstacle (production).
        { type: 'trees', spacing: 20, visualSpacing: 13, treeR: 26, polygon: [[414, 514], [428, 498], [442, 512], [436, 532], [418, 530]] }
      ],
      aiTargets: [],
      // Granite boulders on the hollow's rim (the alpine rock note).
      landforms: [
        granite(300, 380, 12, 'rock_granite_a'), granite(604, 380, 12, 'rock_granite_c'),
        granite(452, 224, 13, 'rock_granite_b')
      ],
      elevation: [
        // ELEVATED TEE ledge looking down into the hollow.
        { x: 450, y: 745, h: 14, r: 120, shape: 'plateau', skirt: 0.5 },
        // THE HOLLOW — the green sits on a modest pad set LOW; the surrounding
        // forested rim rises well above it, so the bowl reads as real terrain.
        { x: 452, y: 430, h: 3.5, r: 150, shape: 'plateau', skirt: 0.62 }, // low green pad (wide flat top, puttable)
        { x: 452, y: 410, h: 2, r: 70, shape: 'plateau', skirt: 0.32 },    // subtle back tier
        // THE RAISED, FORESTED RIM ringing the green (the hollow walls).
        { x: 300, y: 560, x2: 320, y2: 360, h: 22, r: 92 },
        { x: 604, y: 560, x2: 584, y2: 360, h: 22, r: 92 },
        { x: 400, y: 240, h: 26, r: 96 },
        { x: 452, y: 632, h: 10, r: 120 } // low ground between tee and hollow
      ]
    },
    // ============================================ h3 "The Gauntlet" par 5
    // Production's long dogleg-RIGHT three-shot gauntlet: a drive up the left,
    // a corner pond on the inside of the bend, a threaded lay-up past a lone
    // tree, and an approach to a large, steeply-sloped upper-right green guarded
    // by a wraparound bunker. West modernizes it — dramatic drop-and-climb
    // elevation, a granite talus on the outer dogleg, a reflective corner pond
    // in a level basin, and a contoured green.
    {
      number: 3,
      name: 'The Gauntlet',
      par: 5,
      world: { width: 1200, height: 1500 },
      tee: [360, 1420],
      teeBox: { w: 32, d: 24 },
      green: { cx: 858, cy: 560, rx: 80, ry: 56, rot: 0.5 },
      slope: { angle: 2.6, strength: 0.34 },
      centerline: [[360, 1390], [378, 1080], [400, 880], [540, 772], [700, 672], [830, 592]],
      width: [46, 72, 86, 80, 66, 56],
      hazards: [
        // CORNER POND — inside/left of the dogleg where the fairway bends right;
        // a pulled drive or a greedy corner-cut finds water. Reflective, level
        // basin (see elevation).
        { type: 'water', polygon: [[250, 808], [292, 780], [344, 788], [372, 826], [366, 872], [326, 900], [276, 892], [244, 854]] },
        // LEFT WOODS lining the fairway (owner: "woods down the left ... hugging
        // the fairway except for a break on the left where the pond cuts in").
        // Lower band hugs leg 1's left edge from the tee UP TO the corner pond,
        // then BREAKS (the pond is the gap)...
        { type: 'trees', spacing: 40, visualSpacing: 24, polygon: [[334, 958], [328, 1080], [320, 1392], [282, 1400], [280, 1080], [290, 958]] },
        // ...and resumes ABOVE the pond, hugging the top of leg 1 and the upper
        // (left) edge of leg 2 all the way to the green.
        { type: 'trees', spacing: 40, visualSpacing: 24, polygon: [[358, 838], [368, 760], [430, 712], [540, 690], [650, 632], [700, 604], [700, 566], [620, 600], [510, 650], [410, 684], [336, 730], [330, 834]] },
        // RIGHT WOODS — a continuous band hugging leg 1's right edge, then wrapping
        // the lower (right) side of leg 2 and the outside of the bend to the green.
        { type: 'trees', spacing: 40, visualSpacing: 24, polygon: [[416, 1400], [440, 1080], [474, 884], [566, 820], [694, 752], [788, 700], [828, 668], [896, 712], [1040, 764], [1070, 1000], [990, 1120], [830, 900], [630, 864], [480, 920], [462, 1120], [458, 1400]] },
        // LONE TREE in the second-shot lane — must be worked around on the lay-up.
        { type: 'trees', spacing: 22, visualSpacing: 14, treeR: 28, polygon: [[688, 726], [702, 706], [720, 722], [712, 748], [692, 744]] },
        // FRONT-OF-GREEN POND + CREEK (owner: "replace the original front of green
        // bunker with another pond and creek") — a pond ~70 yd short of the green
        // that the approach must carry (in a level basin), narrowing into a creek
        // that runs off the lower-right of the world.
        { type: 'water', polygon: [[746, 720], [780, 702], [812, 708], [830, 730], [820, 758], [788, 770], [754, 762], [738, 742]] },
        { type: 'water', polygon: stream([[818, 748], [846, 858], [858, 966], [852, 1074]], 24, 823) },
        // Behind/above-green woods on the mountainside.
        { type: 'trees', spacing: 42, visualSpacing: 26, polygon: [[770, 452], [864, 414], [980, 440], [1000, 372], [852, 348], [744, 402]] }
      ],
      aiTargets: [[378, 1090], [400, 890], [540, 772], [700, 672], [846, 576]],
      landforms: [
        granite(1000, 900, 13, 'rock_granite_b'), granite(150, 1000, 11, 'rock_granite_c'),
        granite(560, 980, 10, 'rock_granite_a'),
        // GRANITE TALUS on the OUTER dogleg (right of the bend) — a scree apron,
        // the East rock language, dense at the shoulder and thinning out.
        ...(() => {
          const out = [];
          const pts = [[600, 940, 12], [648, 908, 9], [590, 892, 7], [640, 860, 10], [688, 872, 6], [636, 820, 8], [690, 826, 5], [604, 848, 4], [664, 786, 6], [712, 812, 4]];
          for (const [x, y, h] of pts) out.push(granite(x, y, h, ['rock_granite_a', 'rock_granite_b', 'rock_granite_c'][(x + y) % 3]));
          return out;
        })()
      ],
      elevation: [
        // ELEVATED TEE, then a FALL into the valley corner, then a CLIMB to the
        // green benched high on the mountainside.
        { x: 360, y: 1410, h: 16, r: 140, shape: 'plateau', skirt: 0.5 },
        { x: 400, y: 1060, h: 7, r: 160 },       // first fall
        { x: 452, y: 850, h: 3, r: 150 },        // corner valley floor
        { x: 640, y: 700, h: 6, r: 150 },        // rising ground on the reach
        // BENCHED, CONTOURED green — wide flat pad (puttable) + a gentle summed
        // tier. Radius held to 138 so the skirt stays clear of the front pond
        // (level water) and the face stays chippable (~0.37 grade).
        { x: 858, y: 560, h: 13, r: 138, shape: 'plateau', skirt: 0.62 },
        { x: 884, y: 536, h: 1.5, r: 90, shape: 'plateau', skirt: 0.5 },
        // CORNER POND basin (level water) — wide flat top so the whole pond sits
        // level (its west edge used to ride the left valley wall).
        { x: 308, y: 840, h: -2, r: 90, shape: 'plateau', skirt: 0.72 },
        // FRONT-OF-GREEN POND basin (level water) + the creek channel, which runs
        // SOUTH (west of the right valley wall) off the bottom of the world.
        { x: 783, y: 732, h: -2, r: 82, shape: 'plateau', skirt: 0.66 },
        { x: 818, y: 748, x2: 846, y2: 858, h: -2, r: 24, shape: 'plateau', skirt: 0.5 },
        { x: 846, y: 858, x2: 858, y2: 966, h: -2, r: 24, shape: 'plateau', skirt: 0.5 },
        { x: 858, y: 966, x2: 852, y2: 1074, h: -2, r: 24, shape: 'plateau', skirt: 0.5 },
        // Steep forested valley walls both sides + backdrop behind the green.
        // Left wall radius trimmed so its skirt clears the corner pond.
        { x: 150, y: 1120, x2: 170, y2: 640, h: 32, r: 90 },
        { x: 1050, y: 1040, x2: 1030, y2: 560, h: 34, r: 122 },
        { x: 900, y: 430, h: 24, r: 104 }
      ]
    }
  ]
};

export { timberlineWestV2 };
