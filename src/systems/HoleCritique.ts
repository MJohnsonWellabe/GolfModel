/**
 * A designer-facing read on a hole: is it fair, is it interesting, and is it
 * structurally sound?
 *
 * WHY
 * ---
 * A hole editor without this is a drawing program. You can move a bunker, but
 * nothing tells you whether the bunker made the hole better — and "play it and
 * see" is one round of one player's evidence, which is exactly the sample size
 * that produces holes nobody else enjoys.
 *
 * This project already owns the thing that fixes that: a headless simulator
 * that plays a hole hundreds of times at a chosen standard (`RoundSimulator` +
 * `SkillSimulator`), and a playability band the Hole of the Day is vetted
 * against (`DailyHoleGate`). The daily generator has used it since it shipped.
 * The editor should have the same oracle, for the same reason, and it is a few
 * milliseconds of pure physics.
 *
 * WHAT IT REPORTS
 * ---------------
 * Two independent things, because they fail independently:
 *
 * - **Structure.** Things that are wrong regardless of difficulty: a pin off
 *   the green, no fairway, a layup target in a hazard, a green nobody can reach.
 *   These are bugs, and they are invisible in plan view — the tool happily draws
 *   a pin two hundred yards from its green.
 * - **Play.** How the hole actually scores across a spread of standards. One
 *   number ("mean +1.4") hides the difference between a hole everyone bogeys
 *   and a hole half the field pars and half triples; the spread is the design
 *   information.
 *
 * It is deliberately Babylon-free so the authoring tools can run it without
 * pulling the engine into their bundle.
 */

import { simulateHole } from './RoundSimulator';
import { uniformGolfer } from './SkillSimulator';
import { mulberry32 } from '../utils/Random';
import { pointInPolygon } from '../utils/Geometry';
import { PX_PER_YARD, RULES } from '../config';
import type { CourseData, HoleData, Point } from '../core/types';

/** Standards the critique plays the hole at. Named for the designer, not for
 *  the simulator: what matters is "who is this hole for". */
export const CRITIQUE_TIERS = [
  { name: 'Casual', stat: 72 },
  { name: 'Regular', stat: 84 },
  { name: 'Strong', stat: 94 }
] as const;

/** Rounds per tier. Enough for a stable mean and a meaningful blow-up rate,
 *  small enough that the whole critique is well under a second. */
const SAMPLES = 120;

export interface TierResult {
  tier: string;
  meanToPar: number;
  /** Fraction shooting par or better. */
  parRate: number;
  /** Fraction shooting triple bogey or worse. */
  blowupRate: number;
  /** Fraction that never holed out inside the stroke cap. */
  pickUpRate: number;
}

export interface StructuralIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface HoleCritique {
  par: number;
  yardage: number;
  tiers: TierResult[];
  issues: StructuralIssue[];
  /** One-line verdict a designer can act on. */
  verdict: string;
  /** True when nothing structural is broken and the casual tier lands in the
   *  same band the Hole of the Day is vetted against. */
  ok: boolean;
}

function insideAny(p: Point, polys: number[][][] | undefined): boolean {
  return !!polys?.some((poly) => pointInPolygon(p.x, p.y, poly));
}

/** Is a point inside the green (either lobe)? Mirrors the ellipse test every
 *  surface consumer uses, rotation included. */
function onGreen(p: Point, hole: HoleData): boolean {
  const test = (g: HoleData['green'] | undefined): boolean => {
    if (!g) return false;
    const rot = g.rot ?? 0;
    const dx = p.x - g.cx;
    const dy = p.y - g.cy;
    const lx = dx * Math.cos(-rot) - dy * Math.sin(-rot);
    const ly = dx * Math.sin(-rot) + dy * Math.cos(-rot);
    return (lx * lx) / (g.rx * g.rx) + (ly * ly) / (g.ry * g.ry) <= 1;
  };
  return test(hole.green) || test(hole.green2);
}

/**
 * Structural checks — the things that are wrong no matter how the hole scores.
 *
 * Every one of these has been shipped by somebody, in some course, at some
 * point: they are cheap to make in a plan view and expensive to notice in a
 * round.
 */
