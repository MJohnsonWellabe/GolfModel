/**
 * Hole of the Day — a fresh, generated golf hole every calendar day, identical
 * for every player, validated to be worth playing before it is served.
 *
 * WHY
 * ---
 * The game has 21 authored holes and a metagame sized for far more: a 50-level
 * Season Pass pitched at ~500 rounds is 1,500 hole-plays across those 21 holes,
 * about 70 visits each. Every retention system in the product — streaks,
 * mastery stars, records, weekly, achievements — is ultimately a reason to
 * replay the same holes. That works for a handful of sessions.
 *
 * Two things this project already has make new holes nearly free, and they are
 * an unusual pair to have together:
 *
 *   1. a deterministic course GENERATOR (scripts/gen-new-courses.mjs — Red
 *      Hollow and Wild Prairie are generated, not hand-drawn);
 *   2. a headless difficulty ORACLE (`RoundSimulator` + `SkillSimulator`), which
 *      can play a hole hundreds of times at a chosen skill level before any
 *      human sees it.
 *
 * So a hole can be generated from the date, scored by simulation, and rejected
 * if it is unfair, trivial or broken — and only then shipped. Nobody has to
 * approve it, and it is the same hole for everyone, which makes the score
 * comparable and the result worth sharing.
 *
 * WHAT IS AND IS NOT GENERATED
 * ----------------------------
 * GEOMETRY is generated: tee, fairway ribbon, green, sand, water, rock, trees,
 * out of bounds and the macro terrain the hole is cut into. ART DIRECTION IS
 * NOT — the hole borrows a shipped course's theme wholesale, so it looks like a
 * hole from this game rather than like something a script drew. That split is
 * deliberate: the generator is good at golf problems and bad at taste.
 *
 * THE "TOO PLAIN JANE" REBUILD (owner report, Stage 4)
 * ---------------------------------------------------
 * The first version of this generator drew a fairway, a green and at most three
 * bunkers. It never emitted a single drop of water, a waste blowout, a boulder,
 * an out-of-bounds edge or one elevation point, and its world was a hard-coded
 * 1100 px wide whatever the hole. Two causes, both fixed here:
 *
 *   1. **Vocabulary.** `HoleAuthoringLite` has always permitted every one of
 *      those things; the generator simply did not know the words. It now draws
 *      with the SAME primitives the build-time course generators use
 *      (`systems/holeShapes.ts` — `blob`, `stream`, `rock`, `computedPins`),
 *      shared rather than copied.
 *   2. **The gate.** `DAILY_BAND` was a single narrow band (mean ≤ +1.9,
 *      blow-ups ≤ 12%) applied to par 3s and par 5s alike, so anything dramatic
 *      was simulated, judged unfair and thrown away — the generator was being
 *      quietly censored into blandness. The band is now PER SHAPE and much
 *      wider, because the owner's instruction was that dailies should be harder
 *      to score than a shipped hole, not equal to one.
 *
 * And a day now has an ARCHETYPE (island green, canyon carry, the gauntlet,
 * windswept links, …) picked from the date, so consecutive dailies differ in
 * KIND and not merely in seed.
 *
 * DETERMINISM
 * -----------
 * Everything derives from the date string, so every player on a given day gets
 * the same hole without a server telling them what it is, and a shared result
 * is comparable. The generator is pure and Babylon-free.
 */

import { CourseAuthoring, loadCourse } from '../data/courseLoader';
import { mulberry32 } from '../utils/Random';
import { clamp } from '../utils/Geometry';
import { alongPath, blob, computedPins, rock, stream } from './holeShapes';
import type { ElevationPoint } from './HeightField';
import type { CourseData, EllipseArea, Hazard, Point } from '../core/types';

/** Themes the daily hole borrows, by course id. Art direction stays authored. */
export const DAILY_THEMES = ['sablebay', 'wildwood', 'timberline', 'portjohnson', 'redhollow', 'wildvalley', 'maplevale'] as const;

export interface DailyHoleSpec {
  /** YYYY-MM-DD the hole belongs to. */
  dateKey: string;
  /** Course id whose theme (and therefore look) this hole wears. */
  themeId: string;
  /** Seed the geometry was generated from — the attempt that passed the gate. */
  seed: number;
  /** The kind of hole the day drew — "Island Green", "Canyon Carry", … */
  archetype: DailyArchetype;
  par: number;
  yardage: number;
  /** How many candidates were rejected before this one passed. */
  attempts: number;
  course: CourseData;
}

/**
 * Playability band a generated hole must land in, from the same simulator the
 * balance gates use. A hole outside these is not "hard" or "easy" — it is
 * broken in a way a player would experience as unfair or pointless.
 *
 * This constant is now the ENVELOPE of the per-par bands below: the loosest
 * value on every axis. Nothing grades against it directly (`bandForPar` does
 * the grading) — it is the single "no daily hole is ever outside this" promise
 * the test suite and any future readout can hold onto.
 */
export const DAILY_BAND = {
  /** Mean strokes over par for a casual player (stat ~72). */
  minMeanToPar: 0.3,
  maxMeanToPar: 3.1,
  /** Fraction of casual rounds that blow up (triple bogey or worse). */
  maxBlowupRate: 0.3,
  /** A hole nobody can par is not a golf hole... */
  minParRate: 0.08,
  /** ...and a hole almost everybody pars carries no information. */
  maxParRate: 0.72
} as const;

