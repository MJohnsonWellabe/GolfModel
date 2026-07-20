// WILDWOOD GLEN v2 — teardown/rebuild variant (dev-environment roadmap,
// owner directive 2026-07-20). Emitted to src/data/courses/v2/wildwood.json,
// loaded only behind `courseRebuilds` (dev). No keep-list on this course —
// a full redesign to the approved Bible identity: "championship parkland in
// bloom — broadleaf woods, azalea/cherry blossom, garden beds at decision
// corners, tree-framed doglegs; angles are the difficulty: trees block the
// lazy line, blocked recoveries punish greed."
import { readFileSync } from 'node:fs';
import { blob, stream } from '../courselib.mjs';

const legacyTheme = JSON.parse(readFileSync('src/data/courses/wildwood.json', 'utf8')).theme;

const wildwoodV2 = {
  name: 'Wildwood Glen',
  version: 2,
  theme: legacyTheme, // broadleaf + blossom + pink/white gardens already match
  holes: [
    // ---------------------------------------------- h1 "Azalea Bend" par 4
    // A tree-framed dogleg LEFT around a blossoming corner. The lazy line is
    // blocked by the corner woods; carry the corner bunker at the azalea
    // bend and the approach opens straight up the green. A creek crosses the
    // approach — the second decision.
    {
      number: 1,
      name: 'Azalea Bend',
      par: 4,
      world: { width: 900, height: 1320 },
      tee: [450, 1150],
      teeBox: { w: 30, d: 22 },
      green: { cx: 385, cy: 330, rx: 56, ry: 42, rot: 0.45 },
      slope: { angle: 2.4, strength: 0.3 },
      centerline: [[450, 1120], [452, 990], [440, 850], [400, 730], [352, 620], [332, 500], [352, 400], [378, 356]],
      width: [40, 52, 72, 84, 78, 62, 52, 44],
      hazards: [
        // The creek — winds across the approach and slides down the right
        // of the green complex.
        { type: 'water', polygon: stream([[172, 470], [300, 452], [420, 428], [510, 400], [560, 330], [575, 240]], 26, 1011) },
        // Corner bunker at the inside of the bend — the aggressive carry.
        { type: 'bunker', polygon: blob(300, 640, 30, 22, 10, 0.35, 1012) },
        // White-sand greenside pair: short-right at the creek side, long-left.
        { type: 'bunker', polygon: blob(452, 392, 20, 15, 9, 0.3, 1013) },
        { type: 'bunker', polygon: blob(322, 268, 18, 14, 9, 0.3, 1014) },
        // The framing woods: a full right wall, the corner stand inside the
        // bend, and the amphitheater behind the green.
        { type: 'trees', spacing: 42, visualSpacing: 24, polygon: [[560, 1010], [660, 960], [700, 800], [680, 620], [640, 480], [560, 560], [540, 760]] },
        { type: 'trees', spacing: 40, visualSpacing: 22, polygon: [[150, 900], [270, 850], [300, 740], [240, 660], [140, 700], [110, 820]] },
        { type: 'trees', spacing: 44, visualSpacing: 26, polygon: [[180, 560], [252, 540], [262, 440], [200, 400], [130, 440], [130, 520]] },
        { type: 'trees', spacing: 56, visualSpacing: 40, polygon: [[240, 220], [420, 150], [600, 170], [640, 280], [520, 300], [300, 290]] },
        // Blossom color (art only): the azalea corner and the green backdrop.
        { type: 'trees', blossom: true, visualOnly: true, spacing: 32, visualSpacing: 30, polygon: blob(310, 700, 60, 40, 8, 0.3, 1015) },
        { type: 'trees', blossom: true, visualOnly: true, spacing: 32, visualSpacing: 30, polygon: blob(330, 230, 70, 36, 8, 0.3, 1016) }
      ],
      aiTargets: [[440, 800], [345, 555], [360, 420]],
      gardens: [
        { cx: 302, cy: 610, rx: 34, ry: 20, rot: -0.5, density: 12 },
        { cx: 452, cy: 296, rx: 40, ry: 20, rot: 0.4, density: 12 }
      ],
      elevation: [
        { x: 450, y: 1150, h: 1.8, r: 120, shape: 'plateau' },
        // The glen: fairway rolls down into the bend, then rises to the green.
        { x: 445, y: 900, h: 1.6, r: 150 },
        { x: 330, y: 640, h: 2.2, r: 110 },
        // Creek valley — the low ground the approach carries.
        { x: 460, y: 440, h: -1.3, r: 110 },
        // Raised green pad with a garden shelf behind.
        { x: 385, y: 330, h: 1.8, r: 110, shape: 'plateau', skirt: 0.5 },
        { x: 380, y: 220, h: 2.6, r: 100 },
        // Parkland shoulders under the framing woods.
        { x: 660, y: 800, h: 2.8, r: 130 },
        { x: 160, y: 780, h: 2.4, r: 120 }
      ]
    },
    // -------------------------------------------- h2 "The Garden Gate" par 3
    // The postcard hole: a wide, shallow green directly over a pond, gardens
    // on both flanks, a blossom amphitheater behind. One swing — carry it or
    // wet it; the thin front bunker is the merciful catch.
    {
      number: 2,
      name: 'The Garden Gate',
      par: 3,
      world: { width: 900, height: 1090 },
      tee: [450, 900],
      teeBox: { w: 30, d: 22 },
      green: { cx: 450, cy: 470, rx: 60, ry: 36, rot: 0 },
      slope: { angle: 1.6, strength: 0.3 },
      centerline: [[450, 880], [450, 790], [450, 700]],
      width: [40, 48, 44],
      hazards: [
        // The pond — the whole front door.
        { type: 'water', polygon: [[262, 545], [430, 528], [620, 542], [660, 610], [630, 680], [470, 706], [300, 690], [246, 620]] },
        // Thin catching bunker between pond and green (the mercy).
        { type: 'bunker', polygon: [[368, 516], [536, 516], [548, 540], [352, 540]] },
        // Back-left pot for the scared long miss.
        { type: 'bunker', polygon: blob(392, 414, 18, 13, 9, 0.3, 1021) },
        // Framing woods either side + the blossom amphitheater behind.
        { type: 'trees', spacing: 40, visualSpacing: 22, polygon: [[180, 720], [280, 680], [300, 540], [240, 440], [140, 480], [120, 620]] },
        { type: 'trees', spacing: 40, visualSpacing: 22, polygon: [[620, 720], [720, 680], [760, 540], [700, 430], [600, 470], [590, 620]] },
        { type: 'trees', blossom: true, visualOnly: true, spacing: 28, visualSpacing: 28, polygon: [[300, 380], [450, 330], [610, 375], [560, 300], [340, 300]] }
      ],
      aiTargets: [[450, 740]],
      // Lay-up apron short of the pond — the designed bail, kept detailed.
      recoveryZones: [[[380, 720], [520, 720], [520, 800], [380, 800]]],
      gardens: [
        { cx: 330, cy: 452, rx: 30, ry: 18, rot: 0.5, density: 12 },
        { cx: 570, cy: 452, rx: 30, ry: 18, rot: -0.5, density: 12 },
        { cx: 450, cy: 372, rx: 44, ry: 18, rot: 0, density: 14 }
      ],
      elevation: [
        { x: 450, y: 920, h: 2.2, r: 120, shape: 'plateau' },
        // The green pad rises just clear of the water; banks feed the pond.
        { x: 450, y: 452, h: 1.2, r: 105, shape: 'plateau', skirt: 0.55 },
        { x: 450, y: 620, h: -1.0, r: 120 },
        // Amphitheater rise behind.
        { x: 450, y: 320, h: 2.8, r: 130 },
        { x: 230, y: 560, h: 2.2, r: 110 },
        { x: 680, y: 560, h: 2.2, r: 110 }
      ]
    },
    // -------------------------------------------- h3 "Wisteria Walk" par 5
    // A double dogleg through the old wood. Two blocked corners ask the
    // angle question twice; the pond by the final turn punishes the greedy
    // second shot going for the green. Gardens light each corner.
    {
      number: 3,
      name: 'Wisteria Walk',
      par: 5,
      world: { width: 1000, height: 1620 },
      tee: [640, 1510],
      teeBox: { w: 32, d: 24 },
      green: { cx: 380, cy: 300, rx: 62, ry: 46, rot: 0.35 },
      slope: { angle: 2.9, strength: 0.32 },
      fairways: [
        { centerline: [[640, 1480], [648, 1330], [640, 1180], [600, 1040]], width: [40, 62, 82, 76] },
        { centerline: [[600, 1040], [540, 900], [472, 770], [432, 650]], width: [76, 70, 66, 60] },
        { centerline: [[432, 650], [402, 520], [384, 400], [380, 344]], width: [60, 54, 46, 40] }
      ],
      hazards: [
        // The pond at the final corner — the going-for-it price.
        { type: 'water', polygon: [[236, 380], [330, 396], [352, 470], [340, 560], [260, 590], [190, 540], [176, 440]] },
        // First-corner bunker (inside line off the tee).
        { type: 'bunker', polygon: blob(520, 1010, 30, 22, 10, 0.35, 1031) },
        // Cross bunker at the second corner's lay-up, off the recovery line.
        { type: 'bunker', polygon: blob(530, 690, 26, 19, 9, 0.35, 1032) },
        // Greenside: front-right white sand; the pond owns the left.
        { type: 'bunker', polygon: blob(462, 356, 22, 16, 9, 0.3, 1033) },
        // The old wood: right wall down the drive, the inside block that
        // forces the S, and the backdrop stand.
        { type: 'trees', spacing: 42, visualSpacing: 24, polygon: [[730, 1400], [830, 1330], [850, 1150], [800, 1000], [720, 1080], [710, 1260]] },
        { type: 'trees', spacing: 40, visualSpacing: 22, polygon: [[560, 620], [640, 560], [660, 430], [600, 350], [530, 420], [520, 540]] },
        { type: 'trees', spacing: 44, visualSpacing: 26, polygon: [[300, 900], [380, 850], [390, 730], [330, 680], [240, 720], [230, 840]] },
        { type: 'trees', spacing: 56, visualSpacing: 40, polygon: [[180, 240], [360, 160], [560, 190], [600, 300], [480, 260], [260, 320]] },
        // Wisteria/blossom color at both corners (art only).
        { type: 'trees', blossom: true, visualOnly: true, spacing: 30, visualSpacing: 28, polygon: blob(660, 980, 60, 40, 8, 0.3, 1034) },
        { type: 'trees', blossom: true, visualOnly: true, spacing: 30, visualSpacing: 28, polygon: blob(500, 590, 50, 34, 8, 0.3, 1035) }
      ],
      aiTargets: [[636, 1180], [578, 970], [462, 730], [408, 500]],
      gardens: [
        { cx: 560, cy: 1060, rx: 36, ry: 20, rot: -0.4, density: 12 },
        { cx: 476, cy: 636, rx: 32, ry: 18, rot: 0.5, density: 12 },
        { cx: 300, cy: 264, rx: 40, ry: 20, rot: 0.3, density: 14 }
      ],
      elevation: [
        { x: 640, y: 1510, h: 2.0, r: 130, shape: 'plateau' },
        // The meadow rolls: each leg has its own gentle rise and fall.
        { x: 640, y: 1250, h: 1.8, r: 170 },
        { x: 560, y: 940, h: 2.4, r: 150 },
        { x: 450, y: 700, h: 1.4, r: 130 },
        // Pond hollow and the raised final green.
        { x: 270, y: 480, h: -1.4, r: 120 },
        { x: 380, y: 300, h: 2.0, r: 115, shape: 'plateau', skirt: 0.5 },
        // Wooded shoulders.
        { x: 800, y: 1180, h: 3.0, r: 140 },
        { x: 600, y: 480, h: 2.6, r: 120 },
        { x: 380, y: 180, h: 3.0, r: 130 }
      ]
    }
  ]
};

export { wildwoodV2 };