export function structuralIssues(hole: HoleData): StructuralIssue[] {
  const out: StructuralIssue[] = [];
  const err = (message: string): void => void out.push({ severity: 'error', message });
  const warn = (message: string): void => void out.push({ severity: 'warning', message });

  if (!onGreen(hole.pin, hole)) err('The pin is not on the green.');
  if (!hole.fairway?.length && hole.par >= 4) {
    warn('A par 4 or 5 with no fairway polygon — every tee shot lands in rough.');
  }
  const teeToPin = Math.hypot(hole.pin.x - hole.tee.x, hole.pin.y - hole.tee.y) / PX_PER_YARD;
  if (teeToPin < 60) warn(`Only ${Math.round(teeToPin)} yd from tee to pin — shorter than a wedge.`);
  if (hole.yardage && Math.abs(hole.yardage - teeToPin) > Math.max(30, teeToPin * 0.2)) {
    warn(`Stated yardage ${hole.yardage} is far from the actual ${Math.round(teeToPin)} yd.`);
  }

  const hazards = hole.hazards ?? [];
  if (hazards.some((h) => h.type === 'water' && insideAny(hole.tee, [h.polygon]))) {
    err('The tee is inside a water hazard.');
  }
  for (const [i, t] of (hole.aiTargets ?? []).entries()) {
    const inHazard = hazards.find(
      (h) => (h.type === 'water' || h.type === 'ob') && pointInPolygon(t.x, t.y, h.polygon)
    );
    if (inHazard) err(`Layup target ${i + 1} sits inside a ${inHazard.type} hazard.`);
  }
  if (hole.par >= 5 && !(hole.aiTargets ?? []).length) {
    warn('A par 5 with no layup targets — the AI will always go for the green.');
  }
  for (const [i, e] of (hole.elevation ?? []).entries()) {
    if (!(e.r > 0)) err(`Elevation point ${i + 1} has no radius — it does nothing.`);
    if (Math.abs(e.h) > 120) {
      warn(`Elevation point ${i + 1} is ${e.h} units (~${Math.round(e.h * 1.25)} ft) — check the unit.`);
    }
  }
  const w = hole.world;
  const outside = (p: Point): boolean => p.x < 0 || p.y < 0 || p.x > w.width || p.y > w.height;
  if (outside(hole.tee)) err('The tee is outside the world bounds.');
  if (outside(hole.pin)) err('The pin is outside the world bounds.');
  return out;
}

/** Play the hole `SAMPLES` times at one standard. */
function playTier(hole: HoleData, course: CourseData, stat: number): Omit<TierResult, 'tier'> {
  const golfer = uniformGolfer(stat);
  let sum = 0;
  let pars = 0;
  let blowups = 0;
  let pickUps = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const r = simulateHole(hole, golfer, {
      // Fixed seeds: the critique must be the same number every time the
      // designer presses the button, or they cannot tell whether their edit
      // helped or the dice moved.
      rng: mulberry32(9001 + i * 7919),
      windMin: course.minWind ?? 2,
      windMax: course.maxWind ?? 20,
      bounded: true
    });
    const toPar = r.strokes - hole.par;
    sum += toPar;
    if (toPar <= 0) pars++;
    if (toPar >= 3) blowups++;
    if (!r.holed && r.strokes >= RULES.maxStrokes) pickUps++;
  }
  return {
    meanToPar: Math.round((sum / SAMPLES) * 100) / 100,
    parRate: Math.round((pars / SAMPLES) * 100) / 100,
    blowupRate: Math.round((blowups / SAMPLES) * 100) / 100,
    pickUpRate: Math.round((pickUps / SAMPLES) * 100) / 100
  };
}

/**
 * The full read. Structure first — a hole with the pin off the green will
 * produce nonsense numbers, and saying "mean +4.2" about it would be worse than
 * useless.
 */
