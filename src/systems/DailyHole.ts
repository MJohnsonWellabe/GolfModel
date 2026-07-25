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
 * GEOMETRY is generated: tee, fairway ribbon, green, bunkers, and the hazard
 * that gives the hole its problem. ART DIRECTION IS NOT — the hole borrows a
 * shipped course's theme wholesale, so it looks like a hole from this game
 * rather than like something a script drew. That split is deliberate: the
 * generator is good at golf problems and bad at taste.
 *
 * DETERMINISM
 * -----------
 * Everything derives from the date string, so every player on a given day gets
 * the same hole without a server telling them what it is, and a shared result
 * is comparable. The generator is pure and Babylon-free.
 */

import { CourseAuthoring, loadCourse } from '../data/courseLoader';
import { mulberry32 } from '../utils/Random';
import type { CourseData, EllipseArea, Hazard, Polygon } from '../core/types';

/** Themes the daily hole borrows, by course id. Art direction stays authored. */
export const DAILY_THEMES = ['sablebay', 'wildwood', 'timberline', 'portjohnson', 'redhollow', 'wildvalley', 'maplevale'] as const;

export interface DailyHoleSpec {
  /** YYYY-MM-DD the hole belongs to. */
  dateKey: string;
  /** Course id whose theme (and therefore look) this hole wears. */
  themeId: string;
  /** Seed the geometry was generated from — the attempt that passed the gate. */
  seed: number;
  par: number;
  yardage: number;
  /** How many candidates were rejected before this one passed. */
  attempts: number;
  course: CourseData;
}

/** Playability band a generated hole must land in, from the same simulator the
 *  balance gates use. A hole outside these is not "hard" or "easy" — it is
 *  broken in a way a player would experience as unfair or pointless. */
export const DAILY_BAND = {
  /** Mean strokes over par for a casual player (stat ~72). */
  minMeanToPar: -0.3,
  maxMeanToPar: 1.9,
  /** Fraction of casual rounds that blow up (triple bogey or worse). */
  maxBlowupRate: 0.12,
  /** A hole nobody can par is not a golf hole. */
  minParRate: 0.15
} as const;

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

interface Shape {
  par: number;
  /** Straight-line tee→green distance in world px (PX_PER_YARD = 2). */
  length: number;
  /** Signed dogleg in radians; 0 = straight. */
  dogleg: number;
}

/** Par/length/shape families the generator draws from. Real golf proportions —
 *  the generator picks a KIND of hole, then fills in the detail. */
const SHAPES: Shape[] = [
  { par: 3, length: 300, dogleg: 0 },
  { par: 3, length: 380, dogleg: 0 },
  { par: 4, length: 620, dogleg: 0 },
  { par: 4, length: 720, dogleg: 0.28 },
  { par: 4, length: 780, dogleg: -0.32 },
  { par: 5, length: 980, dogleg: 0.22 },
  { par: 5, length: 1060, dogleg: -0.18 }
];

function ellipse(cx: number, cy: number, rx: number, ry: number, rot: number): EllipseArea {
  return { cx, cy, rx, ry, rot };
}

/** Organic blob polygon — the same idea as the build-time generator's `blob`. */
function blob(cx: number, cy: number, rx: number, ry: number, points: number, jitter: number, rng: () => number): Polygon {
  const out: Polygon = [];
  const rot = rng() * Math.PI * 2;
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2 + rot;
    const k = 1 - jitter / 2 + rng() * jitter;
    out.push([Math.round((cx + Math.cos(a) * rx * k) * 10) / 10, Math.round((cy + Math.sin(a) * ry * k) * 10) / 10]);
  }
  return out;
}

/**
 * Generate one candidate hole from a seed. Pure geometry — no validation; the
 * caller decides whether it is worth playing.
 */
export function generateHole(seed: number, holeNumber = 1): HoleAuthoringLite {
  const rng = mulberry32(seed);
  const shape = SHAPES[Math.floor(rng() * SHAPES.length)];
  const length = shape.length * (0.92 + rng() * 0.16);
  // The hole runs up the world, with a margin either side for rough and scenery.
  const world = { width: 1100, height: Math.round(length + 520) };
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
  // profile is where a hole gets its teeth without needing a hazard.
  const baseWidth = 108 + rng() * 46;
  const pinch = 0.62 + rng() * 0.22;
  const width = centerline.map((_, i) =>
    Math.round(baseWidth * (i === 1 ? pinch : i === centerline.length - 1 ? 1.08 : 1))
  );

  const green = ellipse(greenX, greenY, 52 + rng() * 26, 44 + rng() * 24, rng() * Math.PI);
  const hazards: Hazard[] = [];

  // Greenside sand: one or two, on the side the approach comes from.
  const bunkerCount = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < bunkerCount; i++) {
    const a = rng() * Math.PI * 2;
    const d = green.rx + 34 + rng() * 26;
    hazards.push({
      type: 'bunker',
      polygon: blob(greenX + Math.cos(a) * d, greenY + Math.sin(a) * d * 0.8, 30 + rng() * 18, 22 + rng() * 12, 9, 0.35, rng)
    } as Hazard);
  }
  // A fairway bunker guarding the ideal line on the longer holes.
  if (shape.par >= 4 && rng() < 0.75) {
    const t = 0.42 + rng() * 0.2;
    const cx = tee.x + (greenX - tee.x) * t + (rng() < 0.5 ? -1 : 1) * (baseWidth * 0.55);
    const cy = tee.y + length * t;
    hazards.push({
      type: 'bunker',
      polygon: blob(cx, cy, 34 + rng() * 20, 26 + rng() * 14, 9, 0.32, rng)
    } as Hazard);
  }
  // Trees line the corridor on doglegs — the thing that makes cutting the
  // corner a real choice rather than a free shortcut.
  if (!straight) {
    const inside = shape.dogleg > 0 ? 1 : -1;
    const cx = elbowX + inside * (baseWidth * 0.85 + 60);
    hazards.push({
      type: 'trees',
      spacing: 26,
      polygon: blob(cx, elbowY, 120, 150, 10, 0.2, rng)
    } as Hazard);
  }

  return {
    number: holeNumber,
    par: shape.par,
    yardage: Math.round(length / 2),
    world,
    tee,
    green,
    slope: { angle: rng() * Math.PI * 2, strength: 0.25 + rng() * 0.5 },
    pin: { x: greenX, y: greenY },
    fairway: [{ centerline, width }],
    hazards,
    aiTargets: straight
      ? [{ x: (tee.x + greenX) / 2, y: tee.y + length * 0.5 }]
      : [{ x: elbowX * 0.5 + tee.x * 0.5, y: tee.y + length * elbowT * 0.9 }]
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