export interface PlayBand {
  minMeanToPar: number;
  maxMeanToPar: number;
  maxBlowupRate: number;
  minParRate: number;
  maxParRate: number;
}

/**
 * The band PER PAR. A par 3 and a par 5 do not fail the same way, and judging
 * both by one yardstick is what starved the daily hole of drama:
 *
 *  - a **par 3** is one swing. Almost all of its variance is that swing, so a
 *    forced carry pushes the blow-up rate up fast; but a casual player's MEAN
 *    on a one-shotter stays close to par, so the mean ceiling can be tight
 *    while the blow-up ceiling is generous.
 *  - a **par 5** is three or four swings, each with its own chance to leak a
 *    stroke. A casual player is genuinely two over on a hard three-shotter and
 *    that is a good hole, not a broken one — so the mean ceiling is loose and
 *    the par rate floor is low (par on a brutal par 5 SHOULD be rare).
 *
 * The ceilings are deliberately well above what a shipped hole grades at. The
 * owner's instruction was explicit: dailies should be "harder to score AND
 * dramatic — more water or more sand or more elevation change or more distance
 * or more trees". A band tuned to a shipped hole rejects exactly that.
 */
const BANDS: Record<number, PlayBand> = {
  3: { minMeanToPar: 0.3, maxMeanToPar: 2.2, maxBlowupRate: 0.3, minParRate: 0.14, maxParRate: 0.72 },
  4: { minMeanToPar: 0.5, maxMeanToPar: 2.7, maxBlowupRate: 0.28, minParRate: 0.1, maxParRate: 0.68 },
  5: { minMeanToPar: 0.6, maxMeanToPar: 3.1, maxBlowupRate: 0.26, minParRate: 0.08, maxParRate: 0.62 }
};

/**
 * The FLOORS above are the half of this change that actually answers the owner.
 * Widening the ceiling only stops the gate from throwing dramatic holes away —
 * it does not stop the generator from drawing a soft one and having it accepted
 * on the first attempt, which is what a month of candidates showed it doing
 * (means of +0.1, par rates of 90%+).
 *
 * Calibration, measured with this same grader on the shipped holes:
 *
 *   par 3  Sable Bay h2 −0.15 / 92% par · Timberline h2 +0.29 / 76% par
 *   par 4  Maple Vale h1 −0.14 / 89% par · Timberline h1 +0.53 · Sable Bay h1 +0.91
 *   par 5  Maple Vale h3 −0.64 / 93% par · Timberline h3 +1.71 · Sable Bay h3 +1.79
 *
 * So a daily now has to be at least as hard as the HARDER end of the shipped
 * roster for its par, and no more than about a stroke beyond the hardest thing
 * that ships. It is a daily: it is allowed to be the hardest hole you play that
 * day, and the score is only worth sharing if it was not a formality.
 */

/** The band a hole of this par is graded against. */
export function bandForPar(par: number): PlayBand {
  return BANDS[par] ?? BANDS[4];
}

/** Deterministic 32-bit hash of the date key — the root of every daily seed. */
export function seedForDate(dateKey: string): number {
  let h = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h ^ (h >>> 15)) >>> 0;
}

/** The theme a given day wears. Cycles deterministically so consecutive days
 *  look different and every course's identity gets an airing. */
export function themeForDate(dateKey: string, available: readonly string[]): string {
  const list = available.length ? available : DAILY_THEMES;
  return list[seedForDate(dateKey) % list.length];
}

// ---------------------------------------------------------------------------
// Shapes and archetypes
// ---------------------------------------------------------------------------

interface Shape {
  par: number;
  /** Straight-line tee→green distance in world px (PX_PER_YARD = 2). */
  length: number;
  /** Signed dogleg in radians; 0 = straight. */
  dogleg: number;
}

/** Par/length/shape families the generator draws from. Real golf proportions —
 *  the generator picks a KIND of hole, then fills in the detail. The long end
 *  grew with the band: a 640-yard three-shotter is one of the honest ways to
 *  make a daily hard, and the old band would never have let one through. */
const SHAPES: Shape[] = [
  { par: 3, length: 300, dogleg: 0 },
  { par: 3, length: 380, dogleg: 0 },
  { par: 3, length: 450, dogleg: 0 },
  { par: 4, length: 620, dogleg: 0 },
  { par: 4, length: 720, dogleg: 0.28 },
  { par: 4, length: 780, dogleg: -0.32 },
  { par: 4, length: 860, dogleg: 0.18 },
  { par: 5, length: 980, dogleg: 0.22 },
  { par: 5, length: 1060, dogleg: -0.18 },
  { par: 5, length: 1180, dogleg: 0.3 },
  { par: 5, length: 1280, dogleg: -0.12 }
];

/** The kinds of hole a day can draw. */
export const DAILY_ARCHETYPES = ['island', 'canyon', 'gauntlet', 'links', 'creek', 'quarry', 'alpine'] as const;
export type DailyArchetype = (typeof DAILY_ARCHETYPES)[number];

/** Display names, for the daily-hole card. */
export const ARCHETYPE_NAMES: Record<DailyArchetype, string> = {
  island: 'Island Green',
  canyon: 'Canyon Carry',
  gauntlet: 'The Gauntlet',
  links: 'Windswept Links',
  creek: 'Winding Creek',
  quarry: 'The Quarry',
  alpine: 'High Country'
};

