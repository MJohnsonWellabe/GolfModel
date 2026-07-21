// PORT JOHNSON LINKS v2 — teardown/rebuild variant with the FULL SCOTTISH
// TURN (owner decision 2026-07-20). Emitted to src/data/courses/v2/
// portjohnson.json, loaded only behind `courseRebuilds` (dev).
//
// KEEP (owner keep-list — the bunkers that come into play):
//   - h1 "Harbour Mouth": the revetted POT MINEFIELD through the lay-up and
//     approach bands — staggered pairs and clusters straddling the lane.
//   - h3 "The Old Wall": the diagonal WALL of revetted pots cutting the
//     final leg, plus the waste chain guarding the inside shortcut.
// TEARDOWN (everything else): all-new rumpled links terrain, a proper Redan
// h2, and the Scottish weather identity — pewter overcast sky, heavy haze,
// heather-dominant rough, cold slate water. (A true drizzle/rain effect is
// an atmosphere-system follow-up; the palette + haze carry the turn now.)
import { readFileSync } from 'node:fs';
import { blob } from '../courselib.mjs';

const legacyTheme = JSON.parse(readFileSync('src/data/courses/portjohnson.json', 'utf8')).theme;
const pot = (cx, cy, r, seed) => ({ type: 'bunker', wall: true, polygon: blob(cx, cy, r, r * 0.82, 9, 0.25, seed) });

