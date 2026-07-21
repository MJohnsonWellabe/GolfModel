// SABLE BAY v2 — COASTAL DUNESCAPE PASS (owner directive, 2026-07-21). The
// teardown routing is kept (Breakwater / The Anchorage island green / Tide's
// Turn) but the ART is rebuilt to the owner's brief:
//   1. H1 & H3: "anything that's not fairway should be waste bunkers" — the
//      whole in-play land is one WASTE-sand sea; only the fairway ribbon and
//      the green are turf islands (waste ranks below fairway/trees/water/green
//      in surfaceAt, so those punch through untouched).
//   2. H2: behind the island green there is ONLY water + the decorative
//      sailboats — every tree/prop that used to flank/back the green is gone.
//   3. Colour: a cohesive WARM coastal links — clean warm sand, healthy (not
//      neon, not olive) turf, a believable warm-teal sea.
//   4. Elevation: authored rolling relief PLUS dune / sand-hill mounds raised
//      through the waste, so the course no longer reads dead flat.
//   5. Assets: the vetted coastal set — wiregrass (grass_g/h, real blades),
//      broken shore stone (stone_a/b/c/d/e granite/stone packs) as seawall +
//      shoreline rock, bare-trunk pines standing in the sand, ships on the sea.
//      Placement HOOKS for future coastal props (lighthouse / pier) are marked.
// Emitted to src/data/courses/v2/sablebay.json, dev-only behind `courseRebuilds`.
import { blob } from '../courselib.mjs';

// Collidable coastal boulder helper (seawall stone) — a 'rock' hazard.
const seawall = (cx, cy, h, key, seed) => ({ type: 'rock', cx, cy, r: h, height: h, key, polygon: blob(cx, cy, h, h, 8, 0, seed) });