/** The archetype a given day draws. Deterministic from the date, and — unlike
 *  the seed — held CONSTANT across the day's rejected candidates, so a day has
 *  an identity rather than being whatever the search happened to land on.
 *  (`DailyHoleService` relaxes that late in the search; see MAX_ATTEMPTS.) */
export function archetypeForDate(dateKey: string): DailyArchetype {
  return DAILY_ARCHETYPES[(seedForDate(dateKey) >>> 5) % DAILY_ARCHETYPES.length];
}

// ---------------------------------------------------------------------------
// The drawing context an archetype builds into
// ---------------------------------------------------------------------------

interface Ctx {
  rng: () => number;
  world: { width: number; height: number };
  tee: Point;
  green: EllipseArea;
  /** Nominal fairway width before the pinch/flare profile. */
  baseWidth: number;
  hazards: Hazard[];
  aiTargets: Point[];
  /** Which side of the corridor this hole's trouble favours (+1 / −1). */
  side: number;
  /** Point and unit LEFT normal at fraction `t` along the routing path. */
  at(t: number): { x: number; y: number; nx: number; ny: number };
  /** Uniform draw in [a,b). */
  r(a: number, b: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Push an elevation point, shrunk (or dropped) so it cannot tilt the green.
   *  Terrain that reaches the putting surface is how a generated hole becomes
   *  unputtable, and the simulator would only report that as "too hard" ten
   *  candidates later. `overGreen` opts out for a pad deliberately CENTERED on
   *  the green, which raises it without tilting it. */
  elev(p: ElevationPoint, overGreen?: boolean): void;
  /** Push a sand hazard. */
  sand(cx: number, cy: number, rx: number, ry: number, waste?: boolean): void;
}

/** Closest point on a polyline, with the segment index and the fraction along
 *  it — enough to interpolate the fairway's local half-width there. */
function nearestOnPath(
  path: number[][],
  x: number,
  y: number
): { x: number; y: number; d: number; seg: number; f: number; nx: number; ny: number } {
  let best = { x: path[0][0], y: path[0][1], d: Infinity, seg: 0, f: 0, nx: 1, ny: 0 };
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const f = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
    const px = ax + dx * f;
    const py = ay + dy * f;
    const d = Math.hypot(x - px, y - py);
    if (d < best.d) {
      const l = Math.hypot(dx, dy) || 1;
      best = { x: px, y: py, d, seg: i, f, nx: -dy / l, ny: dx / l };
    }
  }
  return best;
}

/** Fairway HALF-width at a point on the ribbon (widths are full widths, one
 *  per centerline control point, linearly interpolated between them). */
function halfWidthAt(widths: number[], seg: number, f: number): number {
  const a = widths[Math.min(seg, widths.length - 1)];
  const b = widths[Math.min(seg + 1, widths.length - 1)];
  return (a + (b - a) * f) / 2;
}

/** Distance from a point to the green's outer edge, world px (negative inside). */
function distOutsideGreen(g: EllipseArea, x: number, y: number): number {
  return Math.hypot(x - g.cx, y - g.cy) - Math.max(g.rx, g.ry);
}

/**
 * An out-of-bounds strip running the length of the hole, `off` px to one side
 * of the routing line and `depth` px deep. Clamped into the world rectangle:
 * an OB quad hanging outside the world is meaningless (everything out there is
 * already off-course) and only makes the hazard's bounding box wrong for the
 * physics broad-phase.
 */
function obStrip(c: Ctx, side: number, off: number, depth: number): void {
  const p0 = c.at(0);
  const p1 = c.at(1);
  const pt = (p: { x: number; y: number; nx: number; ny: number }, d: number): number[] => [
    Math.round(clamp(p.x + p.nx * side * d, 0, c.world.width) * 10) / 10,
    Math.round(clamp(p.y + p.ny * side * d, 0, c.world.height) * 10) / 10
  ];
  c.hazards.push({ type: 'ob', polygon: [pt(p0, off), pt(p1, off), pt(p1, off + depth), pt(p0, off + depth)] });
}

interface ArchetypeDef {
  /** World-width multiplier — a links sprawls, a tree corridor does not. */
  widthMul: number;
  /** Which shape families this archetype will accept. */
  accepts(s: Shape): boolean;
  /** Fairway width multiplier — the cheapest difficulty lever there is. */
  fairwayMul: number;
  build(c: Ctx): void;
}

