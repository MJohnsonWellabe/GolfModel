// SABLE BAY v2 — teardown/rebuild variant (dev-environment roadmap, owner
// directive 2026-07-20). Emitted to src/data/courses/v2/sablebay.json, loaded
// only behind `courseRebuilds` (dev). Production keeps the shipped original.
//
// KEEP (owner keep-list):
//   - h2 "The Island": the ISLAND GREEN idea — rebuilt as a TRUE island
//     (green ringed by beach sand, water all around, footbridge out).
//   - h1 "Tidewater": the FAIRWAY-BUNKER pattern that shapes the second
//     shot — the staggered right-side pair in the lay-up zone is mimicked
//     in place against the redrawn fairway.
// TEARDOWN (everything else): all-new routing, coastal-terrace terrain
// stepping down to the sea (the sea IS the edge — no inland walls), clean
// sculpted greenside sand, carry decisions per the Bible identity
// ("premier coastal golf: ocean wind, forced carries, precision").
import { readFileSync } from 'node:fs';
import { blob } from '../courselib.mjs';

const legacyTheme = JSON.parse(readFileSync('src/data/courses/sablebay.json', 'utf8')).theme;

const sablebayV2 = {
  name: 'Sable Bay',
  version: 2,
  theme: legacyTheme, // the premier-coastal look already matches the Bible
  holes: [
    // ------------------------------------------------- h1 "Tidewater" par 4
    // Coastal terraces step down to the bay on the left the whole way: tee
    // terrace, fairway bench, green low by the water. The KEPT right-side
    // bunker pair pinches the lay-up; a cove bites the fairway at the
    // aggressive second-shot line. Bail right into the dune ridge and the
    // angle in over sand gets worse — carry the cove line and the green
    // opens up.
    {
      number: 1,
      name: 'Tidewater',
      par: 4,
      world: { width: 900, height: 1200 },
      tee: [450, 1050],
      teeBox: { w: 30, d: 22 },
      green: { cx: 470, cy: 265, rx: 74, ry: 52, rot: 0.3 },
      slope: { angle: 4.2, strength: 0.3 },
      centerline: [[450, 1020], [452, 880], [470, 740], [492, 600], [488, 450], [476, 340]],
      width: [40, 66, 80, 72, 56, 44],
      hazards: [
        // The bay: one continuous water body owning the west edge, biting
        // into the approach as a cove at the aggressive line.
        {
          type: 'water',
          polygon: [
            [40, 180], [250, 190], [352, 240], [388, 320], [360, 420], [330, 520],
            [352, 620], [400, 660], [388, 720], [300, 760], [180, 780], [40, 800]
          ]
        },
        // Beach where the fairway shoulder meets the cove.
        { type: 'bunker', beach: true, polygon: [[300, 560], [420, 590], [414, 690], [290, 700]] },
        // KEPT PATTERN: the staggered right-side fairway pair at the lay-up
        // pinch (mimics the shipped Tidewater pair at ~505,560 / ~478,510).
        { type: 'bunker', polygon: blob(508, 562, 24, 17, 9, 0.35, 811) },
        { type: 'bunker', polygon: blob(480, 508, 20, 15, 9, 0.35, 812) },
        // One clean sculpted greenside bunker, short-right — the safe miss;
        // the water short-left is the brave miss.
        { type: 'bunker', polygon: blob(548, 322, 26, 18, 9, 0.3, 813) },
        // Sparse wind-shaped pines on the inland dune ridge; palm accents
        // at the green.
        {
          type: 'trees', spacing: 62, keepGround: true,
          polygon: [[640, 380], [780, 340], [840, 460], [820, 640], [720, 700], [650, 560]]
        },
        { type: 'trees', accent: true, keepGround: true, treeR: 22, palm: true, polygon: blob(568, 240, 20, 20, 4, 0.2, 814) },
        { type: 'trees', accent: true, keepGround: true, treeR: 18, palm: true, polygon: blob(540, 700, 18, 18, 4, 0.2, 815) }
      ],
      aiTargets: [[462, 760], [486, 520]],
      elevation: [
        // Three terraces stepping DOWN to the sea (the identity landform).
        { x: 450, y: 1050, h: 2.4, r: 140, shape: 'plateau' },
        { x: 470, y: 720, h: 1.6, r: 190, shape: 'plateau', skirt: 0.45 },
        { x: 470, y: 265, h: 0.8, r: 120, shape: 'plateau' },
        // The inland dune ridge the bail-out lives under.
        { x: 700, y: 900, x2: 760, y2: 420, h: 4.2, r: 150 },
        // The land rolls off into the bay.
        { x: 250, y: 480, h: -1.2, r: 160 },
        { x: 320, y: 720, h: -0.8, r: 130 }
      ]
    },
    // ------------------------------------------------ h2 "The Island" par 3
    // The KEPT idea, completed: a true island green. Beach sand rings the
    // green, the bay surrounds it, a footbridge walks out, palms mark it
    // from the tee. All carry — the wind is the hole.
    {
      number: 2,
      name: 'The Island',
      par: 3,
      world: { width: 900, height: 1000 },
      tee: [450, 780],
      teeBox: { w: 30, d: 22 },
      green: { cx: 450, cy: 430, rx: 52, ry: 42, rot: -0.3 },
      slope: { angle: 5.0, strength: 0.28 },
      centerline: [[450, 778], [450, 730]],
      width: [40, 36],
      hazards: [
        // The bay as a MOAT: four overlapping water bands ringing the island.
        // (One covering polygon can't work — surfaceAt ranks water above
        // beach sand, so an island drawn inside a single lake would classify
        // as water and the beach ring would never exist. The bands' union
        // surrounds the island without covering it.)
        { type: 'water', polygon: [[150, 240], [260, 196], [380, 172], [520, 170], [650, 198], [742, 240], [742, 330], [150, 330]] },
        { type: 'water', polygon: [[150, 532], [742, 532], [728, 616], [610, 660], [470, 678], [320, 664], [200, 622], [160, 580]] },
        { type: 'water', polygon: [[150, 240], [352, 240], [352, 600], [160, 600], [126, 500], [122, 400], [134, 320]] },
        { type: 'water', polygon: [[548, 240], [742, 240], [756, 340], [760, 440], [744, 540], [548, 600]] },
        // The island's beach ring (sand between green collar and water).
        // Oversized so it OVERLAPS the moat bands — water outranks sand where
        // they meet, so the shoreline is seamless (an undersized ring leaves
        // a rough ledge between sand and water; playtest aerial artifact).
        { type: 'bunker', beach: true, polygon: blob(450, 430, 108, 108, 16, 0.1, 821) },
        // Two clean pots cut into the ring: front-left and back-right, so
        // the "safe middle" is the only stress-free landing.
        { type: 'bunker', polygon: blob(398, 476, 16, 12, 8, 0.3, 822) },
        { type: 'bunker', polygon: blob(502, 388, 15, 12, 8, 0.3, 823) },
        // Island palms — the silhouette that says Sable Bay from the tee.
        { type: 'trees', accent: true, keepGround: true, treeR: 20, palm: true, polygon: blob(392, 392, 16, 16, 4, 0.2, 824) },
        { type: 'trees', accent: true, keepGround: true, treeR: 17, palm: true, polygon: blob(512, 470, 14, 14, 4, 0.2, 825) }
      ],
      aiTargets: [],
      // The tee-side apron is a designed drop/recovery area (short misses
      // rewind here) — keep it detailed and in-bounds.
      recoveryZones: [[[380, 690], [520, 690], [520, 770], [380, 770]]],
      sailboats: 3,
      props: [{ key: 'bridge', x: 450, y: 610, rot: 1.5708, len: 130 }],
      elevation: [
        { x: 450, y: 800, h: 2.6, r: 130, shape: 'plateau' },
        // The island barely rises from the bay — a low pad, not a mesa. The
        // flat top spans the whole beach ring so the sand lies level.
        { x: 450, y: 430, h: 0.9, r: 150, shape: 'plateau', skirt: 0.72 }
      ]
    },
    // ------------------------------------------------ h3 "Long Reach" par 5
    // The closing headland: the drive plays along clifftop terraces framed
    // against open ocean, then the hole asks THE question — carry the inlet
    // corner to reach in two, or lay up right and play in with a wedge. The
    // green sits on a low headland with the beach below it.
    {
      number: 3,
      name: 'Long Reach',
      par: 5,
      world: { width: 1000, height: 1500 },
      tee: [650, 1410],
      teeBox: { w: 32, d: 24 },
      green: { cx: 400, cy: 300, rx: 84, ry: 56, rot: 0.3 },
      slope: { angle: 3.6, strength: 0.32 },
      fairways: [
        { centerline: [[650, 1380], [652, 1220], [628, 1050], [590, 900], [556, 820]], width: [42, 78, 92, 80, 64] },
        { centerline: [[556, 820], [512, 690], [464, 550], [424, 430], [402, 350]], width: [64, 80, 86, 68, 52] }
      ],
      hazards: [
        // The ocean west of everything + the inlet that cuts to the lay-up.
        {
          type: 'water',
          polygon: [
            [30, 120], [300, 140], [340, 260], [310, 420], [280, 560], [330, 640],
            [430, 660], [470, 720], [420, 790], [300, 810], [160, 830], [30, 850]
          ]
        },
        // Beach under the headland green.
        { type: 'bunker', beach: true, polygon: [[280, 360], [330, 430], [310, 540], [220, 560], [230, 420]] },
        // Drive bunker on the aggressive (ocean) line.
        { type: 'bunker', polygon: blob(560, 1090, 26, 18, 9, 0.35, 831) },
        // Lay-up pot guarding the safe bail right of the inlet.
        { type: 'bunker', polygon: blob(596, 640, 20, 15, 9, 0.3, 832) },
        // Clean sculpted back-right greenside bunker; front stays open for
        // the runner that carried the inlet.
        { type: 'bunker', polygon: blob(492, 268, 26, 18, 9, 0.3, 833) },
        // Wind-shaped pine stand inland of the drive terraces.
        {
          type: 'trees', spacing: 60, keepGround: true,
          polygon: [[740, 1060], [880, 1000], [920, 1140], [900, 1300], [780, 1330], [730, 1200]]
        },
        // Palm accents pacing the route.
        { type: 'trees', accent: true, keepGround: true, treeR: 18, palm: true, polygon: blob(600, 1180, 16, 16, 4, 0.2, 834) },
        { type: 'trees', accent: true, keepGround: true, treeR: 20, palm: true, polygon: blob(540, 900, 16, 16, 4, 0.2, 835) },
        { type: 'trees', accent: true, keepGround: true, treeR: 18, palm: true, polygon: blob(500, 300, 16, 16, 4, 0.2, 836) }
      ],
      aiTargets: [[645, 1080], [560, 838], [478, 570]],
      sailboats: 2,
      elevation: [
        // Clifftop terraces stepping down the headland.
        { x: 650, y: 1410, h: 3.0, r: 150, shape: 'plateau' },
        { x: 620, y: 1080, h: 2.2, r: 200, shape: 'plateau', skirt: 0.4 },
        { x: 540, y: 700, h: 1.4, r: 190, shape: 'plateau', skirt: 0.4 },
        { x: 400, y: 300, h: 1.0, r: 130, shape: 'plateau' },
        // Inland dune spine framing the right of the whole route.
        { x: 830, y: 1250, x2: 700, y2: 500, h: 4.6, r: 170 },
        // The ground sheds toward the ocean and the inlet.
        { x: 300, y: 700, h: -1.0, r: 150 },
        { x: 320, y: 420, h: -0.8, r: 120 }
      ]
    }
  ]
};

export { sablebayV2 };
