// Wild Prairie (id wildvalley) — deterministic authoring module.
// Moved VERBATIM from gen-new-courses.mjs in the generator restructure;
// geometry is unchanged (output byte-identical).
import { blob } from '../courselib.mjs';

// (Course id stays 'wildvalley' for save/flag compatibility — only the
// visible name changed to Wild Prairie.)
const wildvalley = {
  name: 'Wild Prairie',
  version: 2,
  theme: {
    // NEBRASKA SAND HILLS identity — a WARM, sun-drenched, wide-open feel,
    // deliberately the opposite of Port Johnson's cold pewter Scottish links
    // (the two treeless grassland courses must NOT read the same). Warm golden
    // haze low on the sky, honey-gold fescue rough, pale warm sand, and a real
    // rolling SAND-DUNE horizon (peakKeys 'dunes_sandhill', tinted warm via
    // hillTint) instead of the old bare-sky 'none'.
    skyTop: '#5aa6e0', skyBottom: '#f4e6bd', sunX: 430, sunY: 110,
    fairway: '#83b84e', fairwayDark: '#6fa53f',
    rough: '#d8a94e', roughDark: '#bd8c34',
    fringe: '#9cbe54', green: '#71ae46', greenLight: '#8fca5b',
    sand: '#f4e7bb', sandDark: '#ddc789',
    water: '#3f86b0', waterDeep: '#276089',
    treeCanopy: '#5a6a34', treeCanopyLight: '#71833f', treeTrunk: '#7a6244',
    haze: '#f0e2b6', hazeStrength: 0.52,
    // Rolling sandhill horizon: DEEP ochre-gold tint (the peak material is
    // emissive-brightened, so a mid tan washed to snow-white — a saturated deep
    // gold lands as warm grassy sandhills instead).
    backdrop: 'peaks', peakKeys: ['dunes_sandhill'], hillTint: '#5f5626',
    cloudStyle: 'wispy', blossomChance: 0,
    // Playtest round 3: NO trees ("I don't think Wild Horse has trees
    // really") — open sand-hills horizon, golden fescue carries the look.
    treeKeys: [],
    bushKeys: [],
    // ONE APPROVED GRASS ASSET (vegetation correction pass): the golden
    // long-grass card already established around h1's big waste bunkers
    // (heather_fescue_b) is the ONLY grass card on this course — field
    // planting, fingers, bunker lips, sand plants AND the short ground
    // tufts (grassKeys override) all draw from it. Variation comes from the
    // existing per-instance jitter/scale/cluster noise, not other species.
    // (heather_fescue_c was the woody orange shrub, removed earlier;
    // heather_fescue_a goes with this pass.)
    heatherKeys: ['heather_fescue_b'],
    grassKeys: ['heather_fescue_b'],
    // Greens bake stronger contour shading (see CourseTexture.slopeShadeAt)
    // so their new crowns/ridges/feeding slopes read from approach cameras.
    greenShadeGain: 13,
    bunkerLipFescue: true,
    // Every bunker's edge packed with the golden fescue, and blowouts dug
    // into genuinely deep center-weighted bowls.
    bunkerLipPacked: true,
    // Dense native prairie: value-noise clustering (large continuous
    // patches, double-planted cores, fairway-edge grass fingers).
    prairieClusters: true,
    lushGrass: true,
    stripeStrength: 1.3,
    // ROUND 2 (owner, "like the Port Johnson ask"): thicken the native
    // fescue/heather banding lining the fairways — denser tall grass and
    // ground tufts (still the ONE approved card, heather_fescue_b; the
    // bounded world culls it beyond the corridor so the band reads tight).
    // Fewer fescue clumps overall (owner: "reduce the total fescue, render in
    // randomized clumps rather than everywhere") — density 33→22 so the value-
    // noise clustering reads as scattered strategic clumps, not a carpet.
    tallGrass: { cap: 8, density: 22, waste: true },
    roughTuftHeight: 1.9,
    tuftDensity: 3.3,
    sandPlantKeys: ['heather_fescue_b'],
    sandPlantStep: 80, sandPlantKeep: 0.5,
    sandSculpt: 0.85, bunkerDepthScale: 2.3, wasteDepthScale: 2.8,
    edgeWobble: 3.0, mowPattern: 'classic', mowWidth: 28,
    greenMowPattern: 'checker',
    atmosphere: 'none'
  },
  holes: [
    {
      number: 1, name: 'Blowout', par: 4,
      world: { width: 980, height: 1250 },
      tee: [470, 1130], teeBox: { w: 28, d: 20 },
      green: { cx: 510, cy: 300, rx: 64, ry: 52, rot: 0.25 },
      slope: { angle: 1.2, strength: 0.28 },
      // WILD PRAIRIE PASS — the split moved to the DRIVER landing zone.
      // Monte Carlo audit (60 seeded drives, 85-stat golfer): rest band
      // y 534–653, mean (475,593) = 269yd. The fairway balloons to 150
      // around that band and the hole bends visibly after the split.
      centerline: [[470, 1100], [460, 960], [455, 830], [462, 700], [472, 590], [468, 470], [496, 385]],
      width: [50, 84, 108, 128, 138, 92, 56],
      hazards: [
        // THE SPLIT: a deep central bunker in the actual drive zone —
        // ~26yd wide, fully inside the 75yd-wide fairway, leaving ~24yd of
        // legitimate fairway lane on BOTH sides (carry it, or pick a lane).
        { type: 'bunker', polygon: blob(472, 592, 26, 30, 12, 0.42, 49) },
        // Flank blowouts pressed against the drive zone's edges (torn from
        // the great ridge's flank right, the counter-ridge left).
        { type: 'bunker', waste: true, polygon: blob(626, 652, 90, 96, 14, 0.52, 41, 0.7) },
        { type: 'bunker', waste: true, polygon: blob(286, 668, 94, 116, 14, 0.5, 42) },
        // Short-of-the-zone blowout that eats a mishit drive.
        { type: 'bunker', waste: true, polygon: blob(610, 834, 80, 74, 13, 0.46, 45) },
        // Lay-up cross-pot inside the fairway's left half.
        { type: 'bunker', polygon: blob(440, 476, 18, 22, 9, 0.34, 48) },
        // Green-front defenders.
        { type: 'bunker', polygon: blob(442, 332, 36, 30, 9, 0.34, 43) },
        { type: 'bunker', polygon: blob(586, 340, 34, 26, 9, 0.34, 44) }
      ],
      aiTargets: [[440, 700], [478, 468]],
      // HERO: THE GREAT RIDGE — one huge wind-sculpted dune (h13) running
      // the whole right side, the fairway flowing down the broad valley at
      // its foot, a lower counter-ridge left, and edge dunes continuing the
      // system past every side. Blowouts are cut into the great ridge's
      // flank; the green is tucked where the valley pinches shut.
      elevation: [
        // ROUND 2 (owner): "elevation strong and clearly visible from the tee
        // on ALL holes — bring h1 up to Prairie h3's standard." The fairway
        // itself is snapshot-locked (approved), so the HILLS are strengthened
        // in the framing dunes that fill the tee's field of view: the great
        // ridge dominates the right skyline, the counter-ridge walls the left,
        // the back ridge stacks a dune wall behind the green, and the edge
        // dunes rise into big flanking sandhills.
        { x: 780, y: 1080, x2: 700, y2: 430, h: 18, r: 235 },
        { x: 190, y: 1000, x2: 290, y2: 480, h: 12, r: 185 },
        { x: 260, y: 105, x2: 790, y2: 140, h: 12, r: 160 },
        { x: 470, y: 1155, h: 6, r: 145, shape: 'plateau' },
        { x: 510, y: 292, h: 4, r: 112, shape: 'plateau' },
        // GREEN CONTOUR (correction pass): a diagonal spine ridge aligned
        // with the RIGHT-lane approach — play the right lane off the split
        // and you putt along it; come from the left lane and every approach
        // putt crosses it. Broad and fully puttable (~0.5 per 8px).
        { x: 478, y: 324, x2: 540, y2: 282, h: 1.4, r: 46 },
        // WILD PRAIRIE PASS — restored hilliness: cross-ridges roll the
        // fairway itself (a carry ridge before the split, a saddle through
        // the drive zone, dune shoulders pinching the approach) without
        // flattening the broad landing area.
        { x: 340, y: 890, x2: 620, y2: 856, h: 4.8, r: 105 },
        { x: 350, y: 800, x2: 600, y2: 760, h: 3.8, r: 95 },
        { x: 360, y: 660, x2: 400, y2: 640, h: 4.4, r: 80 },
        { x: 560, y: 640, x2: 600, y2: 600, h: 4.6, r: 85 },
        { x: 380, y: 545, x2: 640, y2: 590, h: 4.2, r: 100 },
        { x: 400, y: 430, x2: 430, y2: 415, h: 3.6, r: 70 },
        // PASS 10 (playtest: more visibly rolling): two more fairway waves.
        { x: 430, y: 1010, x2: 560, y2: 992, h: 4.0, r: 100 },
        { x: 440, y: 720, x2: 520, y2: 704, h: 3.8, r: 85 },
        // Edge dunes: the system continues beyond the playable frame — raised
        // into big flanking sandhills that read as strong relief from the tee.
        { x: 60, y: 700, x2: 100, y2: 200, h: 14, r: 165 },
        { x: 930, y: 820, x2: 960, y2: 300, h: 13, r: 185 },
        { x: 150, y: 1210, x2: 60, y2: 1000, h: 10, r: 145 }
      ],
    },
    {
      number: 2, name: 'The Kettle', par: 3,
      world: { width: 880, height: 920 },
      tee: [440, 760], teeBox: { w: 26, d: 18 },
      // KIDNEY-BEAN green (playtest: the flat par 3 had no challenge): two
      // lobes bending around a deep pot bunker tucked into the notch, with
      // the terrain tilting off the green INTO that bunker — a miss on the
      // fat side feeds down and gets caught.
      green: { cx: 400, cy: 440, rx: 62, ry: 50, rot: 0.3 },
      green2: { cx: 480, cy: 380, rx: 52, ry: 44, rot: 0.3 },
      slope: { angle: 3.1, strength: 0.34 },
      centerline: [[440, 600], [428, 530]],
      width: [56, 62],
      // WILD PRAIRIE PASS — pins favor the BACK-RIGHT (the green2 lobe):
      // the default pin and two of three rotations sit there; front-left
      // on the main lobe stays in the mix.
      pins: [[492, 372], [436, 424], [372, 456]],
      hazards: [
        // The notch bunker in the crook of the kidney — enlarged: it now
        // guards the direct line at the back-right pin.
        { type: 'bunker', depthMul: 1.7, polygon: blob(500, 470, 42, 36, 11, 0.32, 55) },
        // West-face pot, enlarged — it eats the "safe" bailout away from
        // the back-right pin.
        { type: 'bunker', depthMul: 1.6, polygon: blob(330, 486, 40, 34, 10, 0.32, 56) },
        // Blowouts pulled ONTO the approach dispersion: a push-right miss
        // feeds the east blowout; a pull/short-left finds the west one.
        // Both pressed against the kettle floor's edge, deep and ragged.
        { type: 'bunker', waste: true, polygon: blob(568, 502, 92, 88, 14, 0.52, 51) },
        { type: 'bunker', waste: true, polygon: blob(262, 566, 104, 122, 14, 0.52, 53) }
      ],
      aiTargets: [[400, 470]],
      // HERO: THE AMPHITHEATER — the kettle scaled to landform: a
      // horseshoe of 9.5-11-high dune walls enclosing the green (open only
      // at the front-right entrance), outer shoulders carrying the bowl's
      // rim past both edges, the green low on the bowl floor.
      // WILD PRAIRIE PASS: enclosing walls raised — the amphitheater reads
      // again from the tee (the putting surface untouched, gate-checked).
      elevation: [
        { x: 245, y: 565, x2: 235, y2: 360, h: 12.5, r: 140 },
        { x: 362, y: 250, x2: 488, y2: 228, h: 14, r: 155 },
        { x: 600, y: 330, x2: 615, y2: 470, h: 12.5, r: 130 },
        // Rim shoulders continuing the bowl beyond the frame — raised so the
        // dune walls read from the tee (owner: bring h2 to Prairie h3 standard).
        { x: 150, y: 250, x2: 60, y2: 600, h: 10, r: 160 },
        { x: 700, y: 250, x2: 800, y2: 550, h: 10, r: 160 },
        { x: 430, y: 420, h: 2, r: 150, shape: 'plateau' },
        { x: 352, y: 372, h: 1.6, r: 120 },
        // GREEN CONTOUR (correction pass): an interior shoulder wrapping the
        // back-right pin lobe — the preferred pin sits on its small flat,
        // guarded by real slope on every side (not by edge proximity), the
        // south falloff feeding toward the notch bunker.
        { x: 502, y: 352, x2: 522, y2: 392, h: 1.5, r: 46, shape: 'plateau', skirt: 0.55 },
        { x: 440, y: 780, h: 4.5, r: 135, shape: 'plateau' },
        { x: 150, y: 680, x2: 360, y2: 640, h: 6, r: 105 },
        { x: 520, y: 680, x2: 700, y2: 620, h: 6, r: 115 },
        // PASS 10 (playtest: more visibly rolling): an extra approach wave.
        { x: 320, y: 600, x2: 470, y2: 588, h: 4.0, r: 95 },
        // ROUND 2 (owner): foreground dunes flanking the tee so the near field
        // rolls immediately (not a flat run-up to a distant bowl) — visible
        // relief the moment you stand on the tee.
        { x: 300, y: 660, x2: 240, y2: 720, h: 8, r: 140 },
        { x: 580, y: 660, x2: 640, y2: 720, h: 8, r: 140 }
      ],
    },
    {
      number: 3, name: 'Sandbox', par: 5,
      world: { width: 1200, height: 1560 },
      tee: [400, 1440], teeBox: { w: 30, d: 22 },
      green: { cx: 760, cy: 330, rx: 62, ry: 50, rot: -0.3 },
      slope: { angle: 0.4, strength: 0.3 },
      // WILD PRAIRIE PASS: the S-curve deepened (LZ1 pushed left, the turn
      // to LZ2 sharpened) and every bunker re-audited against the Monte
      // Carlo dispersion: drives rest x521–560 / y956–1057, second shots
      // y450–606 — the traps now live exactly there.
      centerline: [[400, 1410], [420, 1270], [468, 1130], [540, 1010], [618, 878], [655, 750], [688, 620], [726, 500], [752, 420]],
      width: [54, 80, 96, 98, 118, 84, 70, 58, 48],
      hazards: [
        // LZ1 blowout pulled RIGHT AGAINST the fairway's left edge + deepened
        // (owner: "move the bunkers right against the fairway, make them deeper").
        { type: 'bunker', waste: true, depthMul: 1.35, polygon: blob(388, 1030, 80, 92, 15, 0.44, 61) },
        // THE WILD HORSE BUNKER (owner: "make the one on the right look like Wild
        // Horse's famous bunker") — a huge SPRAWLING native blowout with ragged
        // fingered edges, hard against the drive zone's right, dug deep.
        { type: 'bunker', waste: true, depthMul: 1.6, polygon: blob(728, 972, 80, 106, 17, 0.5, 71) },
        // The HERO blowout complex torn from the second ridge's face —
        // shifted onto the aggressive carry line over the ridge.
        { type: 'bunker', waste: true, polygon: blob(806, 914, 100, 110, 14, 0.52, 62) },
        { type: 'bunker', waste: true, polygon: blob(706, 1030, 70, 76, 13, 0.46, 73) },
        { type: 'bunker', waste: true, polygon: blob(820, 830, 82, 74, 13, 0.5, 74) },
        // Decision pot INSIDE the second landing zone (y450-606 band).
        { type: 'bunker', polygon: blob(722, 532, 18, 22, 10, 0.4, 75) },
        // Lay-up cross-pots at the corridor's left edge.
        { type: 'bunker', polygon: blob(676, 660, 24, 20, 10, 0.34, 63) },
        { type: 'bunker', polygon: blob(668, 692, 22, 18, 10, 0.3, 64) },
        // Green complex: a front cross-pot in the final fairway and the
        // right-side pot pressed against the green.
        { type: 'bunker', polygon: blob(742, 446, 20, 18, 9, 0.32, 72) },
        { type: 'bunker', polygon: blob(838, 362, 34, 26, 9, 0.34, 66) }
      ],
      aiTargets: [[468, 1130], [618, 874], [700, 600]],
      // HERO: THE BLOWOUT WALL — two mega-ridges crossing the hole, with
      // a giant three-bowl blowout complex torn out of the second ridge's
      // face at the aggressive line; the green rides high behind the last
      // ridge's shoulder, approach half-screened.
      elevation: [
        { x: 140, y: 1180, x2: 560, y2: 1060, h: 11, r: 210 },
        { x: 620, y: 960, x2: 1080, y2: 840, h: 12, r: 220 },
        { x: 300, y: 700, x2: 640, y2: 600, h: 7, r: 150 },
        { x: 560, y: 505, x2: 860, y2: 462, h: 10, r: 165 },
        { x: 400, y: 1460, h: 4, r: 140, shape: 'plateau' },
        { x: 760, y: 320, h: 6, r: 132, shape: 'plateau' },
        // GREEN CONTOUR (correction pass): the green continues the final
        // fairway ridge's roll — a broad front-left crown and a back-right
        // shelf on the same ENE axis, readable and fully puttable.
        { x: 742, y: 348, h: 1.0, r: 50 },
        { x: 790, y: 296, x2: 822, y2: 308, h: 1.3, r: 44, shape: 'plateau', skirt: 0.45 },
        // Edge dunes continuing both ridge systems.
        { x: 180, y: 400, x2: 420, y2: 330, h: 4.5, r: 130 },
        { x: 1050, y: 640, x2: 1130, y2: 330, h: 9, r: 170 },
        { x: 240, y: 1330, x2: 560, y2: 1290, h: 2.4, r: 100 },
        { x: 80, y: 900, x2: 140, y2: 620, h: 6, r: 140 }
      ],
    }
  ]
};
export { wildvalley };