const ARCHETYPES: Record<DailyArchetype, ArchetypeDef> = {
  /**
   * ISLAND GREEN — the whole green sits in water. Short by design (a forced
   * carry you cannot lay up on is only fair when one club covers it), and the
   * green is padded up onto a low plateau so the island reads as land standing
   * out of the lake rather than a green painted on a pond.
   *
   * `surfaceAt` precedence is green > … > water > fairway, so a green drawn
   * inside a water polygon plays as green and everything around it plays as
   * water. That is the whole trick, and it is why the fairway is stopped short
   * of the shore instead of being run into the hazard.
   */
  island: {
    widthMul: 0.95,
    fairwayMul: 1,
    accepts: (s) => s.length <= 800,
    build(c) {
      const g = c.green;
      const rx = Math.max(g.rx, g.ry) + c.r(105, 155);
      const ry = Math.max(g.rx, g.ry) + c.r(95, 140);
      c.hazards.push({ type: 'water', level: 0.35, polygon: blob(g.cx, g.cy, rx, ry, 22, 0.16, c.rng) });
      // The island itself: a flat pad centred on the green, so the putting
      // surface stays level while the shoreline falls away from it.
      c.elev({ x: g.cx, y: g.cy, h: c.r(2.4, 3.6), r: Math.max(g.rx, g.ry) + 70, shape: 'plateau', skirt: 0.72 }, true);
      // One bail-out bunker on the near shore — a place to miss that is not wet.
      const b = c.at(0.9);
      c.sand(b.x + b.nx * c.side * 40, b.y + b.ny * c.side * 40, c.r(34, 48), c.r(24, 34));
      // Lay-up target short of the shore, so the AI (and the sim that grades
      // this hole) plays the carry as a decision rather than walking into it.
      c.aiTargets.push({ x: c.at(0.78).x, y: c.at(0.78).y });
    }
  },

  /**
   * CANYON CARRY — a gorge cut across the corridor short of the green, with
   * rim walls running down both sides. The rims are one elevation entry each,
   * using the SEGMENT form (`x2`/`y2`) that turns a circular bump into a long
   * ridge, and a hard `skirt` so the face is near-vertical at the 8 px grid.
   * (The runtime supports both; `core/types.ts` under-declares the field, which
   * is why the local array is typed as `ElevationPoint`.)
   */
  canyon: {
    widthMul: 1.05,
    fairwayMul: 0.95,
    accepts: (s) => s.length >= 560,
    build(c) {
      const t = c.r(0.66, 0.78);
      const a = c.at(t);
      const w = c.r(120, 190);
      const span = c.world.width * 0.75;
      // The gorge crosses the corridor square-on: a wide, slightly wandering
      // channel of water at the canyon floor.
      const across: number[][] = [];
      for (let i = 0; i <= 4; i++) {
        const f = (i / 4 - 0.5) * span;
        across.push([a.x + a.nx * f, a.y + a.ny * f + (c.rng() - 0.5) * 34]);
      }
      c.hazards.push({ type: 'water', level: -1.2, polygon: stream(across, w, c.rng) });
      // Rims: a ridge each side of the corridor, running the length of the hole.
      const h = c.r(9, 15);
      for (const s of [-1, 1]) {
        const off = c.baseWidth * 0.9 + c.r(90, 140);
        const p0 = c.at(0.12);
        const p1 = c.at(0.95);
        c.elev({
          x: p0.x + p0.nx * s * off,
          y: p0.y + p0.ny * s * off,
          x2: p1.x + p1.nx * s * off,
          y2: p1.y + p1.ny * s * off,
          h,
          r: c.r(150, 200),
          shape: 'plateau',
          skirt: 0.84
        });
      }
      // Rock spilling off the rim into the rough — the reason a wild drive is
      // an adventure rather than a walk.
      for (let i = 0; i < 3; i++) {
        const p = c.at(c.r(0.2, 0.6));
        const off = c.baseWidth * 0.75 + c.r(20, 60);
        c.hazards.push(rock(Math.round(p.x + p.nx * c.side * off), Math.round(p.y + p.ny * c.side * off), c.r(5, 9), 'rocks_red_mid'));
      }
      // The green stands on the far rim.
      c.elev({ x: c.green.cx, y: c.green.cy, h: c.r(3, 5), r: Math.max(c.green.rx, c.green.ry) + 80, shape: 'plateau', skirt: 0.7 }, true);
      c.aiTargets.push({ x: c.at(t - 0.16).x, y: c.at(t - 0.16).y });
    }
  },

  /**
   * THE GAUNTLET — a narrow avenue between two walls of trees, with sand at
   * the pinch. `spacing` is what actually makes woods dangerous (it is the grid
   * step between collidable trunks, so LOWER is denser); this archetype runs it
   * down to 20–26 against a shipped default of 52.
   */
  gauntlet: {
    widthMul: 0.98,
    fairwayMul: 0.78,
    accepts: (s) => s.par >= 4,
    build(c) {
      const spacing = Math.round(c.r(20, 27));
      for (const s of [-1, 1]) {
        // Three overlapping blobs per side make one continuous, wobbling wall
        // instead of the single lozenge the old generator drew on doglegs.
        for (const t of [0.22, 0.5, 0.78]) {
          const p = c.at(t + (c.rng() - 0.5) * 0.06);
          const off = c.baseWidth * 0.62 + c.r(70, 105);
          c.hazards.push({
            type: 'trees',
            spacing,
            polygon: blob(p.x + p.nx * s * off, p.y + p.ny * s * off, c.r(80, 115), c.r(150, 210), 11, 0.22, c.rng)
          });
        }
      }
      // Sand right where the avenue is tightest.
      for (const t of [c.r(0.34, 0.44), c.r(0.56, 0.68)]) {
        const p = c.at(t);
        const s = c.chance(0.5) ? 1 : -1;
        c.sand(p.x + p.nx * s * (c.baseWidth * 0.55), p.y + p.ny * s * (c.baseWidth * 0.55), c.r(30, 46), c.r(22, 32));
      }
      // Gentle rolling ground — enough to move a ball off line, not enough to
      // compete with the trees for the hole's identity.
      for (let i = 0; i < 5; i++) {
        const p = c.at(c.r(0.1, 0.9));
        const s = c.chance(0.5) ? 1 : -1;
        c.elev({ x: p.x + p.nx * s * c.r(0, 120), y: p.y + p.ny * s * c.r(0, 120), h: c.r(1.6, 3.4), r: c.r(90, 150) });
      }
      c.aiTargets.push({ x: c.at(0.45).x, y: c.at(0.45).y });
    }
  },

  /**
   * WINDSWEPT LINKS — no trees at all. Dunes everywhere, sprawling waste
   * blowouts that swallow anything off line, and out of bounds down one whole
   * side. Sand here is `waste: true`, which loses the overlap to fairway and
   * green (see the precedence note in PhysicsEngine.surfaceAt) — so it can be
   * drawn as one big natural sprawl without eating the landing area.
   */
  links: {
    widthMul: 1.15,
    fairwayMul: 1.05,
    accepts: () => true,
    build(c) {
      const dunes = 9 + Math.floor(c.rng() * 6);
      for (let i = 0; i < dunes; i++) {
        const p = c.at(c.r(0.02, 1));
        const s = c.chance(0.5) ? 1 : -1;
        c.elev({
          x: p.x + p.nx * s * c.r(60, 320),
          y: p.y + p.ny * s * c.r(-90, 90),
          h: c.r(3, 6.5),
          r: c.r(95, 175)
        });
      }
      for (let i = 0; i < 4; i++) {
        const p = c.at(c.r(0.2, 0.88));
        const s = c.chance(0.5) ? 1 : -1;
        const off = c.baseWidth * 0.55 + c.r(10, 70);
        c.sand(p.x + p.nx * s * off, p.y + p.ny * s * off, c.r(55, 95), c.r(40, 70), true);
      }
      // Pot bunkers at the green — small, deep, and the reason a links green is
      // defended by nothing you can see from the fairway.
      for (let i = 0; i < 2; i++) {
        const a = c.rng() * Math.PI * 2;
        const d = Math.max(c.green.rx, c.green.ry) + c.r(30, 52);
        c.sand(c.green.cx + Math.cos(a) * d, c.green.cy + Math.sin(a) * d * 0.85, c.r(16, 24), c.r(13, 19));
      }
      // Out of bounds down one side: a one-stroke penalty and a drop, so the
      // safe line is genuinely the other half of a very wide fairway.
      const edge = c.at(0.5);
      obStrip(c, c.side, c.baseWidth * 0.5 + c.r(190, 250), 400);
      c.aiTargets.push({ x: edge.x - edge.nx * c.side * 60, y: edge.y - edge.ny * c.side * 60 });
    }
  },

  /**
   * WINDING CREEK — a stream that runs with the hole and then cuts across it.
   * This is the archetype that most needed the terrain work: a creek is a thin
   * polygon at water level 0.35, and before `HeightField`'s water cut it was
   * simply buried by the first dome that overlapped it (the shipped Maple Vale
   * h3 defect). Now the channel is carved below its own surface, so the creek
   * is visible AND the ground falls toward it.
   */
  creek: {
    widthMul: 1.08,
    fairwayMul: 0.92,
    accepts: () => true,
    build(c) {
      const s = c.side;
      const pts: number[][] = [];
      for (let i = 0; i <= 6; i++) {
        const t = 0.08 + (i / 6) * 0.84;
        const p = c.at(t);
        // Runs alongside for most of the hole, then swings across the corridor
        // in front of the green — the classic "you must carry it eventually".
        const off = t < 0.62 ? c.baseWidth * 0.62 + c.r(30, 80) : -(c.baseWidth * (0.5 + (t - 0.62) * 3));
        pts.push([p.x + p.nx * s * off, p.y + p.ny * s * off]);
      }
      c.hazards.push({ type: 'water', level: 0.35, polygon: stream(pts, c.r(46, 78), c.rng) });
      // The far bank rises — the creek sits at the bottom of a real fall.
      const b0 = c.at(0.2);
      const b1 = c.at(0.85);
      const bankOff = c.baseWidth * 0.62 + c.r(130, 190);
      c.elev({
        x: b0.x + b0.nx * s * bankOff,
        y: b0.y + b0.ny * s * bankOff,
        x2: b1.x + b1.nx * s * bankOff,
        y2: b1.y + b1.ny * s * bankOff,
        h: c.r(6, 10),
        r: c.r(140, 190)
      });
      // Willows crowding the water.
      for (const t of [0.3, 0.55]) {
        const p = c.at(t);
        const off = c.baseWidth * 0.62 + c.r(90, 130);
        c.hazards.push({
          type: 'trees',
          spacing: Math.round(c.r(24, 32)),
          polygon: blob(p.x + p.nx * s * off, p.y + p.ny * s * off, c.r(60, 90), c.r(110, 160), 10, 0.22, c.rng)
        });
      }
      const gp = c.at(0.94);
      c.sand(gp.x - gp.nx * s * c.r(40, 60), gp.y - gp.ny * s * c.r(40, 60), c.r(34, 50), c.r(24, 34));
      c.aiTargets.push({ x: c.at(0.55).x, y: c.at(0.55).y });
    }
  },

  /**
   * THE QUARRY — mesa walls, boulders and out of bounds over the rim. The
   * walls are plateau ridges with a very hard skirt (0.88), which is how the
   * field guide says to get a near-vertical face out of an 8 px grid.
   */
  quarry: {
    widthMul: 1.06,
    fairwayMul: 0.88,
    accepts: (s) => s.par >= 4,
    build(c) {
      const s = c.side;
      const p0 = c.at(0.18);
      const p1 = c.at(0.9);
      const off = c.baseWidth * 0.75 + c.r(110, 160);
      c.elev({
        x: p0.x + p0.nx * s * off,
        y: p0.y + p0.ny * s * off,
        x2: p1.x + p1.nx * s * off,
        y2: p1.y + p1.ny * s * off,
        h: c.r(11, 17),
        r: c.r(150, 210),
        shape: 'plateau',
        skirt: 0.88
      });
      // Fallen rock at the toe of the wall. Kept in the rough, off the routing
      // line — a boulder in the middle of a fairway is a bug, not a hazard.
      const rocks = 4 + Math.floor(c.rng() * 3);
      for (let i = 0; i < rocks; i++) {
        const p = c.at(c.r(0.2, 0.88));
        const d = c.baseWidth * 0.72 + c.r(15, 70);
        c.hazards.push(rock(Math.round(p.x + p.nx * s * d), Math.round(p.y + p.ny * s * d), c.r(4.5, 9), c.chance(0.5) ? 'rocks_red_mid' : 'rocks_red_cluster'));
      }
      // The quarry floor beyond the rim is out of bounds.
      obStrip(c, s, off + c.r(150, 210), 320);
      // Waste sand spilling off the wall into the landing area.
      const w = c.at(c.r(0.35, 0.6));
      c.sand(w.x + w.nx * s * (c.baseWidth * 0.5 + c.r(5, 40)), w.y + w.ny * s * (c.baseWidth * 0.5 + c.r(5, 40)), c.r(55, 85), c.r(38, 58), true);
      // Trees on the OPEN side, so the safe miss is not free either.
      const tp = c.at(c.r(0.4, 0.7));
      c.hazards.push({
        type: 'trees',
        spacing: Math.round(c.r(26, 36)),
        polygon: blob(tp.x - tp.nx * s * (c.baseWidth * 0.62 + c.r(70, 110)), tp.y - tp.ny * s * (c.baseWidth * 0.62 + c.r(70, 110)), c.r(80, 120), c.r(130, 190), 10, 0.22, c.rng)
      });
      c.aiTargets.push({ x: c.at(0.45).x, y: c.at(0.45).y });
    }
  },

  /**
   * HIGH COUNTRY — the elevation archetype. The tee stands on a mesa and the
   * hole falls away from it (or the green sits up on a shelf and the whole
   * approach is blind uphill). Elevation change is the one kind of drama that
   * costs no hazards at all, and the old generator emitted exactly none of it.
   */
  alpine: {
    widthMul: 1.02,
    fairwayMul: 0.95,
    accepts: () => true,
    build(c) {
      const downhill = c.chance(0.6);
      const big = c.r(12, 19);
      if (downhill) {
        c.elev({ x: c.tee.x, y: c.tee.y - 30, h: big, r: c.r(230, 300), shape: 'plateau', skirt: 0.7 });
      } else {
        c.elev({ x: c.green.cx, y: c.green.cy, h: big, r: Math.max(c.green.rx, c.green.ry) + c.r(150, 210), shape: 'plateau', skirt: 0.68 }, true);
      }
      // A saddle ridge across the middle: something to fly, or to run down.
      const m = c.at(c.r(0.42, 0.6));
      const span = c.world.width * 0.4;
      c.elev({
        x: m.x + m.nx * span,
        y: m.y + m.ny * span,
        x2: m.x - m.nx * span,
        y2: m.y - m.ny * span,
        h: c.r(4, 7.5),
        r: c.r(110, 160)
      });
      // Shoulder mounds down both sides so the corridor reads as a valley.
      for (const s of [-1, 1]) {
        for (const t of [0.28, 0.66]) {
          const p = c.at(t);
          const o = c.baseWidth * 0.7 + c.r(90, 150);
          c.elev({ x: p.x + p.nx * s * o, y: p.y + p.ny * s * o, h: c.r(5, 9), r: c.r(120, 180) });
        }
      }
      // Conifers on the high side.
      const tp = c.at(c.r(0.3, 0.72));
      c.hazards.push({
        type: 'trees',
        spacing: Math.round(c.r(22, 30)),
        polygon: blob(tp.x + tp.nx * c.side * (c.baseWidth * 0.68 + c.r(80, 120)), tp.y + tp.ny * c.side * (c.baseWidth * 0.68 + c.r(80, 120)), c.r(90, 130), c.r(150, 220), 11, 0.24, c.rng)
      });
      // An alpine tarn short and left of the green.
      if (c.chance(0.55)) {
        const p = c.at(c.r(0.8, 0.9));
        const o = -c.side * (c.baseWidth * 0.5 + c.r(20, 70));
        c.hazards.push({
          type: 'water',
          level: 0.35,
          polygon: blob(p.x + p.nx * o, p.y + p.ny * o, c.r(70, 110), c.r(55, 90), 16, 0.2, c.rng)
        });
      }
      c.aiTargets.push({ x: c.at(0.5).x, y: c.at(0.5).y });
    }
  }
};

