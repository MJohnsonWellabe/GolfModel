// MAPLE VALE (id maplevale) — the eighth course, and a theme the roster does
// not have: AUTUMN HIGHLANDS. Fall broadleaf golds and russets under first
// snow on the high peaks, misty air, dark peat water, berry bushes in the
// rough, and — a first for any course — REAL puffy mesh clouds (every shipped
// course is 'wispy', which ignores cloudKeys entirely; the nine cloud_* models
// have sat unused since they were converted).
//
// Identity fences (each shipped identity it must NOT read like):
//   - Wildwood is SPRING parkland: pink blossom, lush green rough. Maple Vale
//     turns the rough itself russet and the canopies to fire — the season is
//     in the GROUND color, not just the trees.
//   - Wild Prairie is honey-GOLD grassland with no trees at all. Maple Vale is
//     browner, redder and heavily wooded.
//   - Timberline West is cool montane broadleaf (purple heather, alpine air).
//     Maple Vale is WARM, and its peaks carry snow (mountain_alps — the only
//     true snow assets, unused by any course until now).
//
// Deterministic authoring, like every generated course: `node
// scripts/gen-new-courses.mjs` rewrites src/data/courses/maplevale.json —
// never hand-edit the JSON. Vertical unit is 1.5 ft (field guide §2).
import { blob, stream } from '../courselib.mjs';