const portjohnsonV2 = {
  name: 'Port Johnson Links',
  version: 2,
  minWind: 20,
  maxWind: 30,
  theme: {
    ...legacyTheme,
    // THE SCOTTISH TURN — pewter overcast, heavy sea haze, cold water,
    // heather pushing through the fescue.
    skyTop: '#7d8fa0',
    skyBottom: '#ccd3d6',
    haze: '#c7ced2',
    hazeStrength: 0.64,
    horizonTint: '#b9c4c9',
    cloudStyle: 'wispy',
    water: '#41616f',
    waterDeep: '#293e47',
    rough: '#8a8557',
    roughDark: '#6d683f',
    // Heather-dominant rough: purple leads the mix.
    heatherKeys: ['heather_purple', 'heather_fescue_a', 'heather_purple', 'heather_fescue_c'],
    // Dense links fescue: the rough that flanks every fairway now packs a thick
    // wall of heather/fescue (was sparse density 8.5) so a thick band hugs both
    // sides of the short grass — the "thick stuff" that used to live only around
    // the bunker lips now carpets the whole rough. bunkerLipPacked lines every
    // trap edge to match.
    tallGrass: { cap: 8, density: 40, waste: true },
    bunkerLipPacked: true
  },
  holes: [
    // ---------------------------------------------- h1 "Harbour Mouth" par 4
    // Dead into the harbor wind. The KEPT pot minefield straddles the lane
    // from the lay-up band to the green apron — there is no bunker-free
    // driving line, only lanes between pots. The front of the big rolling
    // green stays open: the running approach is the play, the pots punish
    // the lazy line into it.
    {
      number: 1,
      name: 'Harbour Mouth',
      par: 4,
      world: { width: 1000, height: 1320 },
      tee: [500, 1170],
      teeBox: { w: 32, d: 24 },
      green: { cx: 500, cy: 300, rx: 96, ry: 70, rot: 0.3 },
      slope: { angle: 2.2, strength: 0.34 },
      centerline: [[500, 1140], [498, 980], [506, 810], [522, 640], [512, 470], [502, 360]],
      width: [50, 86, 92, 78, 64, 52],
      hazards: [
        // The harbor along the right — cold slate water, the working edge.
        {
          type: 'water',
          polygon: [
            [742, 480], [980, 440], [980, 830], [760, 800], [700, 720], [688, 600], [712, 520]
          ]
        },
        // Drive-band flank bunkers (plain sand, escapable at full length).
        { type: 'bunker', polygon: blob(408, 900, 26, 19, 9, 0.35, 911) },
        { type: 'bunker', polygon: blob(598, 762, 24, 18, 9, 0.35, 912) },
        // THE MINEFIELD (kept pattern): a marching field of revetted pots
        // through the lay-up and approach bands.
        pot(502, 726, 13, 913),
        pot(540, 706, 11, 914),
        pot(470, 688, 11, 915),
        pot(446, 610, 12, 916),
        pot(590, 648, 12, 917),
        pot(520, 586, 11, 918),
        pot(452, 452, 12, 919),
        pot(570, 438, 12, 920),
        // Greenside: one deep pot left, cut into the shelf.
        pot(392, 328, 14, 921)
      ],
      aiTargets: [[470, 812], [500, 540], [496, 392]],
      elevation: [
        // Rumpled linksland — long low dune rolls, no walls anywhere.
        { x: 500, y: 1170, h: 1.6, r: 120, shape: 'plateau' },
        { x: 340, y: 1010, x2: 296, y2: 620, h: 3.2, r: 120 },
        { x: 690, y: 1120, x2: 740, y2: 840, h: 3.4, r: 130 },
        { x: 430, y: 860, h: 1.4, r: 90 },
        { x: 580, y: 560, h: 1.2, r: 80 },
        // PRONOUNCED ROLLING HILLS through the driving/approach corridor —
        // alternating crests and hollows so the ground heaves the whole way to
        // the green (no walls: broad r, gentle faces).
        { x: 612, y: 1040, h: 3.6, r: 130 },
        { x: 388, y: 950, h: 3.2, r: 120 },
        { x: 500, y: 900, h: -1.6, r: 110 },
        { x: 606, y: 792, h: 2.8, r: 110 },
        { x: 402, y: 700, h: 3.4, r: 120 },
        { x: 520, y: 636, h: -1.3, r: 95 },
        { x: 596, y: 540, h: 2.8, r: 110 },
        { x: 404, y: 486, h: 2.4, r: 100 },
        // The green shelf: barely raised, front OPEN for the runner, with a
        // gentle rolling swale inside the putting surface.
        { x: 500, y: 300, h: 1.4, r: 150, shape: 'plateau', skirt: 0.55 },
        { x: 462, y: 268, h: 0.8, r: 60 },
        { x: 548, y: 330, h: -0.6, r: 55 },
        // The land tips toward the harbor.
        { x: 800, y: 640, h: -1.2, r: 160 }
      ]
    },
    // -------------------------------------------------- h2 "The Redan" par 3
    // A true Redan now: the long green angles away right-to-front-left
    // behind a deep revetted Redan pot; the right-side kicker bank is the
    // smart line — land it there and the ground feeds the ball the length
    // of the green. Fly at the pin and the pot or the fall-away collects.
    {
      number: 2,
      name: 'The Redan',
      par: 3,
      world: { width: 940, height: 940 },
      tee: [460, 790],
      teeBox: { w: 30, d: 22 },
      green: { cx: 470, cy: 300, rx: 98, ry: 62, rot: -0.5 },
      // Hillier Redan green: a stronger authored break plus the front-swale /
      // back-knob contour below make the surface read distinctly tiered.
      slope: { angle: 3.8, strength: 0.52 },
      centerline: [[460, 770], [464, 620], [470, 500]],
      width: [40, 56, 64],
      hazards: [
        // THE Redan pot — deep, revetted, front-left shoulder of the green.
        pot(398, 362, 17, 931),
        // Supporting pots: back-left for the long miss, short-right under
        // the kicker for the timid bail.
        pot(336, 244, 12, 932),
        pot(586, 396, 12, 933),
        // Heather waste field left of the line — the wild side.
        { type: 'bunker', waste: true, polygon: blob(292, 470, 58, 88, 12, 0.3, 934) },
        // Cold slate lochan biting the far-left approach.
        { type: 'water', polygon: [[120, 420], [230, 400], [268, 470], [246, 570], [140, 590], [96, 500]] }
      ],
      aiTargets: [[470, 540]],
      elevation: [
        { x: 460, y: 810, h: 1.8, r: 110, shape: 'plateau' },
        // The kicker bank right of the green — the Redan's feeding slope.
        { x: 618, y: 424, x2: 548, y2: 330, h: 2.8, r: 95 },
        // The green shelf tilts with the hole (right-to-left, front-to-back
        // handled by slope); behind-left falls away.
        { x: 470, y: 300, h: 1.2, r: 130, shape: 'plateau', skirt: 0.55 },
        { x: 380, y: 210, h: -1.4, r: 90 },
        // HILLIER GREEN SURFACE: a raised back-right knob and a front hollow
        // give the putting surface a real upper/lower tier (kept gentle so the
        // spoke-step + relief puttability gates still pass).
        { x: 500, y: 262, h: 1.35, r: 52 },
        { x: 440, y: 340, h: -0.85, r: 50 },
        // ROLLING HILLS short of the green so the whole approach heaves; a
        // long-iron runner bounces alive over them.
        { x: 470, y: 560, h: 1.1, r: 85 },
        { x: 420, y: 470, h: -0.8, r: 70 },
        { x: 560, y: 680, h: 3.0, r: 120 },
        { x: 362, y: 620, h: 2.6, r: 110 },
        { x: 470, y: 650, h: -1.2, r: 90 },
        { x: 566, y: 520, h: 2.2, r: 95 },
        { x: 372, y: 470, h: 2.2, r: 92 }
      ]
    },
    // ------------------------------------------------ h3 "The Old Wall" par 5
    // The KEPT idea, sharpened: the ruined field wall became a diagonal line
    // of revetted pots marching up the final rise — cross it where you dare.
    // The waste chain still guards the inside shortcut on the second leg,
    // and the sea cliff owns the left of the drive.
    {
      number: 3,
      name: 'The Old Wall',
      par: 5,
      world: { width: 1320, height: 1640 },
      tee: [360, 1540],
      teeBox: { w: 32, d: 24 },
      green: { cx: 720, cy: 360, rx: 104, ry: 72, rot: 0.4 },
      slope: { angle: 2.8, strength: 0.34 },
      fairways: [
        { centerline: [[360, 1510], [406, 1330], [520, 1180], [672, 1082]], width: [52, 94, 102, 90] },
        { centerline: [[672, 1082], [652, 900], [556, 756], [472, 644]], width: [90, 84, 78, 66] },
        { centerline: [[472, 644], [544, 516], [652, 428], [714, 372]], width: [66, 62, 56, 50] }
      ],
      hazards: [
        // Sea cliff along the left of the drive (kept concept).
        {
          type: 'water', cliff: true,
          polygon: [[60, 880], [236, 900], [280, 1000], [268, 1130], [220, 1250], [80, 1280]]
        },
        // LEFT bunker row — MOVED IN to hug the fairway's left edge (was set
        // well left of the short grass) so it truly pinches the inside line.
        { type: 'bunker', waste: true, polygon: blob(433, 616, 34, 26, 10, 0.35, 941) },
        { type: 'bunker', waste: true, polygon: blob(459, 704, 36, 28, 10, 0.35, 942) },
        { type: 'bunker', waste: true, polygon: blob(519, 794, 38, 30, 10, 0.35, 943) },
        { type: 'bunker', waste: true, polygon: blob(588, 900, 36, 28, 10, 0.35, 944) },
        // RIGHT bunker row — a MIRRORED chain hugging the fairway's right edge,
        // symmetric to the left row about the fairway centerline (a matching
        // gauntlet up the second leg).
        { type: 'bunker', waste: true, polygon: blob(543, 616, 34, 26, 10, 0.35, 955) },
        { type: 'bunker', waste: true, polygon: blob(575, 704, 36, 28, 10, 0.35, 956) },
        { type: 'bunker', waste: true, polygon: blob(643, 794, 38, 30, 10, 0.35, 957) },
        { type: 'bunker', waste: true, polygon: blob(716, 900, 36, 28, 10, 0.35, 958) },
        // Inside-corner waste at the first turn + outside catcher.
        { type: 'bunker', waste: true, polygon: blob(548, 1030, 42, 30, 10, 0.35, 945) },
        { type: 'bunker', waste: true, polygon: blob(784, 1060, 38, 28, 10, 0.35, 946) },
        // THE OLD WALL (kept pattern): revetted pots marching diagonally
        // across the final leg's rise.
        pot(500, 588, 13, 947),
        pot(560, 520, 12, 948),
        pot(622, 462, 12, 949),
        pot(682, 410, 12, 950),
        // Greenside garrison: right and short-left.
        pot(822, 470, 13, 951),
        pot(636, 330, 12, 952)
      ],
      // A LIGHTHOUSE on the headland terrace just inland of the sea cliff (CC0
      // Kenney prop, upright) — the coastal landmark that crowns the drive view.
      // Lighthouse on the raised dune terrace above the sea cliff — pulled onto
      // solid high ground and enlarged so it actually reads from the tee/drive
      // (the earlier [300,1030] len 52 sat low/off the sightline, invisible).
      props: [{ key: 'lighthouse', x: 336, y: 1000, rot: 0.5, len: 74, upright: true }],
      aiTargets: [[420, 1300], [600, 1120], [640, 920], [500, 660], [604, 468]],
      elevation: [
        { x: 360, y: 1540, h: 2.6, r: 130, shape: 'plateau' },
        // Leg 1 rides a dune terrace above the sea cliff.
        { x: 480, y: 1240, h: 2.4, r: 180, shape: 'plateau', skirt: 0.4 },
        // ROLLING HILLS filling the flat-looking opening — alternating crests
        // and hollows right in the tee view so leg 1 heaves instead of lying
        // flat (broad r, gentle faces — no walls).
        { x: 560, y: 1430, h: 3.4, r: 150 },
        { x: 300, y: 1360, h: 3.0, r: 140 },
        { x: 452, y: 1380, h: -1.6, r: 120 },
        { x: 600, y: 1210, h: 3.2, r: 150 },
        { x: 296, y: 1150, h: 3.0, r: 140 },
        { x: 470, y: 1120, h: -1.4, r: 120 },
        // Leg 2 drops through a valley — the low ground before the wall.
        { x: 580, y: 810, h: -1.5, r: 160 },
        // The wall's rise: the diagonal ridge the pots march along.
        { x: 470, y: 640, x2: 700, y2: 420, h: 2.6, r: 105 },
        // Green shelf at the top of the rise, front-right door open.
        { x: 720, y: 360, h: 3.0, r: 150, shape: 'plateau', skirt: 0.55 },
        // Framing dunes: right of leg 1, behind the green.
        { x: 900, y: 1300, x2: 1020, y2: 900, h: 4.0, r: 150 },
        { x: 900, y: 260, x2: 1080, y2: 420, h: 3.2, r: 120 },
        // The sea side falls off left.
        { x: 200, y: 1080, h: -1.6, r: 140 }
      ]
    }
  ]
};

export { portjohnsonV2 };