/** The archetype a bare seed draws, when no date supplied one. */
export function archetypeForSeed(seed: number): DailyArchetype {
  return DAILY_ARCHETYPES[(seed >>> 5) % DAILY_ARCHETYPES.length];
}

function ellipse(cx: number, cy: number, rx: number, ry: number, rot: number): EllipseArea {
  return { cx, cy, rx, ry, rot };
}

/**
 * Generate one candidate hole from a seed. Pure geometry — no validation; the
 * caller decides whether it is worth playing.
 */
export function generateHole(seed: number, holeNumber = 1, archetype: DailyArchetype = archetypeForSeed(seed)): HoleAuthoringLite {
  const rng = mulberry32(seed);
  const arche = ARCHETYPES[archetype];

  const pool = SHAPES.filter((s) => arche.accepts(s));
  const shape = pool[Math.floor(rng() * pool.length)];
  const length = shape.length * (0.92 + rng() * 0.16);

  // The world SCALES with the hole. It used to be a flat 1100 px whatever the
  // hole was, which is why a 640-yard links had the same amount of room beside
  // it as a 150-yard par 3 — not enough for dunes, a quarry wall or an OB edge
  // on the long holes, and a wasteful expanse of nothing on the short ones.
  const world = {
    width: Math.round(clamp(760 + length * 0.52, 900, 1600) * arche.widthMul),
    height: Math.round(length + 520)
  };
  const tee = { x: world.width / 2, y: 220 };

  // Centerline: tee → an optional dogleg elbow → green. The elbow is what makes
  // the hole a decision rather than a corridor.
  const straight = Math.abs(shape.dogleg) < 0.05;
  const greenY = tee.y + length;
  const elbowT = 0.55 + rng() * 0.12;
  const elbowY = tee.y + length * elbowT;
  const elbowX = tee.x + Math.sin(shape.dogleg) * length * 0.32;
  const greenX = tee.x + Math.sin(shape.dogleg) * length * 0.16;
  const centerline: number[][] = straight
    ? [
        [tee.x, tee.y + 40],
        [tee.x + (rng() - 0.5) * 30, tee.y + length * 0.5],
        [greenX, greenY - 40]
      ]
    : [
        [tee.x, tee.y + 40],
        [tee.x + Math.sin(shape.dogleg) * length * 0.16, tee.y + length * 0.3],
        [elbowX, elbowY],
        [greenX, greenY - 40]
      ];
  // Fairways pinch at the landing zone and open near the green — the width
  // profile is where a hole gets its teeth without needing a hazard. Each
  // archetype scales the whole profile (the gauntlet's avenue is 22% tighter
  // than a links fairway before a single tree is planted).
  const baseWidth = (108 + rng() * 46) * arche.fairwayMul;
  const pinch = 0.6 + rng() * 0.22;
  const width = centerline.map((_, i) =>
    Math.round(baseWidth * (i === 1 ? pinch : i === centerline.length - 1 ? 1.08 : 1))
  );

  const green = ellipse(greenX, greenY, 52 + rng() * 26, 44 + rng() * 24, rng() * Math.PI);
  const hazards: Hazard[] = [];
  // Typed as ElevationPoint (not the HoleData field's own type) on purpose:
  // the runtime heightfield supports ridge SEGMENTS (`x2`/`y2`) and a plateau
  // `skirt`, and `core/types.ts` under-declares the field to x/y/h/r/shape.
  // The extra keys survive — nothing strips them — and `HeightField` reads
  // them; this is the honest type for what is actually being authored.
  const elevation: ElevationPoint[] = [];
  const aiTargets: Point[] = [];

  const path = centerline;
  const side = rng() < 0.5 ? 1 : -1;
  const ctx: Ctx = {
    rng,
    world,
    tee,
    green,
    baseWidth,
    hazards,
    aiTargets,
    side,
    at: (t) => alongPath(path, t),
    r: (a, b) => a + rng() * (b - a),
    chance: (p) => rng() < p,
    elev(p, overGreen = false) {
      if (overGreen) {
        elevation.push(p);
        return;
      }
      // Shrink until the disc (or the ridge segment's whole sweep) clears the
      // putting surface. A ridge is measured from BOTH ends — the segment form
      // is the one that reaches a long way from its nominal centre.
      const clearance =
        Math.min(distOutsideGreen(green, p.x, p.y), distOutsideGreen(green, p.x2 ?? p.x, p.y2 ?? p.y)) - 26;
      if (clearance <= 40) return; // too close to the green to be worth risking
      elevation.push(p.r <= clearance ? p : { ...p, r: clearance });
    },
    sand(cx, cy, rx, ry, waste = false) {
      // Sand is pushed CLEAR of the fairway ribbon and the green before it is
      // drawn. `courseLoader.warnBunkerFairwayOverlap` is the authority on why:
      // a regular bunker that straddles the ribbon edge bites a scalloped notch
      // out of the fairway (never authored intent), and WASTE sand loses the
      // overlap outright, so the part of a blowout lying on the fairway is
      // silently not there at all. Left to itself the generator tripped that
      // lint on most days — a randomly placed hazard has no idea where the
      // corridor is. Doing it here, once, means every archetype can place sand
      // "just off the fairway" without each of them re-deriving the corridor.
      // The blob's reach along a direction is the ellipse's own support
      // function, inflated by the jitter's worst case (blob's k tops out at
      // 1 + jitter/2 = 1.17) — using `rx` alone under-measured a wide, shallow
      // blowout sitting beside a hole that doglegs, and that is exactly the
      // shape the lint kept catching.
      const reach = (ux: number, uy: number): number => Math.hypot(rx * ux, ry * uy) * 1.2;
      const p = nearestOnPath(path, cx, cy);
      let x = cx;
      let y = cy;
      const ux = p.d > 0.001 ? (cx - p.x) / p.d : p.nx;
      const uy = p.d > 0.001 ? (cy - p.y) / p.d : p.ny;
      const want = halfWidthAt(width, p.seg, p.f) + 8 + reach(ux, uy);
      if (p.d < want) {
        x = p.x + ux * want;
        y = p.y + uy * want;
      }
      // ...and clear of the putting surface, so a trap never eats the green.
      const gd = Math.hypot(x - green.cx, y - green.cy);
      const gx = gd > 0.001 ? (x - green.cx) / gd : 1;
      const gy = gd > 0.001 ? (y - green.cy) / gd : 0;
      const gWant = Math.max(green.rx, green.ry) + 12 + reach(gx, gy);
      if (gd < gWant) {
        x = green.cx + gx * gWant;
        y = green.cy + gy * gWant;
      }
      const hz: Hazard = { type: 'bunker', polygon: blob(x, y, rx, ry, 9, 0.34, rng) };
      if (waste) hz.waste = true;
      hazards.push(hz);
    }
  };

  // Every hole gets sand at the green and, on the longer ones, sand on the
  // ideal line — the baseline the archetype then builds its own trouble on top
  // of. The greenside count went from 1-2 to 1-3 (owner: more sand).
  const bunkerCount = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < bunkerCount; i++) {
    const a = rng() * Math.PI * 2;
    const d = green.rx + 34 + rng() * 26;
    ctx.sand(greenX + Math.cos(a) * d, greenY + Math.sin(a) * d * 0.8, 30 + rng() * 18, 22 + rng() * 12);
  }
  if (shape.par >= 4 && rng() < 0.75) {
    const t = 0.42 + rng() * 0.2;
    const p = ctx.at(t);
    const s = rng() < 0.5 ? -1 : 1;
    ctx.sand(p.x + p.nx * s * baseWidth * 0.55, p.y + p.ny * s * baseWidth * 0.55, 34 + rng() * 20, 26 + rng() * 14);
  }
  // Trees line the corridor on doglegs — the thing that makes cutting the
  // corner a real choice rather than a free shortcut.
  if (!straight) {
    const inside = shape.dogleg > 0 ? 1 : -1;
    const cx = elbowX + inside * (baseWidth * 0.85 + 60);
    hazards.push({ type: 'trees', spacing: 26, polygon: blob(cx, elbowY, 120, 150, 10, 0.2, rng) } as Hazard);
  }

  // ROLLING GROUND, on every hole. The owner asked for "more elevation change"
  // and the honest reading of that is not "sometimes a mountain" but "the
  // ground is never a table". Gentle by design — 1.2 to 3 units (≈2–4.5 ft)
  // over a 100–180 px radius is well inside the fairway-continuity budget the
  // terrain gates hold the authored courses to (≤3 per 8 px), so it moves a
  // ball and lifts the horizon without turning approach play into a lottery.
  // Laid down BEFORE the archetype's own terrain so a canyon rim or a mesa
  // wall reads as the dominant landform rather than competing with the mounds.
  const mounds = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < mounds; i++) {
    const p = ctx.at(0.06 + rng() * 0.88);
    const s = rng() < 0.5 ? 1 : -1;
    ctx.elev({
      x: p.x + p.nx * s * (rng() * 210),
      y: p.y + p.ny * s * (rng() * 210),
      h: 1.2 + rng() * 1.8,
      r: 100 + rng() * 80
    });
  }

  aiTargets.push(
    straight
      ? { x: (tee.x + greenX) / 2, y: tee.y + length * 0.5 }
      : { x: elbowX * 0.5 + tee.x * 0.5, y: tee.y + length * elbowT * 0.9 }
  );

  arche.build(ctx);

  // Pin: the same front/back/side ring the authored courses compute, so a
  // generated green is pinned the way a hand-drawn one is. Only ONE position
  // is emitted (not the `pins` array) — the daily hole must be identical for
  // every player, and an emitted `pins` array hands the choice to the round
  // seed instead.
  const pinRing = computedPins({ green, tee: [tee.x, tee.y] });
  const pin = pinRing[Math.floor(rng() * pinRing.length)];

  return {
    number: holeNumber,
    par: shape.par,
    // Yardage follows the ROUTE, not the straight line — a dogleg is longer to
    // walk than it is to look at, and the old straight-line number understated
    // every bent hole by up to 8%.
    yardage: Math.round(
      centerline.reduce(
        (acc, p, i) => (i === 0 ? acc : acc + Math.hypot(p[0] - centerline[i - 1][0], p[1] - centerline[i - 1][1])),
        Math.hypot(centerline[0][0] - tee.x, centerline[0][1] - tee.y)
      ) / 2
    ),
    world,
    tee,
    green,
    slope: { angle: rng() * Math.PI * 2, strength: 0.25 + rng() * 0.5 },
    pin,
    fairway: [{ centerline, width }],
    hazards,
    aiTargets,
    ...(elevation.length ? { elevation } : {})
  };
}

/** The subset of the authoring shape the generator emits. */
export type HoleAuthoringLite = CourseAuthoring['holes'][number];

/**
 * Wrap a generated hole as a one-hole course wearing a shipped course's theme.
 * Running it through `loadCourse` means the daily hole is compiled, validated
 * and consumed exactly like an authored one — no second code path.
 */
export function courseForHole(hole: HoleAuthoringLite, themeCourse: CourseData, name: string): CourseData {
  return loadCourse({
    name,
    theme: themeCourse.theme,
    minWind: themeCourse.minWind,
    maxWind: themeCourse.maxWind,
    version: 2,
    holes: [hole]
  } as CourseAuthoring);
}

/** Convenience for readouts and tests: every hazard kind a hole carries. */
export function hazardCounts(hole: { hazards: Hazard[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const hz of hole.hazards) out[hz.type] = (out[hz.type] ?? 0) + 1;
  return out;
}