const maplevale = {
  name: 'Maple Vale',
  version: 2,
  theme: {
    // Cold clear autumn morning: pale blue overhead falling to cream mist.
    skyTop: '#7fb2d9', skyBottom: '#efe3cf', sunX: 380, sunY: 130,
    // Painted sky (Stage 6, owner: "I want courses to have their own unique
    // skies and clouds"). Maple Vale: a low autumn overcast DOME — a grey lid
    // with almost no ramp in it, measured off a real overcast sky. Built from a
    // CC0 Poly Haven source by scripts/convert-skies.mjs; see
    // docs/technical/ASSET_ATTRIBUTION.md.
    //
    // This course KEEPS its mesh clouds (cloudKeys below) rather than taking
    // the style's cumulus/cirrus sheets: real volumetric puffs are Maple Vale's
    // authored identity and the dome change should not quietly delete them.
    // cloudCover just packs a few more of them in under the lid.
    skyStyle: 'autumn_overcast', cloudCover: 1.35, sunTint: '#fffefc',
    haze: '#e4ddce', hazeStrength: 0.5,
    // The season lives in the ground: readable warm-green mown surfaces cut
    // through RUSSET rough — redder and browner than Wild Prairie's honey
    // gold, so the two never read as siblings.
    fairway: '#7dab48', fairwayDark: '#699540',
    // First render read as bare DIRT — the values were too dark to be grass.
    // Lifted toward russet-gold grassland, still redder/browner than Wild
    // Prairie's honey (#d8a94e), which is the identity fence.
    rough: '#cfa055', roughDark: '#b08544',
    fringe: '#93a848', green: '#65a447', greenLight: '#83c058',
    sand: '#e2d3ae', sandDark: '#c4b184',
    // Dark COLD-BLUE tarns. The first pass went full peat (#33544d — nearly
    // black-green) and read as more ground, not water (owner: "does Maple
    // Vale have water? It doesn't look like water"). Water has to say WATER
    // first and moody second: still dark and cold against the autumn fire,
    // but unmistakably blue.
    water: '#3f96cc', waterDeep: '#1f5c8e',
    // Fire in the canopies. The broadleaf models are palette-driven, so these
    // two colors ARE the autumn.
    treeCanopy: '#b0562e', treeCanopyLight: '#d98038', treeTrunk: '#6b5546',
    hemiGround: '#8a6a3c',
    // First snow on the high horizon: the CC0 alpine massifs keep their own
    // materials (grey stone, white caps) — the only true snow in the asset
    // library, unused by any course until this one.
    backdrop: 'peaks', peakKeys: ['mountain_alps', 'mountain_alps_b'],
    // PUFFY mesh clouds — an entirely unclaimed sky identity.
    cloudStyle: 'puffy', cloudKeys: ['cloud_a', 'cloud_c', 'cloud_e', 'cloud_g', 'cloud_i'],
    // The wood: maple/oak/aspen/poplar carrying the fire, white-trunked
    // birches as accents that pop against it.
    treeKeys: ['tree_maple', 'tree_oak', 'tree_aspen', 'tree_poplar'],
    accentTreeKeys: ['tree_birch', 'tree_birch_b', 'tree_birch_c'],
    // Hedgerow fruit — the whole berry set has sat unused in the library.
    bushKeys: ['bush_berry', 'bush_currant', 'bush_raspberry', 'bush_forest_a', 'bush_forest_b'],
    blossomChance: 0,
    // Late-season beds: mum orange, barn red, marigold.
    gardenColors: ['#d9662e', '#c93b2a', '#e0a33a'],
    lushGrass: true,
    // The autumn ground has to read as GRASS gone over, not mud: the same
    // palette-driven fescue blades the prairie uses take their color from
    // theme.rough, so here they come out russet-gold. Meadow density, not
    // prairie density — this is a wooded course.
    heatherKeys: ['grass_g', 'grass_h'],
    tallGrass: { cap: 6, density: 18 },
    roughTuftHeight: 2.5,
    tuftDensity: 3.2,
    greenShadeGain: 10,
    stripeStrength: 1.15,
    mowPattern: 'diagonal', mowWidth: 26,
    greenMowPattern: 'checker',
    edgeWobble: 2.2,
    bunkerDepthScale: 1.4,
    atmosphere: 'forest'
  },
  holes: [
    {
      // Downhill through a maple corridor: the tee sits on a shoulder, the
      // fairway pours down the valley, and the wood lines both sides so the
      // fall color IS the corridor.
      number: 1, name: 'Sugar Maple', par: 4,
      world: { width: 1000, height: 1300 },
      tee: [500, 1160], teeBox: { w: 26, d: 18 },
      green: { cx: 470, cy: 300, rx: 62, ry: 50, rot: -0.2 },
      slope: { angle: 0.4, strength: 0.24 },
      centerline: [[500, 1130], [488, 990], [470, 850], [452, 700], [452, 560], [462, 430], [468, 360]],
      width: [52, 96, 122, 128, 118, 96, 60],
      hazards: [
        // The wood, both flanks, tight enough to frame and wide enough to
        // find a ball in.
        { type: 'trees', polygon: blob(268, 760, 120, 330, 16, 0.4, 71), spacing: 46 },
        { type: 'trees', polygon: blob(700, 720, 130, 340, 16, 0.42, 72), spacing: 46 },
        // Drive-zone bunker on the inside of the turn, green-front pair.
        { type: 'bunker', polygon: blob(540, 640, 30, 26, 10, 0.36, 73) },
        { type: 'bunker', polygon: blob(398, 352, 30, 24, 9, 0.34, 74) },
        { type: 'bunker', polygon: blob(546, 330, 26, 22, 9, 0.34, 75) }
      ],
      aiTargets: [[468, 690], [458, 470]],
      // The shoulder under the tee and a long soft valley: the DOWNHILL is the
      // hole's identity, so the drop reads from the very first camera.
      elevation: [
        { x: 500, y: 1160, h: 16, r: 230, shape: 'dome' },
        { x: 470, y: 640, h: -8, r: 320, shape: 'dome' },
        // Framing rises under each treeline, gentle enough that the wood
        // stays plantable ground (the rock-footprint rule's cousin).
        { x: 250, y: 760, h: 10, r: 260, shape: 'dome' },
        { x: 730, y: 700, h: 10, r: 260, shape: 'dome' }
      ],
      gardens: [{ x: 500, y: 1105, r: 26 }]
    },
    {
      // A one-shotter over a dark tarn. The water is the hole; the birch stand
      // behind the green is the backdrop the ball flies against.
      number: 2, name: 'Blackwater', par: 3,
      world: { width: 900, height: 800 },
      tee: [450, 660], teeBox: { w: 24, d: 16 },
      green: { cx: 458, cy: 320, rx: 58, ry: 48, rot: 0.15 },
      slope: { angle: 2.1, strength: 0.22 },
      centerline: [[450, 640], [452, 540], [456, 420]],
      width: [40, 46, 48],
      hazards: [
        // The tarn — one broad, still, nearly black sheet between tee and
        // green. Level authored a touch below grade so the banks read.
        { type: 'water', level: -2, polygon: blob(452, 500, 168, 96, 18, 0.3, 81, 0.25) },
        // Bail-out right feeds a bunker rather than the water.
        { type: 'bunker', polygon: blob(568, 388, 34, 26, 10, 0.36, 82) },
        { type: 'bunker', polygon: blob(392, 262, 28, 22, 9, 0.34, 83) },
        // The birch amphitheatre behind the green.
        { type: 'trees', polygon: blob(456, 140, 250, 90, 16, 0.38, 84), accent: true, spacing: 44 }
      ],
      aiTargets: [[520, 430]],
      elevation: [
        { x: 450, y: 680, h: 8, r: 170, shape: 'dome' },
        // The green sits on a low table so the surface stays flat and the
        // banks shed toward the water — pitch on, not bounce on.
        { x: 458, y: 315, h: 7, r: 150, shape: 'plateau', skirt: 0.72 }
      ],
      gardens: [{ x: 388, y: 640, r: 22 }]
    },
    {
      // The long climb: a par 5 working up a birch hillside, a creek cutting
      // the first landing, waste sand torn into the second, and a green on a
      // benched plateau you finish UP onto.
      number: 3, name: 'Birch Climb', par: 5,
      world: { width: 1050, height: 1400 },
      tee: [520, 1290], teeBox: { w: 26, d: 18 },
      green: { cx: 560, cy: 250, rx: 64, ry: 52, rot: 0.3 },
      slope: { angle: 5.6, strength: 0.26 },
      centerline: [[520, 1260], [510, 1120], [496, 980], [500, 840], [530, 700], [556, 560], [560, 430], [558, 330]],
      width: [50, 100, 118, 112, 124, 116, 96, 58],
      hazards: [
        // The creek, crossing the first landing at an angle — lay up or carry.
        { type: 'water', polygon: stream([[300, 1020], [430, 990], [560, 970], [700, 930]], 30, 91) },
        // Waste torn into the outside of the second landing.
        { type: 'bunker', waste: true, polygon: blob(690, 640, 84, 66, 13, 0.46, 92) },
        { type: 'bunker', polygon: blob(452, 610, 26, 22, 9, 0.34, 93) },
        // Green defenders, short-left and long-right.
        { type: 'bunker', polygon: blob(492, 316, 30, 24, 9, 0.34, 94) },
        { type: 'bunker', polygon: blob(636, 240, 28, 22, 9, 0.34, 95) },
        // The birch hillside, right of the climb the whole way.
        { type: 'trees', polygon: blob(830, 700, 140, 420, 18, 0.4, 96), accent: true, spacing: 48 },
        { type: 'trees', polygon: blob(210, 500, 120, 300, 16, 0.4, 97), spacing: 48 }
      ],
      aiTargets: [[500, 1050], [520, 720], [552, 440]],
      // The CLIMB: three rising steps, each gentle enough to walk a ball up,
      // finishing on a benched green plateau whose flat top holds the whole
      // putting surface (skirt 0.75 of r 240 = a 180-unit flat bench).
      elevation: [
        { x: 510, y: 1000, h: 8, r: 300, shape: 'dome' },
        { x: 540, y: 640, h: 14, r: 320, shape: 'dome' },
        { x: 560, y: 255, h: 22, r: 240, shape: 'plateau', skirt: 0.75 },
        // The hillside the birches stand on.
        { x: 860, y: 680, h: 14, r: 300, shape: 'dome' }
      ],
      gardens: [{ x: 462, y: 1240, r: 24 }]
    }
  ]
};

export default maplevale;
