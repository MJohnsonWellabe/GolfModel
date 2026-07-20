// TIMBERLINE v2 — teardown/rebuild variant (dev-environment roadmap Phase 4/5,
// owner directive 2026-07-20). Emitted to src/data/courses/v2/timberline.json
// and loaded ONLY behind the `courseRebuilds` flag (dev). Production keeps the
// shipped original.
//
// KEEP (owner keep-list — referenced from the legacy JSON, not re-typed, so
// the liked geometry is preserved exactly):
//   - h1 "Pine Alley" + h3 "The Gauntlet": fairway routing (ribbons), ALL
//     tree stands, and the water bodies that shape those routings.
//   - h2 "The Hollow": the greenside SPECIMEN TREE (and the framing woods —
//     this is a forest course; the trees are the strategy).
// TEARDOWN/REBUILD (everything else):
//   - Elevation: the legacy ~100-random-bumps noise field is replaced with a
//     landform-first alpine design — the hole is cut into a mountainside,
//     one hero feature per hole, benches that climb, a coherent fall line.
//   - Bunkers: fewer, deeper, only at pinch points (Bible bunker language).
//   - Green contours/slopes: readable, terrain-grown, puttable.
//   - The h2 garden bed is retired (formal gardens are Wildwood's language;
//     prohibited on Timberline per the approved Course Design Bible).
import { readFileSync } from 'node:fs';
import { blob } from '../courselib.mjs';

const legacy = JSON.parse(readFileSync('src/data/courses/timberline.json', 'utf8'));
const L = (n) => legacy.holes[n - 1];
const keepTrees = (h) => h.hazards.filter((z) => z.type === 'trees');
const keepWater = (h) => h.hazards.filter((z) => z.type === 'water');
const centroidOf = (poly) => {
  let sx = 0, sy = 0;
  for (const [x, y] of poly) { sx += x; sy += y; }
  return [sx / poly.length, sy / poly.length];
};
// Legacy fairway ribbons ({centerline,width}) pass straight into the emitter.
const keepFairways = (h) => h.fairway.map((f) => ({ centerline: f.centerline, width: f.width }));

// h1's pond (its only water body) anchors the east fall-away.
const [pondX, pondY] = centroidOf(keepWater(L(1))[0].polygon);
// h2's specimen tree (treeR guard by the green) anchors its front-right pot.
const specimen = L(2).hazards.find((z) => z.type === 'trees' && z.treeR);
const [specX, specY] = centroidOf(specimen.polygon);