export function critiqueHole(course: CourseData, holeIdx = 0): HoleCritique {
  const hole = course.holes[holeIdx];
  if (!hole) {
    return { par: 0, yardage: 0, tiers: [], issues: [{ severity: 'error', message: 'No such hole.' }], verdict: 'No hole to read.', ok: false };
  }
  const issues = structuralIssues(hole);
  const tiers = CRITIQUE_TIERS.map((t) => ({ tier: t.name, ...playTier(hole, course, t.stat) }));
  const casual = tiers[0];
  const errors = issues.filter((i) => i.severity === 'error');

  let verdict: string;
  let ok = false;
  if (errors.length) {
    verdict = `${errors.length} structural problem${errors.length > 1 ? 's' : ''} — fix these before reading the scoring.`;
  } else if (casual.meanToPar > 1.9) {
    verdict = `Too hard: a casual player averages +${casual.meanToPar.toFixed(1)}.`;
  } else if (casual.meanToPar < -0.3) {
    verdict = `Too easy: a casual player averages ${casual.meanToPar.toFixed(1)}.`;
  } else if (casual.blowupRate > 0.12) {
    verdict = `Punishing: ${Math.round(casual.blowupRate * 100)}% of casual rounds blow up.`;
  } else if (casual.parRate < 0.15) {
    verdict = `Par is out of reach: only ${Math.round(casual.parRate * 100)}% get there.`;
  } else if (tiers[2].meanToPar > casual.meanToPar - 0.4) {
    // The interesting failure mode, and the one a single playtest never finds:
    // a hole where skill does not pay. Usually means the difficulty is luck
    // (a blind carry, a hazard that catches good and bad shots alike).
    verdict = 'Fair, but skill barely pays — a strong player scores much like a casual one.';
    ok = true;
  } else {
    verdict = `Good: casual +${casual.meanToPar.toFixed(1)}, strong ${tiers[2].meanToPar.toFixed(1)}. Skill pays.`;
    ok = true;
  }
  return { par: hole.par, yardage: hole.yardage, tiers, issues, verdict, ok };
}

/**
 * The envelope handed to Claude, and the shape expected back.
 *
 * It carries the hole, the critique, and a brief — because a model given only
 * geometry will make it prettier, and what a designer wants is for it to make
 * the hole play better against evidence it can see. The round trip is
 * deliberately plain JSON: paste out, paste in, no integration to break.
 */
export interface HoleBrief {
  format: 'bsgolf.hole.v1';
  courseName: string;
  hole: HoleData;
  critique: HoleCritique;
  /** What the designer wants changed. Free text. */
  intent: string;
  /** Rules the model must not break, carried with the payload so they cannot be
   *  forgotten between one paste and the next. */
  constraints: string[];
}

export const HOLE_BRIEF_CONSTRAINTS: string[] = [
  'Return ONLY the JSON object, same shape, with `hole` edited. No prose.',
  'World px: 1 yd = 3 px. Elevation `h` is in ~1.25 ft units, NOT yards.',
  'The pin must stay inside `green` (or `green2`).',
  'Keep `world`, `par` and `number` unchanged unless the intent asks otherwise.',
  'Hazard polygons are closed rings of [x, y] pairs in world px.',
  'Prefer moving and reshaping what is there over adding more of it.',
  'A hole should reward skill: a strong player must score better than a casual one.'
];

export function holeBrief(course: CourseData, holeIdx: number, intent: string): HoleBrief {
  return {
    format: 'bsgolf.hole.v1',
    courseName: course.name,
    hole: course.holes[holeIdx],
    critique: critiqueHole(course, holeIdx),
    intent,
    constraints: HOLE_BRIEF_CONSTRAINTS
  };
}

/**
 * Read a returned brief back. Deliberately strict about the ENVELOPE and
 * forgiving about the contents: a model that returns a hole with an extra field
 * is fine, one that returns a chat message is not — and the difference has to be
 * caught here rather than by the renderer.
 */
export function parseHoleBrief(text: string): { hole: HoleData | null; error?: string } {
  let data: unknown;
  try {
    // Tolerate a fenced code block, which is what a chat interface will hand back.
    const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    data = JSON.parse(stripped);
  } catch (e) {
    return { hole: null, error: `Not valid JSON: ${(e as Error).message}` };
  }
  const obj = data as { format?: string; hole?: HoleData; number?: number; world?: unknown };
  // Accept either the whole envelope or a bare hole — a model asked for "the
  // hole" quite reasonably returns the hole.
  const hole = (obj.format === 'bsgolf.hole.v1' ? obj.hole : (obj as unknown as HoleData)) as HoleData | undefined;
  if (!hole || typeof hole !== 'object') return { hole: null, error: 'No `hole` object in the payload.' };
  if (!hole.world || !(hole.world.width > 0) || !(hole.world.height > 0)) {
    return { hole: null, error: 'The hole has no usable `world` size.' };
  }
  if (!hole.tee || !hole.pin || !hole.green) return { hole: null, error: 'The hole is missing tee, pin or green.' };
  if (!Number.isFinite(hole.par) || hole.par < 3 || hole.par > 6) {
    return { hole: null, error: `Implausible par: ${hole.par}` };
  }
  return { hole };
}
