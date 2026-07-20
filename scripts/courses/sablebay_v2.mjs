// SABLE BAY v2 — full teardown/rebuild (owner directive: everything new; keep
// the FEATURE not the hole). Emitted to src/data/courses/v2/sablebay.json,
// dev-only behind `courseRebuilds`. No legacy geometry copied.
//
// COURSE IDENTITY (features that MUST recur):
//   - an ISLAND GREEN (h2) — green ringed by beach + water, bridge out;
//   - FAIRWAY BUNKERS genuinely in the drive zone (h1, h3) setting the
//     tee-shot placement question;
//   - premier coastal: the SEA is the edge (no inland walls), ocean carries,
//     coastal terraces stepping to the water, palms + shore rock.
import { blob } from '../courselib.mjs';

const sablebayV2 = {
  name: 'Sable Bay',
  version: 2,
  theme: {
    skyTop: '#4f9fd8', skyBottom: '#dceff3', sunX: 520, sunY: 120,
    fairway: '#3f9150', fairwayDark: '#357c44',
    rough: '#5a8a4a', roughDark: '#487038',
    fringe: '#5aa257', green: '#46974e', greenLight: '#5fb063',
    sand: '#ecdcac', sandDark: '#cdb884',
    water: '#2f86b8', waterDeep: '#1c5a84', waterReflect: true,
    treeCanopy: '#2f6a44', treeCanopyLight: '#3f7e52', treeTrunk: '#6b5238',
    haze: '#dceff3', hazeStrength: 0.42, horizonTint: '#bfe0ea',
    backdrop: 'sea', seaDunes: false, blossomChance: 0,
    // Coastal species: wind-shaped pines + palm accents on the shoreline,
    // shore-rock scatter (the sea is the scenery, trees are sparse).
    treeKeys: ['tree_pine_k3'], accentTreeKeys: ['tree_palm', 'tree_palm_b'],
    scatterKeys: ['stone_a', 'stone_b', 'stone_d'],
    tuftDensity: 0.9, roughTuftHeight: 1.0,
    lushGrass: true, grassKeys: ['grass_c', 'grass_d', 'grass_e'],
    tallGrass: { cap: 4.0, density: 4.0 },
    sandPlantKeys: ['bush_juniper', 'grass_d'], sandPlantStep: 80, sandPlantKeep: 0.4,
    edgeWobble: 3.0, mowPattern: 'straight', mowWidth: 28,
    greenColumns: true, greenMowPattern: 'straight',
    cloudStyle: 'wispy', atmosphere: 'coastal'
  },
  holes: [
    // ============================================== h1 "The Strand" par 4
    // Plays along the bay (water down the LEFT the whole way). Two staggered
    // FAIRWAY BUNKERS in the drive zone set the question: the aggressive line
    // hugs the water left past the near bunker for the open approach; the
    // safe line stays right, blocked from the far bunker and a longer shot in.
    {
      number: 1,
      name: 'The Strand',
      par: 4,
      world: { width: 1000, height: 1240 },
      tee: [660, 1150],
      teeBox: { w: 30, d: 22 },
      green: { cx: 430, cy: 380, rx: 60, ry: 46, rot: 0.3 },
      slope: { angle: 3.4, strength: 0.3 },
      centerline: [[660, 1120], [652, 1000], [636, 870], [604, 740], [548, 600], [480, 470], [440, 410]],
      width: [42, 60, 82, 84, 74, 60, 50],
      hazards: [
        // The bay owns the whole left edge — the sea is the boundary.
        { type: 'water', polygon: [[40, 200], [300, 210], [360, 340], [372, 520], [408, 660], [372, 800], [300, 940], [180, 1040], [40, 1060]] },
        // FAIRWAY BUNKERS in the drive zone (the kept feature) — staggered:
        // the near one (right-center) catches the safe drive short; the far
        // one (left, near the water) guards the aggressive line's landing.
        { type: 'bunker', polygon: blob(600, 800, 26, 19, 10, 0.35, 211) },
        { type: 'bunker', polygon: blob(520, 700, 28, 20, 10, 0.35, 212) },
        // Greenside sand front-right (the safe miss); water short-left.
        { type: 'bunker', depthMul: 1.3, polygon: blob(500, 420, 22, 16, 9, 0.3, 213) },
        // Wind-shaped pine stand inland-right; shoreline palms mark the green.
        { type: 'trees', spacing: 58, visualSpacing: 30, keepGround: true, polygon: [[760, 1000], [860, 900], [880, 680], [820, 520], [740, 640], [740, 880]] },
        { type: 'trees', accent: true, keepGround: true, treeR: 20, palm: true, polygon: blob(500, 348, 18, 18, 4, 0.2, 214) },
        { type: 'trees', accent: true, keepGround: true, treeR: 18, palm: true, polygon: blob(360, 440, 16, 16, 4, 0.2, 215) }
      ],
      aiTargets: [[620, 820], [520, 560], [430, 420]],
      elevation: [
        { x: 660, y: 1150, h: 2.4, r: 130, shape: 'plateau' },
        // Coastal terraces stepping DOWN to the water on the left.
        { x: 700, y: 880, x2: 760, y2: 520, h: 4.2, r: 150 }, // inland dune ridge (right)
        { x: 560, y: 640, h: 1.6, r: 150 },
        { x: 430, y: 380, h: 1.0, r: 130, shape: 'plateau', skirt: 0.5 }, // low green by the sea
        { x: 300, y: 620, h: -1.2, r: 170 } // land sheds into the bay
      ]
    },
    // ============================================== h2 "The Island" par 3
    // The identity hole: a TRUE island green — green ringed by beach sand,
    // the bay all around, a footbridge out, palms marking it, sailboats
    // behind. All carry, the wind is the hole. (Engine note: the moat is
    // four overlapping water bands so the beach ring reads as sand, not
    // water — surfaceAt ranks water above beach.)
    {
      number: 2,
      name: 'The Island',
      par: 3,
      world: { width: 900, height: 1000 },
      tee: [450, 800],
      teeBox: { w: 30, d: 22 },
      green: { cx: 450, cy: 430, rx: 54, ry: 44, rot: 0.2 },
      slope: { angle: 4.6, strength: 0.28 },
      centerline: [[450, 786], [450, 764]],
      width: [40, 40],
      hazards: [
        { type: 'water', polygon: [[150, 240], [260, 196], [380, 172], [520, 170], [650, 198], [742, 240], [742, 330], [150, 330]] },
        { type: 'water', polygon: [[150, 532], [742, 532], [728, 616], [610, 660], [470, 678], [320, 664], [200, 622], [160, 580]] },
        { type: 'water', polygon: [[150, 240], [352, 240], [352, 600], [160, 600], [126, 500], [122, 400], [134, 320]] },
        { type: 'water', polygon: [[548, 240], [742, 240], [756, 340], [760, 440], [744, 540], [548, 600]] },
        // Oversized beach ring overlaps the moat bands for a seamless shore.
        { type: 'bunker', beach: true, polygon: blob(450, 430, 108, 108, 16, 0.1, 221) },
        // Two pots cut into the ring (front-left, back-right) so only the
        // middle is stress-free.
        { type: 'bunker', polygon: blob(398, 476, 16, 12, 8, 0.3, 222) },
        { type: 'bunker', polygon: blob(502, 388, 15, 12, 8, 0.3, 223) },
        { type: 'trees', accent: true, keepGround: true, treeR: 20, palm: true, polygon: blob(392, 392, 16, 16, 4, 0.2, 224) },
        { type: 'trees', accent: true, keepGround: true, treeR: 17, palm: true, polygon: blob(512, 470, 14, 14, 4, 0.2, 225) }
      ],
      aiTargets: [],
      recoveryZones: [[[380, 700], [520, 700], [520, 780], [380, 780]]],
      sailboats: 3,
      props: [{ key: 'bridge', x: 450, y: 610, rot: 1.5708, len: 130 }],
      elevation: [
        { x: 450, y: 810, h: 2.6, r: 130, shape: 'plateau' },
        { x: 450, y: 430, h: 0.9, r: 150, shape: 'plateau', skirt: 0.72 }
      ]
    },
    // ============================================= h3 "Cape Reach" par 5
    // The closing cape: the drive plays out along a headland with a FAIRWAY
    // BUNKER cluster pinching the landing, then the hole bends toward the
    // ocean and the second-shot question — carry the cove corner to reach in
    // two, or lay up right and wedge to a green perched above the beach.
    {
      number: 3,
      name: 'Cape Reach',
      par: 5,
      world: { width: 1240, height: 1560 },
      tee: [340, 1470],
      teeBox: { w: 32, d: 24 },
      green: { cx: 840, cy: 360, rx: 84, ry: 58, rot: -0.3 },
      slope: { angle: 3.4, strength: 0.32 },
      fairways: [
        { centerline: [[340, 1440], [372, 1300], [470, 1180], [610, 1096]], width: [44, 76, 92, 88] },
        { centerline: [[610, 1096], [720, 980], [772, 820], [764, 680]], width: [88, 82, 74, 66] },
        { centerline: [[764, 680], [780, 540], [816, 440], [844, 388]], width: [66, 60, 54, 48] }
      ],
      hazards: [
        // The ocean west + the cove that cuts the reach-in-two line.
        { type: 'water', polygon: [[40, 900], [260, 920], [320, 1040], [300, 1200], [240, 1340], [60, 1360], [40, 1200]] },
        { type: 'water', polygon: [[560, 560], [700, 560], [720, 640], [660, 720], [560, 700], [520, 620]] },
        // Beach under the headland green.
        { type: 'bunker', beach: true, polygon: [[700, 420], [760, 470], [740, 560], [640, 560], [660, 440]] },
        // FAIRWAY BUNKER cluster pinching the drive landing (kept feature).
        { type: 'bunker', polygon: blob(500, 1180, 26, 18, 10, 0.35, 231) },
        { type: 'bunker', polygon: blob(560, 1120, 24, 17, 10, 0.35, 232) },
        // Lay-up pot guarding the safe bail right of the cove.
        { type: 'bunker', polygon: blob(812, 620, 22, 16, 9, 0.3, 233) },
        // Clean back-right greenside bunker; front open for the runner.
        { type: 'bunker', depthMul: 1.3, polygon: blob(900, 320, 24, 17, 9, 0.3, 234) },
        // Wind-shaped pines inland; palms pacing the cape.
        { type: 'trees', spacing: 58, visualSpacing: 30, keepGround: true, polygon: [[420, 1180], [520, 1080], [540, 940], [470, 860], [380, 960], [370, 1100]] },
        { type: 'trees', accent: true, keepGround: true, treeR: 20, palm: true, polygon: blob(690, 940, 16, 16, 4, 0.2, 235) },
        { type: 'trees', accent: true, keepGround: true, treeR: 18, palm: true, polygon: blob(900, 300, 16, 16, 4, 0.2, 236) }
      ],
      aiTargets: [[470, 1200], [700, 1000], [772, 720], [830, 430]],
      sailboats: 2,
      elevation: [
        { x: 340, y: 1470, h: 3.0, r: 150, shape: 'plateau' },
        // Clifftop terraces stepping along the headland to the green.
        { x: 440, y: 1220, h: 2.2, r: 190, shape: 'plateau', skirt: 0.4 },
        { x: 740, y: 800, h: 1.6, r: 180, shape: 'plateau', skirt: 0.4 },
        { x: 840, y: 360, h: 1.2, r: 150, shape: 'plateau', skirt: 0.5 },
        // Inland dune spine framing the right of the whole route.
        { x: 1020, y: 1150, x2: 1000, y2: 520, h: 4.6, r: 170 },
        { x: 260, y: 1120, h: -1.2, r: 150 }, // sheds to the ocean
        { x: 600, y: 640, h: -1.0, r: 120 } // the cove hollow
      ]
    }
  ]
};

export { sablebayV2 };