const sablebayV2 = {
  name: 'Sable Bay',
  version: 2,
  theme: {
    // --- WARM COASTAL LINKS palette (owner: "the colours are off; warm,
    //     cohesive coastal"). Before→after recorded in the handoff report.
    skyTop: '#58a6dc', skyBottom: '#e3eef0', sunX: 520, sunY: 120,
    // Healthy links turf — pulled back from the old neon/blue green toward a
    // warmer, sun-touched fairway so it reads as real grass against the sand.
    fairway: '#57a251', fairwayDark: '#47893f',
    // Rough is now only thin slivers (H2 near-bank) — a warm dune-green.
    rough: '#7a9a55', roughDark: '#5f7d3f',
    fringe: '#64b25b', green: '#56a84f', greenLight: '#70c266',
    // Clean warm PINEHURST/links sand — less olive, a touch lighter and warmer
    // so the giant waste reads as bright firm tan sand, not tired rough.
    sand: '#ecd39a', sandDark: '#d7b877',
    // Believable warm coastal sea (a hint more teal than the old flat blue).
    water: '#2a90b2', waterDeep: '#175f88', waterReflect: true,
    treeCanopy: '#2f6a44', treeCanopyLight: '#3f7e52', treeTrunk: '#6b5238',
    // Warm sunlit horizon glow ties the whole coast together (was a cool blue).
    haze: '#e6ecec', hazeStrength: 0.42, horizonTint: '#ecdcc0',
    backdrop: 'sea', seaDunes: false, blossomChance: 0,
    // PINEHURST No. 2 identity (owner): longleaf PINES over sandy WASTE, with
    // WIREGRASS clumps and pine straw — NOT a green parkland. Bare-trunk pines
    // dominate; palms retired from the tree mix (they read tropical, not
    // sandhills) but kept as rare coastal accents at the very shore only.
    treeKeys: ['tree_pine_k3', 'tree_pine_k1'], accentTreeKeys: ['tree_pine_k3'],
    // Shore/dune stone: the stone pack (a/b/c) + photo-textured granite (d/e)
    // both render as clean boulders (ASSET_AUDIT: stone_c/e unused, render
    // clean) — mixed for shape variety along the coast.
    scatterKeys: ['stone_a', 'stone_b', 'stone_c', 'stone_d', 'stone_e'],
    tuftDensity: 0.9, roughTuftHeight: 1.0,
    // GOOD grass only (owner: "the grass assets are horrible"): grass_g/h render
    // as real thin blades, not the solid low-poly blocks grass_a-f/i read as.
    lushGrass: true, grassKeys: ['grass_g', 'grass_h'],
    tallGrass: { cap: 4.0, density: 4.0 },
    // WIREGRASS through the waste (owner: "a lot of wiregrass"): tall wispy
    // clumps dense across the sand — the Pinehurst signature, now covering a
    // much larger sand area (still boundary-clipped to the corridor for perf).
    sandPlantKeys: ['grass_g', 'grass_h'], sandPlantStep: 58, sandPlantKeep: 0.55,
    // Broken shore rock rims the beach/seawall so the coast reads as stone.
    shorelineKeys: ['stone_a', 'stone_b', 'stone_d', 'stone_e'],
    edgeWobble: 3.0, mowPattern: 'straight', mowWidth: 28,
    greenColumns: true, greenMowPattern: 'straight',
    cloudStyle: 'wispy', atmosphere: 'coastal'
  },
  holes: [
    // ============================================= h1 "Breakwater" par 4
    // A rugged headland par 4 down the bay. The ENTIRE in-play land is now a
    // waste-sand sea (owner: "anything not fairway = waste"): the fairway ribbon
    // and the green are the only turf islands. The bay bites in on the left; the
    // aggressive line carries the cove corner for a short, open approach. Rolling
    // dune relief + raised sand-hills give the sand real form and shadow.
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
        // GIANT WASTE — the whole hole is sand (owner directive). One polygon
        // covering the entire world; the bay (water), the fairway ribbon and the
        // green all punch through it (surfaceAt precedence). Plays FIRM (the ball
        // runs, never plugs) so a wide miss stays recoverable, not dead.
        { type: 'bunker', waste: true, polygon: [[8, 8], [1012, 8], [1012, 1252], [8, 1252]] },
        // FAIRWAY BUNKERS in the drive zone (kept feature): staggered scoring
        // pots that dish into the sand — near/right catches the safe drive short,
        // far/left guards the aggressive landing.
        { type: 'bunker', polygon: blob(574, 812, 26, 18, 10, 0.35, 211) },
        { type: 'bunker', polygon: blob(506, 700, 24, 17, 10, 0.35, 212) },
        // Greenside sand front-right (safe miss); water/seawall short-left.
        { type: 'bunker', depthMul: 1.3, polygon: blob(492, 410, 20, 15, 9, 0.3, 213) },
        // Wind-shaped pine stand standing IN the waste (keepGround → sand lie).
        { type: 'trees', spacing: 58, visualSpacing: 30, keepGround: true, polygon: [[726, 980], [820, 880], [842, 660], [782, 520], [704, 640], [704, 880]] },
        // A rare coastal accent pine at the very shore green (keepGround → sand).
        { type: 'trees', accent: true, keepGround: true, treeR: 18, polygon: blob(356, 470, 16, 16, 4, 0.2, 215) }
        // HOOK: a future LIGHTHOUSE could stand on the seawall point near
        //       [340,430]; a PIER could run into the bay near [300,900].
      ],
      // THE SEAWALL — granite/stone boulders stacked along the shore below the
      // benched green (collidable). Reads as the breakwater the hole is named for.
      landforms: [
        seawall(352, 486, 15, 'stone_a', 216), seawall(336, 528, 13, 'stone_b', 217),
        seawall(368, 448, 14, 'stone_d', 218), seawall(392, 414, 12, 'stone_e', 219),
        seawall(326, 566, 12, 'stone_c', 220)
      ],
      aiTargets: [[600, 840], [504, 610], [424, 410]],
      elevation: [
        { x: 624, y: 1124, h: 2.4, r: 130, shape: 'plateau' }, // tee shelf
        // INLAND DUNE SPINE up the right — the big sand-hill mass framing the
        // sea of sand, with its own shadowed face.
        { x: 800, y: 820, x2: 858, y2: 520, h: 5.4, r: 150 },
        { x: 838, y: 980, h: 4.0, r: 130 },   // right dune hill
        { x: 790, y: 1150, h: 3.4, r: 120 },  // foreground dune right of tee
        // Rolling relief along the playing corridor (gentle — the fairway rolls).
        { x: 560, y: 640, h: 1.8, r: 150 },
        { x: 520, y: 900, h: 2.4, r: 150 },
        // A back-left dune behind the green (kept well clear of the putting
        // surface so it never breaks green puttability).
        { x: 250, y: 250, h: 3.0, r: 110 },
        // GREEN benched on the seawall — a low, gentle seaside shelf.
        { x: 420, y: 362, h: 2.6, r: 150, shape: 'plateau', skirt: 0.5 },
        { x: 300, y: 660, h: -1.2, r: 150 }   // land sheds into the bay
      ]
    },
    // =========================================== h2 "The Anchorage" par 3
    // THE SIGNATURE — a TRUE island green. Behind the green there is now ONLY
    // water and the decorative sailboats (owner): the two pines that used to
    // flank/back the green are removed, so the backdrop from the tee is a clean
    // sea + ships. An angled oblong green with a south sand apron bail-out,
    // reached by a slim mulch land bridge.
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
        // THE MOAT — four overlapping RECTANGULAR water bands framing a central
        // dry island rectangle (x402..546, y368..486). No diagonal land bridge:
        // the green is water-surrounded on all sides.
        { type: 'water', polygon: [[120, 250], [808, 250], [808, 368], [120, 368]] }, // top (behind green — open sea)
        { type: 'water', polygon: [[120, 486], [460, 486], [460, 706], [120, 706]] }, // bottom-left
        { type: 'water', polygon: [[488, 486], [808, 486], [808, 706], [488, 706]] }, // bottom-right
        { type: 'water', polygon: [[120, 250], [402, 250], [402, 706], [120, 706]] }, // left
        { type: 'water', polygon: [[546, 250], [808, 250], [808, 706], [546, 706]] }, // right
        // The island BEACH collar (angled oblong) filling the dry rectangle; its
        // edges tuck just under the bands for an organic waterline. A shot
        // short-center finds this sand, not water.
        { type: 'bunker', beach: true, polygon: blob(474, 427, 98, 92, 20, 0.08, 221) },
        // TEE-SURROUND WASTE — sandy sand-hills around the tee and the near bank
        // (in FRONT of the green, toward the player), wiregrass through it, so
        // the whole approach reads as Pinehurst sand rather than green rough.
        { type: 'bunker', waste: true, polygon: [[120, 712], [820, 712], [860, 900], [780, 1010], [468, 1030], [150, 1000], [96, 860]] },
        // Two pots cut into the collar (front-left, back-right) — only the middle
        // is stress-free.
        { type: 'bunker', polygon: blob(430, 458, 13, 10, 8, 0.3, 222) },
        { type: 'bunker', polygon: blob(520, 392, 13, 10, 8, 0.3, 223) }
        // NOTE: the accent pines that used to sit at [414,392] & [534,460]
        // (behind/beside the green) are DELETED — nothing but water + boats sits
        // behind the island now.
        // HOOK: a future coastal LIGHTHOUSE could sit far off on the sea behind
        //       the green near [474,180] without touching the island.
      ],
      aiTargets: [],
      recoveryZones: [[[402, 724], [546, 724], [546, 792], [402, 792]]],
      sailboats: 3,
      // THE LAND BRIDGE — a single slim strip of brown MULCH walkway out to the
      // island (owner), a thin garden bed with no blooms = bare bark-mulch dirt.
      gardens: [{ cx: 474, cy: 604, rx: 13, ry: 96, rot: 0, bloomChance: 0, bushChance: 0, density: 1 }],
      elevation: [
        { x: 468, y: 776, h: 2.6, r: 130, shape: 'plateau' }, // tee shelf
        // Gentle dune relief in the near-bank waste (foreground), kept clear of
        // the island so the approach rolls instead of reading flat.
        { x: 250, y: 900, h: 3.0, r: 120 },
        { x: 706, y: 900, h: 2.6, r: 110 },
        { x: 474, y: 424, h: 1.0, r: 150, shape: 'plateau', skirt: 0.72 } // island green shelf
      ]
    },
    // ============================================= h3 "Tide's Turn" par 5
    // A DOUBLE-CARRY reachable par 5 turning up the coast. As on h1 the ENTIRE
    // in-play land is now waste sand (owner): three fairway ribbons + the point
    // green are the only turf, the tidal inlet / bay / channel the only water.
    // Rolling relief + raised dune hills give the sand sea real form.
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
        // GIANT WASTE — the whole hole is sand (owner directive). One polygon
        // covering the entire world; the three fairway ribbons, the inlet/bay/
        // channel and the point green all punch through. Plays FIRM.
        { type: 'bunker', waste: true, polygon: [[8, 8], [1232, 8], [1232, 1552], [8, 1552]] },
        // FAIRWAY BUNKER cluster pinching the drive landing (kept feature).
        { type: 'bunker', polygon: blob(566, 1188, 26, 18, 10, 0.35, 231) },
        { type: 'bunker', polygon: blob(624, 1126, 24, 17, 10, 0.35, 232) },
        // Lay-up pot guarding the safe bail short-right of the channel.
        { type: 'bunker', polygon: blob(792, 640, 22, 16, 9, 0.3, 233) },
        // Back-right greenside bunker; front-left open for a runner off the point.
        { type: 'bunker', depthMul: 1.3, polygon: blob(916, 372, 24, 17, 9, 0.3, 234) },
        // Wind-shaped pines standing IN the sand (keepGround → sand lie).
        { type: 'trees', spacing: 58, visualSpacing: 30, keepGround: true, polygon: [[430, 1200], [530, 1100], [552, 960], [482, 880], [392, 980], [382, 1120]] },
        // A rare coastal accent pine on the point (keepGround → sand).
        { type: 'trees', accent: true, keepGround: true, treeR: 18, polygon: blob(700, 940, 16, 16, 4, 0.2, 235) }
        // HOOK: a future PIER could run off the point green near [980,560];
        //       a LIGHTHOUSE could crown the inland dune spine near [1080,760].
      ],
      // Granite point boulders below the green (collidable seawall on the point).
      landforms: [
        seawall(772, 540, 14, 'stone_a', 237), seawall(896, 560, 13, 'stone_e', 238),
        seawall(830, 600, 12, 'stone_c', 239)
      ],
      aiTargets: [[512, 1264], [712, 1044], [782, 782], [838, 452]],
      sailboats: 2,
      elevation: [
        { x: 360, y: 1460, h: 3.0, r: 150, shape: 'plateau' }, // tee shelf
        // Clifftop terraces stepping up the shore to the point green.
        { x: 470, y: 1250, h: 2.4, r: 180, shape: 'plateau', skirt: 0.4 },
        { x: 760, y: 800, h: 2.2, r: 176, shape: 'plateau', skirt: 0.4 },
        { x: 848, y: 404, h: 2.2, r: 150, shape: 'plateau', skirt: 0.5 }, // point green bench
        // INLAND DUNE SPINE framing the right of the whole route.
        { x: 1050, y: 1160, x2: 1030, y2: 560, h: 5.6, r: 170 },
        // Raised dune HILLS through the sand sea (well clear of the green).
        { x: 640, y: 1360, h: 3.6, r: 140 },
        { x: 1050, y: 900, h: 4.2, r: 150 },
        { x: 980, y: 640, h: 3.0, r: 120 },
        { x: 200, y: 1350, h: 3.0, r: 130 }, // dune left of the tidal inlet
        { x: 640, y: 1050, h: 2.6, r: 140 }, // rolling relief mid-route
        { x: 240, y: 1120, h: -1.2, r: 150 }, // sheds to the ocean
        { x: 686, y: 596, h: -1.0, r: 118 }   // the channel hollow
      ]
    }
  ]
};

export { sablebayV2 };