const timberlineV2 = {
  name: 'Timberline',
  version: 2,
  theme: {
    ...legacy.theme,
    // Granite accents: alpine stone joins the forest-floor scatter mix —
    // the Bible's "granite outcrops as accents" without new systems.
    scatterKeys: [...new Set([...(legacy.theme.scatterKeys ?? []), 'stone_d', 'stone_e'])]
  },
  holes: [
    // ------------------------------------------------ h1 "Pine Alley" par 4
    // The alley is CUT INTO A HILLSIDE: a long forested shoulder climbs the
    // whole west flank (the hero landform), the fairway benches upward to a
    // green terrace, and the east side falls away to the pond. Strategy:
    // hug the high (left) side for the flat stance and the open look; bail
    // right and the ball feeds toward the low pond side.
    {
      number: 1,
      name: 'Pine Alley',
      par: 4,
      world: L(1).world,
      tee: [L(1).tee.x, L(1).tee.y],
      teeBox: L(1).teeBox,
      green: L(1).green,
      slope: { angle: 1.9, strength: 0.3 },
      centerline: L(1).fairway[0].centerline,
      width: L(1).fairway[0].width,
      fairways: keepFairways(L(1)),
      hazards: [
        // Drive pinch, right edge of the landing zone: carry it or lay back —
        // the ONLY sand between tee and green complex (fewer, deeper).
        { type: 'bunker', depthMul: 1.3, polygon: blob(526, 748, 30, 21, 10, 0.35, 711) },
        // Deep pot cut into the green terrace, short-left, guarding the
        // high-side approach line the hole rewards.
        { type: 'bunker', depthMul: 1.5, polygon: blob(242, 286, 17, 13, 9, 0.3, 712) },
        ...keepTrees(L(1)),
        ...keepWater(L(1))
      ],
      aiTargets: [[452, 760], [372, 396]],
      elevation: [
        // Tee terrace.
        { x: L(1).tee.x, y: L(1).tee.y, h: 1.8, r: 130, shape: 'plateau' },
        // HERO: the west shoulder — one continuous forested hillside ridge
        // running the length of the alley, two tiers.
        { x: 150, y: 980, x2: 112, y2: 330, h: 7, r: 170 },
        { x: 52, y: 720, x2: 30, y2: 210, h: 11, r: 150 },
        // The fairway benches: a mid-alley rise, then the upper bench that
        // carries into the green terrace.
        { x: 452, y: 758, h: 2.2, r: 150 },
        { x: 408, y: 520, h: 3.2, r: 160 },
        // Green terrace + the rising forest backstop behind it.
        { x: L(1).green.cx, y: L(1).green.cy, h: 2.6, r: 112, shape: 'plateau', skirt: 0.35 },
        { x: 218, y: 208, x2: 336, y2: 168, h: 3.6, r: 112 },
        // East fall-away: the land drains toward the pond.
        { x: pondX, y: pondY, h: -2.4, r: 150 },
        { x: 640, y: 560, x2: 700, y2: 300, h: -1.8, r: 140 }
      ]
    },
    // ------------------------------------------------ h2 "The Hollow" par 3
    // A true hollow now: elevated tee, sunken dell green ringed by rim
    // ridges and conifers, the kept SPECIMEN TREE guarding the front-right
    // door. Miss long and the bowl's back wall gives you a shot back — an
    // authored recovery zone keeps that shelf detailed and in-bounds.
    {
      number: 2,
      name: 'The Hollow',
      par: 3,
      world: L(2).world,
      tee: [L(2).tee.x, L(2).tee.y],
      teeBox: L(2).teeBox,
      green: L(2).green,
      slope: { angle: 0.8, strength: 0.28 },
      centerline: L(2).fairway[0].centerline,
      width: L(2).fairway[0].width,
      fairways: keepFairways(L(2)),
      hazards: [
        // Front-right pot under the specimen tree: the tree takes the air,
        // the sand takes the ground — one guarded door.
        {
          type: 'bunker',
          depthMul: 1.4,
          polygon: blob((specX + L(2).green.cx) / 2, (specY + L(2).green.cy) / 2 + 26, 18, 13, 9, 0.3, 721)
        },
        // Long-left pot at the bowl's base, catching the draw that rides the
        // left rim down.
        { type: 'bunker', depthMul: 1.4, polygon: blob(392, 386, 16, 12, 8, 0.3, 722) },
        ...keepTrees(L(2))
      ],
      aiTargets: [],
      recoveryZones: [
        // The back-wall shelf behind the green: playable, detailed, fair.
        [[386, 322], [540, 322], [548, 402], [378, 402]]
      ],
      elevation: [
        // Elevated tee terrace — the drop into the dell is the tee-shot view.
        { x: L(2).tee.x, y: 762, h: 3.4, r: 122, shape: 'plateau' },
        // The dell rim: left, right, and back walls (the hollow itself).
        { x: 330, y: 430, x2: 358, y2: 302, h: 4.5, r: 110 },
        { x: 582, y: 470, x2: 562, y2: 330, h: 4.2, r: 110 },
        { x: 402, y: 296, x2: 522, y2: 282, h: 5, r: 118 },
        // The green pad sits LOW — the rim does the reading, the putt stays
        // gentle.
        { x: L(2).green.cx, y: L(2).green.cy, h: 0.6, r: 72, shape: 'plateau' },
        // Front door stays open: a soft approach ramp, no wall.
        { x: 452, y: 560, h: 1.2, r: 110 }
      ]
    },
    // ---------------------------------------------- h3 "The Gauntlet" par 5
    // The kept dogleg through the trees and water, rebuilt as a CLIMB: three
    // benches step up the routing to an elevated green terrace. The hero is
    // a granite knoll on the inside of the corner — cutting the dogleg means
    // flirting with stone; the safe line is longer and lower.
    {
      number: 3,
      name: 'The Gauntlet',
      par: 5,
      world: L(3).world,
      tee: [L(3).tee.x, L(3).tee.y],
      teeBox: L(3).teeBox,
      green: L(3).green,
      slope: { angle: 2.6, strength: 0.32 },
      fairways: keepFairways(L(3)),
      hazards: [
        // Drive-zone left bunker: the safe side off the tee is not free.
        { type: 'bunker', depthMul: 1.2, polygon: blob(300, 1082, 26, 18, 10, 0.35, 731) },
        // Through bunker past the corner: the drive that refuses to turn
        // right runs straight into sand. Sits OFF the recovery line from the
        // corner woods (playtest trace: sand on that line caged the AI).
        { type: 'bunker', depthMul: 1.2, polygon: blob(372, 772, 30, 20, 10, 0.4, 732) },
        // Greenside-right pot below the terrace (kept climbable — the wall
        // above it already extracts the penalty).
        { type: 'bunker', depthMul: 1.2, polygon: blob(934, 602, 20, 15, 9, 0.3, 733) },
        ...keepTrees(L(3)),
        ...keepWater(L(3))
      ],
      aiTargets: [[372, 1090], [366, 906], [524, 806], [680, 680], [844, 590]],
      elevation: [
        // Tee terrace (kept concept).
        { x: 360, y: 1400, h: 3.4, r: 180, shape: 'plateau' },
        // Three climbing benches along the routing. The corner bench sits
        // PAST the turn so the corner landing zone stays flat — a shoulder
        // over the joint funneled rolls into the corner woods (sim trace).
        { x: 378, y: 1055, h: 3.4, r: 190 },
        { x: 552, y: 776, h: 4.2, r: 150 },
        { x: 700, y: 662, h: 5.2, r: 160 },
        // Elevated green terrace — the finish reads as the top of the climb.
        // Flat top covers the WHOLE green + fringe (skirt 0.7 of r160 = 112
        // flat > green rx 84), so the putting surface never sits on the
        // skirt; the drop happens beyond the collar.
        { x: L(3).green.cx, y: L(3).green.cy, h: 4.2, r: 160, shape: 'plateau', skirt: 0.7 },
        // Front-left run-up apron: the ground-game door up the terrace.
        { x: 796, y: 642, h: 2.1, r: 110 },
        // HERO: the granite knoll inside the corner.
        { x: 600, y: 520, h: 7, r: 110 },
        // Framing ridges: west wall along the first leg (kept clear of the
        // corner so its shoulder never tilts the landing zone), northeast
        // wall behind the green — the valley the gauntlet runs through.
        { x: 150, y: 1280, x2: 168, y2: 980, h: 6, r: 130 },
        { x: 1030, y: 900, x2: 1120, y2: 460, h: 8, r: 160 },
        // The low ground the water sits in (drains the corner).
        { x: 250, y: 700, h: -1.6, r: 130 }
      ]
    }
  ]
};

export { timberlineV2 };
