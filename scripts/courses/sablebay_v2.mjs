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
    // Waste-dominant course: warm SAND ground-ambient so the all-sand holes read
    // as beach, not the olive wash the default (rough-tinted) bounce gave them.
    hemiGround: '#dcc48c',
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
        // TREELINES framing the corridor on BOTH sides (owner: line the fairway,
        // not a bunched clump far right). Pines standing IN the waste (keepGround
        // → sand lie); any trunk that falls in the bay is auto-skipped, so the
        // left line simply thins toward the water.
        { type: 'trees', spacing: 56, visualSpacing: 30, keepGround: true, polygon: [[570, 416], [605, 536], [670, 694], [730, 850], [745, 980], [750, 1096], [660, 1096], [655, 980], [635, 850], [565, 694], [500, 536], [465, 416]] },
        { type: 'trees', spacing: 56, visualSpacing: 30, keepGround: true, polygon: [[396, 416], [414, 536], [463, 694], [532, 850], [575, 980], [598, 1096], [558, 1096], [535, 980], [492, 850], [423, 694], [374, 536], [356, 416]] },
        // STANDALONE SPECIMEN PINES standing IN the fairway (owner: force a line
        // choice off the tee). A stagger — right-of-center then left-of-center —
        // so the player must thread a side. keepGround → fairway lie, solid trunk.
        { type: 'trees', keepGround: true, treeR: 15, polygon: blob(606, 880, 14, 14, 6, 0.2, 241) },
        { type: 'trees', keepGround: true, treeR: 15, polygon: blob(512, 760, 14, 14, 6, 0.2, 242) },
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
      // Coastal landmarks (CC0 Kenney props, upright): a LIGHTHOUSE crowning the
      // seawall point, and a ROWBOAT pulled up on the sand by the bay.
      props: [
        { key: 'lighthouse', x: 338, y: 430, rot: 0.35, len: 46, upright: true },
        { key: 'rowboat', x: 318, y: 862, rot: 2.2, len: 16, upright: true }
      ],
      aiTargets: [[600, 840], [504, 610], [424, 410]],
      elevation: [
        { x: 624, y: 1124, h: 14, r: 130, shape: 'plateau', skirt: 0.42 }, // tee shelf
        // INLAND DUNE RIDGE up the right — the big sand-hill mass framing the sea
        // of sand at TL-East magnitude, with its own shadowed face.
        { x: 852, y: 820, x2: 898, y2: 520, h: 28, r: 160 },
        { x: 884, y: 1020, h: 22, r: 140 },   // right dune hill
        { x: 820, y: 1188, h: 15, r: 120 },   // foreground dune right of tee
        // Rolling relief along the playing corridor — the fairway visibly rolls.
        { x: 560, y: 640, h: 8, r: 150 },
        { x: 520, y: 900, h: 9, r: 150 },
        // A big back-left dune behind the green (kept clear of the putting surface
        // so it never breaks green puttability).
        { x: 210, y: 220, h: 24, r: 120 },
        // GREEN benched on the seawall — a raised seaside shelf.
        { x: 420, y: 362, h: 12, r: 160, shape: 'plateau', skirt: 0.55 },
        { x: 300, y: 660, h: -2, r: 150 }   // land sheds into the bay
      ]
    },
    // =========================================== h2 "The Anchorage" par 3
    // THE SIGNATURE — a TRUE island green. Behind the green there is now ONLY
    // water and the decorative sailboats (owner): the two pines that used to
    // flank/back the green are removed, so the backdrop from the tee is a clean
    // sea + ships. An angled oblong green with a south sand apron bail-out,
    // reached by a slim STONE causeway (a staggered line of shore boulders on a
    // firm-sand base — the old brown mulch strip is gone).
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
        // BEHIND-GREEN OPEN SEA — the whole area behind the island is water to the
        // horizon (owner: NO land behind the green, blue to the horizon). Split
        // into three full-width columns spanning to the top of the world so that
        // EVERY decorative boat samples here: course3d places boat i by first
        // trying water box i, and boxes 0-2 are these behind-green columns, so no
        // boat can ever sit in front of the green. Beyond the world edge the
        // sea-backdrop plane (seaDunes:false) carries the blue to the skyline.
        // Spans PAST the world edges (x −40..980) and right up to the green's back
        // edge (y 385, just north of the green) so blue laps to the green with no
        // sand collar or edge sliver showing behind it.
        { type: 'water', polygon: [[-40, -40], [315, -40], [315, 385], [-40, 385]] },   // behind-left
        { type: 'water', polygon: [[315, -40], [625, -40], [625, 385], [315, 385]] },   // behind-mid
        { type: 'water', polygon: [[625, -40], [980, -40], [980, 385], [625, 385]] },   // behind-right
        // THE MOAT — side + front water ringing the dry island rectangle
        // (x402..546, y385..486). The only land off the island is the walkway gap
        // (x461..487) down the front, so the green reads truly water-surrounded.
        { type: 'water', polygon: [[-40, 385], [402, 385], [402, 706], [-40, 706]] },   // left
        { type: 'water', polygon: [[546, 385], [980, 385], [980, 706], [546, 706]] },   // right
        { type: 'water', polygon: [[402, 486], [461, 486], [461, 706], [402, 706]] }, // front-left
        { type: 'water', polygon: [[487, 486], [546, 486], [546, 706], [487, 706]] }, // front-right
        // The island BEACH collar (angled oblong) filling the dry rectangle; its
        // edges tuck just under the bands for an organic waterline. A shot
        // short-center finds this sand, not water.
        { type: 'bunker', beach: true, polygon: blob(474, 427, 92, 86, 20, 0.08, 221) },
        // THE STONE CAUSEWAY base — a thin firm WASTE-sand strip under the walkway
        // so the path reads as bright sand (with the stones laid on top below),
        // never the flat green/brown mulch strip the owner disliked.
        { type: 'bunker', waste: true, polygon: [[458, 486], [490, 486], [490, 714], [458, 714]] },
        // TEE-SURROUND WASTE — sandy sand-hills around the tee and the near bank
        // (in FRONT of the green, toward the player), wiregrass through it, so
        // the whole approach reads as Pinehurst sand rather than green rough.
        { type: 'bunker', waste: true, polygon: [[120, 712], [820, 712], [860, 900], [780, 1010], [468, 1030], [150, 1000], [96, 860]] },
        // Two pots cut into the collar (front-left, back-right) — only the middle
        // is stress-free.
        { type: 'bunker', polygon: blob(430, 458, 13, 10, 8, 0.3, 222) },
        { type: 'bunker', polygon: blob(520, 400, 13, 10, 8, 0.3, 223) }
        // NOTE: the accent pines that used to sit behind/beside the green are
        // DELETED — nothing but water + boats sits behind the island now.
      ],
      aiTargets: [],
      recoveryZones: [[[402, 724], [546, 724], [546, 792], [402, 792]]],
      // Three boats — ALL forced behind the green (see the behind-green water
      // columns above), sitting on open water, never in front of the flag.
      sailboats: 3,
      // THE STONE CAUSEWAY — a tight, staggered line of shore stones laid down the
      // walkway strip out to the island (owner: rebuild the walkway as a real
      // stone path, not the flat brown mulch strip). Small collidable boulders on
      // the firm-sand base above read as a cobbled coastal causeway. (The mulch
      // GardenBed that used to render the walkway is deleted.)
      landforms: [
        seawall(467, 500, 8, 'stone_a', 251), seawall(482, 517, 8, 'stone_b', 252),
        seawall(466, 534, 8, 'stone_d', 253), seawall(483, 551, 8, 'stone_c', 254),
        seawall(467, 568, 8, 'stone_e', 255), seawall(482, 585, 8, 'stone_a', 256),
        seawall(466, 602, 8, 'stone_b', 257), seawall(483, 619, 8, 'stone_d', 258),
        seawall(467, 636, 8, 'stone_c', 259), seawall(482, 653, 8, 'stone_e', 260),
        seawall(466, 670, 8, 'stone_a', 261), seawall(483, 687, 8, 'stone_b', 262)
      ],
      elevation: [
        { x: 468, y: 776, h: 12, r: 130, shape: 'plateau' }, // tee shelf
        // BIG dune relief in the near-bank waste framing the tee (TL-East
        // magnitude) — the surround rolls hard instead of reading dead flat.
        // (The island is water-ringed, so the strong relief lives in the sand
        // around the tee/approach where there is land to shape.)
        { x: 220, y: 880, h: 22, r: 130 },
        { x: 720, y: 880, h: 20, r: 120 },
        { x: 468, y: 1000, h: 16, r: 130 },
        { x: 474, y: 424, h: 4, r: 150, shape: 'plateau', skirt: 0.72 } // island green shelf
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
        // THE TIDAL CHANNEL — moved OUT to a ~250-yard carry (owner): its near
        // edge sits ≈470-500px (≈235-250yd, PX_PER_YARD=2) up the line from the
        // tee, cutting across the corridor at the F1→F2 turn. Now a real decision
        // — a big drive carries it, else lay up short in F1 and cross next. The
        // right flank (x>810) stays dry sand, so the hole is always completable.
        { type: 'water', polygon: [[420, 1160], [560, 1150], [700, 1120], [800, 1080], [810, 1030], [720, 1040], [600, 1085], [480, 1120], [400, 1140]] },
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
        // FAIRWAY BUNKER cluster pinching the F1 lay-up landing SHORT of the new
        // channel (kept feature; nudged short so neither sits under the water).
        { type: 'bunker', polygon: blob(525, 1250, 26, 18, 10, 0.35, 231) },
        { type: 'bunker', polygon: blob(588, 1205, 24, 17, 10, 0.35, 232) },
        // Lay-up pot guarding the safe bail short-right of the channel.
        { type: 'bunker', polygon: blob(792, 640, 22, 16, 9, 0.3, 233) },
        // Back-right greenside bunker; front-left open for a runner off the point.
        { type: 'bunker', depthMul: 1.3, polygon: blob(916, 372, 24, 17, 9, 0.3, 234) },
        // TREELINES framing the route on BOTH sides (owner: line the fairway +
        // trees in the fairway). LEFT line runs up the west of F1; RIGHT line runs
        // the east of F2/F3 up to the point green (between the corridor and the
        // inland dune spine). Pines standing IN the sand (keepGround → sand lie);
        // trunks in the bay/channel auto-skip.
        { type: 'trees', spacing: 56, visualSpacing: 30, keepGround: true, polygon: [[300, 1430], [360, 1300], [420, 1200], [470, 1090], [420, 1060], [340, 1150], [290, 1280], [270, 1420]] },
        { type: 'trees', spacing: 56, visualSpacing: 30, keepGround: true, polygon: [[905, 470], [930, 600], [940, 760], [935, 900], [920, 1040], [860, 1040], [878, 900], [875, 760], [865, 600], [845, 470]] },
        // STANDALONE SPECIMEN PINES standing IN the fairways (owner: line choice)
        // — one in the F1 drive zone, one mid-F2, each forcing a side.
        { type: 'trees', keepGround: true, treeR: 15, polygon: blob(500, 1250, 14, 14, 6, 0.2, 241) },
        { type: 'trees', keepGround: true, treeR: 15, polygon: blob(772, 890, 14, 14, 6, 0.2, 242) },
        // A rare coastal accent pine standing off the corridor in the sand
        // (keepGround → sand lie).
        { type: 'trees', accent: true, keepGround: true, treeR: 18, polygon: blob(700, 940, 16, 16, 4, 0.2, 235) }
        // HOOK: a future PIER could run off the point green near [980,560];
        //       a LIGHTHOUSE could crown the inland dune spine near [1080,760].
      ],
      // Granite point boulders below the green (collidable seawall on the point).
      landforms: [
        seawall(772, 540, 14, 'stone_a', 237), seawall(896, 560, 13, 'stone_e', 238),
        seawall(830, 600, 12, 'stone_c', 239)
      ],
      // Second target moved onto dry F2 turf BEYOND the relocated tidal channel
      // (the old [712,1044] now sits in that water) so the AI carries the hazard.
      aiTargets: [[512, 1264], [768, 930], [782, 782], [838, 452]],
      // Pirate/sail ships REMOVED from this hole (owner) — no boats on H3.
      sailboats: 0,
      elevation: [
        { x: 360, y: 1460, h: 14, r: 150, shape: 'plateau', skirt: 0.42 }, // tee shelf
        // Clifftop terraces stepping up the shore to the point green.
        { x: 470, y: 1250, h: 12, r: 180, shape: 'plateau', skirt: 0.4 },
        { x: 760, y: 800, h: 12, r: 176, shape: 'plateau', skirt: 0.4 },
        { x: 848, y: 404, h: 12, r: 150, shape: 'plateau', skirt: 0.5 }, // point green bench
        // INLAND DUNE SPINE framing the right of the whole route (TL-East ridge).
        { x: 1050, y: 1160, x2: 1030, y2: 560, h: 30, r: 170 },
        // Raised dune HILLS through the sand sea (well clear of the green).
        { x: 640, y: 1360, h: 20, r: 140 },
        { x: 1050, y: 900, h: 24, r: 150 },
        { x: 980, y: 640, h: 18, r: 120 },
        { x: 200, y: 1350, h: 20, r: 130 }, // dune left of the tidal channel
        { x: 640, y: 1050, h: 14, r: 140 }, // rolling relief mid-route
        { x: 240, y: 1120, h: -2, r: 150 }, // sheds to the ocean
        { x: 686, y: 596, h: -1.5, r: 118 }  // the channel hollow
      ]
    }
  ]
};

export { sablebayV2 };
