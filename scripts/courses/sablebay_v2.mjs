// SABLE BAY v2 — GENUINE TEARDOWN #2 (owner directive: start from first
// principles, new routing + strategy on every hole; the ONLY mandatory feature
// is at least one TRUE island green as a memorable signature). Emitted to
// src/data/courses/v2/sablebay.json, dev-only behind `courseRebuilds`. No
// legacy geometry copied — new holes, new concepts:
//   h1 "Breakwater"  par 4 — a rugged-shore two-angle par 4; carry the beach
//                            cove corner for the short line, bench green on a
//                            boulder seawall above the bay.
//   h2 "The Anchorage" par 3 — the SIGNATURE: a TRUE island green (water all
//                            around + beach collar + boardwalk), reimagined as
//                            an ANGLED island with a south sand APRON bail-out,
//                            approached across the wind.
//   h3 "Tide's Turn" par 5 — a DOUBLE-CARRY reachable par 5: drive over a tidal
//                            inlet, then a cape second across open water to a
//                            green perched on a sandy point.
import { blob, stream } from '../courselib.mjs';

// Collidable coastal boulder helper (seawall stone) — a 'rock' hazard.
const seawall = (cx, cy, h, key, seed) => ({ type: 'rock', cx, cy, r: h, height: h, key, polygon: blob(cx, cy, h, h, 8, 0, seed) });

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
    // PINEHURST No. 2 identity (owner): longleaf PINES over sandy WASTE, with
    // WIREGRASS clumps and pine straw — NOT a green parkland. Bare-trunk pines
    // dominate; palms retired from the tree mix (they read tropical, not
    // sandhills) but kept as rare coastal accents at the very shore only.
    treeKeys: ['tree_pine_k3', 'tree_pine_k1'], accentTreeKeys: ['tree_pine_k3'],
    scatterKeys: ['stone_a', 'stone_b', 'stone_d'],
    tuftDensity: 0.9, roughTuftHeight: 1.0,
    // GOOD grass only (owner: "the grass assets are horrible — the same ones we
    // said not to use on Timberline"): grass_g/h render as real thin blades, not
    // the solid low-poly blocks grass_c/d/e read as.
    lushGrass: true, grassKeys: ['grass_g', 'grass_h'],
    tallGrass: { cap: 4.0, density: 4.0 },
    // WIREGRASS in the waste (owner: "a lot of ... wiregrass"): tall wispy grass
    // clumps scattered dense through the sand, the Pinehurst signature. Denser
    // step + higher keep than the old sparse juniper/grass mix.
    sandPlantKeys: ['grass_g', 'grass_h'], sandPlantStep: 58, sandPlantKeep: 0.55,
    // Broken shore rock rims the beach waste/seawall so the coast reads as stone.
    shorelineKeys: ['stone_a', 'stone_b', 'stone_d'],
    edgeWobble: 3.0, mowPattern: 'straight', mowWidth: 28,
    greenColumns: true, greenMowPattern: 'straight',
    cloudStyle: 'wispy', atmosphere: 'coastal'
  },
  holes: [
    // ============================================= h1 "Breakwater" par 4
    // A rugged headland par 4 down the bay. A beach cove bites into the fairway
    // at the drive zone: the aggressive line carries the cove corner for a short,
    // open approach; the safe line hangs right (blocked by a fairway bunker) and
    // leaves more in. The green is benched on a granite SEAWALL above the water.
    {
      number: 1,
      name: 'Breakwater',
      par: 4,
      world: { width: 1020, height: 1260 },
      tee: [624, 1124],
      teeBox: { w: 30, d: 22 },
      green: { cx: 420, cy: 362, rx: 60, ry: 46, rot: 0.2 },
      slope: { angle: 3.0, strength: 0.3 },
      centerline: [[624, 1096], [610, 980], [578, 850], [508, 694], [452, 536], [426, 416]],
      width: [42, 60, 82, 80, 66, 50],
      hazards: [
        // THE BAY down the left, with a beach COVE jutting into the drive zone —
        // the aggressive line carries the cove corner ([452,690]..[436,812]).
        { type: 'water', polygon: [[40, 240], [280, 250], [344, 376], [382, 520], [452, 690], [470, 760], [436, 812], [352, 828], [304, 720], [268, 884], [188, 1046], [40, 1070]] },
        // A thin BEACH collar along the cove/shore (coastal sand, recoverable).
        { type: 'bunker', beach: true, polygon: [[452, 690], [486, 752], [452, 828], [356, 846], [316, 748], [352, 700], [408, 688]] },
        // FAIRWAY BUNKERS in the drive zone (kept feature), staggered: near/right
        // catches the safe drive short; far/left guards the aggressive landing.
        { type: 'bunker', polygon: blob(574, 812, 26, 18, 10, 0.35, 211) },
        { type: 'bunker', polygon: blob(506, 700, 24, 17, 10, 0.35, 212) },
        // Greenside sand front-right (safe miss); water/seawall short-left.
        { type: 'bunker', depthMul: 1.3, polygon: blob(492, 410, 20, 15, 9, 0.3, 213) },
        // GIANT WASTE — the Pinehurst hallmark (owner: "waste bunkers are a
        // hallmark of this course; giant bunkers spanning entire holes"). A
        // sprawling sandy blowout covering the whole inland-right of the hole,
        // wiregrass-scattered, with the pine stand standing IN the sand. Waste
        // ranks below fairway/trees/water/green, so only the rough becomes sand;
        // the fairway ribbon, the bay and the green punch through untouched. It
        // plays FIRM (runs, doesn't plug), so a wide miss is recoverable, not dead.
        { type: 'bunker', waste: true, polygon: [[648, 320], [1008, 300], [1010, 1220], [612, 1240], [604, 1060], [652, 872], [704, 632], [668, 470], [646, 360]] },
        // Waste sandhills wrapping the shore below the bay (left of the tee).
        { type: 'bunker', waste: true, polygon: [[40, 1092], [300, 1150], [452, 1256], [40, 1258]] },
        // Wind-shaped pine stand inland-right, standing IN the waste; palms mark
        // the shore green.
        { type: 'trees', spacing: 58, visualSpacing: 30, keepGround: true, polygon: [[726, 980], [820, 880], [842, 660], [782, 520], [704, 640], [704, 880]] },
        { type: 'trees', accent: true, keepGround: true, treeR: 20, palm: true, polygon: blob(486, 348, 18, 18, 4, 0.2, 214) },
        { type: 'trees', accent: true, keepGround: true, treeR: 18, palm: true, polygon: blob(356, 430, 16, 16, 4, 0.2, 215) }
      ],
      // THE SEAWALL — granite boulders stacked along the shore below the benched
      // green (collidable). Reads as the breakwater the hole is named for.
      landforms: [
        seawall(352, 486, 15, 'stone_a', 216), seawall(336, 528, 13, 'stone_b', 217),
        seawall(368, 448, 14, 'stone_d', 218), seawall(392, 414, 12, 'stone_a', 219),
        seawall(326, 566, 12, 'stone_b', 220)
      ],
      aiTargets: [[600, 840], [504, 610], [424, 410]],
      elevation: [
        { x: 624, y: 1124, h: 2.4, r: 130, shape: 'plateau' },
        // Coastal terraces stepping DOWN to the bay on the left.
        { x: 706, y: 860, x2: 760, y2: 520, h: 4.2, r: 150 }, // inland dune ridge (right)
        { x: 560, y: 640, h: 1.6, r: 150 },
        // GREEN benched on the seawall — a low seaside shelf above the water.
        { x: 420, y: 362, h: 2.6, r: 150, shape: 'plateau', skirt: 0.5 },
        { x: 300, y: 640, h: -1.2, r: 150 } // land sheds into the bay
      ]
    },
    // =========================================== h2 "The Anchorage" par 3
    // THE SIGNATURE — a TRUE island green (owner: the one mandatory feature).
    // Reimagined from a concentric moat into an ANGLED island: an oblong green
    // set on a diagonal with a south sand APRON that gives a bail-out short of
    // the pin (still on the island, in sand not water), reached by a boardwalk.
    // The wind across the diagonal is the hole.
    {
      number: 2,
      name: 'The Anchorage',
      par: 3,
      world: { width: 940, height: 1040 },
      tee: [468, 760],
      teeBox: { w: 30, d: 22 },
      green: { cx: 474, cy: 424, rx: 54, ry: 42, rot: 0.5 },
      slope: { angle: 2.8, strength: 0.32 },
      centerline: [[468, 746], [470, 724]],
      width: [40, 40],
      hazards: [
        // THE MOAT — four overlapping RECTANGULAR bands forming a solid water
        // frame around a central dry island rectangle (x402..546, y368..486).
        // Full-rectangle bands overlap at the corners, so — unlike arced bands —
        // there is NO diagonal land bridge: the green is water-surrounded on all
        // sides. (surfaceAt ranks water above beach, so the collar edge tucked
        // under a band reads as the waterline.)
        { type: 'water', polygon: [[120, 250], [808, 250], [808, 368], [120, 368]] }, // top
        // BOTTOM band SPLIT to leave a dry strip (x452..496) down the middle —
        // the LAND BRIDGE to the island (owner: "the boardwalk is horrible; just
        // build a land bridge — one strip of brown mulch walkway out to the
        // island"). The strip is mulch-painted by the garden below.
        { type: 'water', polygon: [[120, 486], [452, 486], [452, 706], [120, 706]] }, // bottom-left
        { type: 'water', polygon: [[496, 486], [808, 486], [808, 706], [496, 706]] }, // bottom-right
        { type: 'water', polygon: [[120, 250], [402, 250], [402, 706], [120, 706]] }, // left
        { type: 'water', polygon: [[546, 250], [808, 250], [808, 706], [546, 706]] }, // right
        // The island BEACH collar (angled oblong) filling the dry rectangle; its
        // edges tuck just under the bands for an organic waterline. The green sits
        // on it with a sand ring; a shot short-center finds this sand, not water.
        { type: 'bunker', beach: true, polygon: blob(474, 427, 98, 92, 20, 0.08, 221) },
        // TEE-SURROUND WASTE — sandy sandhills around the tee and the near bank,
        // wiregrass through it, so the whole hole reads as Pinehurst sand rather
        // than green rough (waste only replaces rough; the water/island win).
        { type: 'bunker', waste: true, polygon: [[120, 712], [820, 712], [860, 900], [780, 1010], [468, 1030], [150, 1000], [96, 860]] },
        // Two pots cut into the collar (front-left, back-right) — only the middle
        // is stress-free.
        { type: 'bunker', polygon: blob(430, 458, 13, 10, 8, 0.3, 222) },
        { type: 'bunker', polygon: blob(520, 392, 13, 10, 8, 0.3, 223) },
        { type: 'trees', accent: true, keepGround: true, treeR: 18, palm: true, polygon: blob(414, 392, 15, 15, 4, 0.2, 224) },
        { type: 'trees', accent: true, keepGround: true, treeR: 16, palm: true, polygon: blob(534, 460, 13, 13, 4, 0.2, 225) }
      ],
      aiTargets: [],
      recoveryZones: [[[402, 724], [546, 724], [546, 792], [402, 792]]],
      sailboats: 3,
      // THE LAND BRIDGE — a single strip of brown MULCH walkway out to the island
      // (owner), painted on the dry strip carved through the water bands above.
      // A thin long garden bed with NO blooms/bushes = bare bark-mulch dirt. The
      // old wooden-boardwalk prop is gone.
      gardens: [{ cx: 474, cy: 604, rx: 21, ry: 96, rot: 0, bloomChance: 0, bushChance: 0, density: 1 }],
      elevation: [
        { x: 468, y: 776, h: 2.6, r: 130, shape: 'plateau' },
        { x: 474, y: 424, h: 1.0, r: 150, shape: 'plateau', skirt: 0.72 }
      ]
    },
    // ============================================= h3 "Tide's Turn" par 5
    // A DOUBLE-CARRY reachable par 5 turning up the coast. The drive carries a
    // TIDAL INLET that cuts across the start; the fairway then climbs the shore;
    // the reach-in-two second (or a bold third) carries an open-water CHANNEL to
    // a green perched on a sandy POINT jutting into the bay.
    {
      number: 3,
      name: "Tide's Turn",
      par: 5,
      world: { width: 1240, height: 1560 },
      tee: [360, 1460],
      teeBox: { w: 32, d: 24 },
      green: { cx: 848, cy: 404, rx: 80, ry: 56, rot: -0.2 },
      slope: { angle: 3.2, strength: 0.32 },
      fairways: [
        { centerline: [[360, 1432], [430, 1300], [548, 1204], [668, 1150]], width: [44, 78, 92, 84] },
        { centerline: [[668, 1150], [746, 1006], [780, 856], [770, 712]], width: [84, 76, 68, 60] },
        { centerline: [[770, 712], [800, 596], [834, 480], [852, 436]], width: [60, 56, 50, 46] }
      ],
      hazards: [
        // THE TIDAL INLET across the start — the drive must carry it.
        { type: 'water', polygon: [[300, 1444], [470, 1402], [540, 1330], [512, 1268], [396, 1288], [304, 1348], [280, 1400]] },
        // THE OPEN BAY down the west, and the CHANNEL the reach carries to the
        // point green (a cove biting in front of the green).
        { type: 'water', polygon: [[40, 720], [244, 736], [312, 872], [292, 1060], [212, 1200], [40, 1220]] },
        { type: 'water', polygon: [[592, 520], [740, 512], [812, 560], [806, 648], [712, 690], [604, 664], [560, 588]] },
        // Beach under the sandy point green (the shore the green sits on).
        { type: 'bunker', beach: true, polygon: [[792, 452], [900, 470], [928, 560], [852, 604], [760, 560], [764, 484]] },
        // GIANT WASTE spanning the inland-right of the hole (Pinehurst hallmark)
        // — a continuous sandy blowout up the whole right and across the bottom,
        // wiregrass through it, pines standing in it. Waste only replaces rough,
        // so the three fairway ribbons, the bay/inlet/channel and the point green
        // all punch through; it plays FIRM so a miss into the sand still runs.
        { type: 'bunker', waste: true, polygon: [[884, 300], [1232, 300], [1234, 1556], [612, 1556], [676, 1260], [792, 940], [770, 720], [828, 520], [872, 396]] },
        // Left-of-tee waste sandhills between the tidal inlet and the bay.
        { type: 'bunker', waste: true, polygon: [[40, 1236], [214, 1214], [300, 1330], [286, 1470], [40, 1500]] },
        // FAIRWAY BUNKER cluster pinching the drive landing (kept feature).
        { type: 'bunker', polygon: blob(566, 1188, 26, 18, 10, 0.35, 231) },
        { type: 'bunker', polygon: blob(624, 1126, 24, 17, 10, 0.35, 232) },
        // Lay-up pot guarding the safe bail short-right of the channel.
        { type: 'bunker', polygon: blob(792, 640, 22, 16, 9, 0.3, 233) },
        // Back-right greenside bunker; front-left open for a runner off the point.
        { type: 'bunker', depthMul: 1.3, polygon: blob(916, 372, 24, 17, 9, 0.3, 234) },
        // Wind-shaped pines inland; palms pacing the cape + the point.
        { type: 'trees', spacing: 58, visualSpacing: 30, keepGround: true, polygon: [[430, 1200], [530, 1100], [552, 960], [482, 880], [392, 980], [382, 1120]] },
        { type: 'trees', accent: true, keepGround: true, treeR: 20, palm: true, polygon: blob(700, 940, 16, 16, 4, 0.2, 235) },
        { type: 'trees', accent: true, keepGround: true, treeR: 18, palm: true, polygon: blob(904, 336, 16, 16, 4, 0.2, 236) }
      ],
      // Granite point boulders below the green (collidable seawall on the point).
      landforms: [
        seawall(772, 540, 14, 'stone_a', 237), seawall(896, 560, 13, 'stone_b', 238),
        seawall(830, 600, 12, 'stone_d', 239)
      ],
      aiTargets: [[512, 1264], [712, 1044], [782, 782], [838, 452]],
      sailboats: 2,
      elevation: [
        { x: 360, y: 1460, h: 3.0, r: 150, shape: 'plateau' },
        // Clifftop terraces stepping up the shore to the point green.
        { x: 470, y: 1250, h: 2.2, r: 180, shape: 'plateau', skirt: 0.4 },
        { x: 760, y: 800, h: 1.8, r: 176, shape: 'plateau', skirt: 0.4 },
        { x: 848, y: 404, h: 2.2, r: 150, shape: 'plateau', skirt: 0.5 }, // point green bench
        // Inland dune spine framing the right of the whole route.
        { x: 1030, y: 1160, x2: 1010, y2: 540, h: 4.6, r: 168 },
        { x: 240, y: 1120, h: -1.2, r: 150 }, // sheds to the ocean
        { x: 686, y: 596, h: -1.0, r: 118 } // the channel hollow
      ]
    }
  ]
};

export { sablebayV2 };
