/**
 * Three-star hole mastery (retention plan, Part 5). Pure engine + versioned
 * state; the authored third-star challenge definitions live in
 * src/data/masteryChallenges.ts (explicit course data — no conditions
 * scattered through gameplay code).
 *
 *  Star 1 — complete the hole at par or better.
 *  Star 2 — complete the hole at birdie or better.
 *  Star 3 — complete that hole's authored skill challenge.
 *
 * Stars are PERMANENT (a bitmask per hole, only ever OR-ed in), duplicate
 * awards are structurally impossible, and state merges by union for
 * cross-device sync.
 */

export interface MasteryState {
  v: 1;
  /** `${courseId}:${holeNumber}` → star bitmask (bit0 par, bit1 birdie, bit2 challenge). */
  stars: Record<string, number>;
}

export const STAR_PAR = 1;
export const STAR_BIRDIE = 2;
export const STAR_CHALLENGE = 4;

export function emptyMastery(): MasteryState {
  return { v: 1, stars: {} };
}

export function migrateMastery(raw: unknown): MasteryState {
  const base = emptyMastery();
  if (!raw || typeof raw !== 'object') return base;
  const m = raw as Partial<MasteryState>;
  for (const [k, v] of Object.entries(m.stars ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v)) base.stars[k] = v & 7;
  }
  return base;
}

/** Union merge — stars can only ever be gained. */
export function mergeMastery(a: MasteryState, b: MasteryState): MasteryState {
  const out = emptyMastery();
  for (const [k, v] of Object.entries(a.stars)) out.stars[k] = (out.stars[k] ?? 0) | v;
  for (const [k, v] of Object.entries(b.stars)) out.stars[k] = (out.stars[k] ?? 0) | v;
  return out;
}

/** Everything a hole's mastery evaluation may inspect — built by the game at
 *  hole completion. All optional fields default to "didn't happen". */
export interface HoleMasteryInput {
  courseId: string;
  holeNumber: number;
  par: number;
  strokes: number;
  /** The player revealed True Vision on this hole. */
  usedTrueVision?: boolean;
  /** Tee shot found the fairway (par 4/5 holes). */
  fairwayHit?: boolean;
  /** Green in regulation (strokes to reach green <= par - 2). */
  gir?: boolean;
  /** Any shot found water on this hole. */
  waterHit?: boolean;
  /** Any shot found sand on this hole. */
  sandHit?: boolean;
  /** Longest putt holed on this hole (feet). */
  longestPuttFt?: number;
  /** Approach finish distance from the pin (feet) when the green was hit. */
  approachFt?: number | null;
  /** Player was on fire for at least one swing of this hole. */
  onFire?: boolean;
  /** Wind speed for this hole. */
  windSpeed?: number;
}

export interface ThirdStarDef {
  /** Stable id, e.g. 'sablebay:2'. */
  id: string;
  courseId: string;
  holeNumber: number;
  /** Short player-facing name, e.g. 'Dry Ball'. */
  name: string;
  /** One-line requirement, e.g. 'Avoid the water'. */
  desc: string;
  test: (h: HoleMasteryInput) => boolean;
}

const key = (courseId: string, holeNumber: number): string => `${courseId}:${holeNumber}`;

/** Current star bitmask for a hole. */
export function holeStars(m: MasteryState, courseId: string, holeNumber: number): number {
  return m.stars[key(courseId, holeNumber)] ?? 0;
}

/** Count of stars earned on a course (or everywhere when courseId omitted). */
export function starCount(m: MasteryState, courseId?: string): number {
  let n = 0;
  for (const [k, v] of Object.entries(m.stars)) {
    if (courseId && !k.startsWith(`${courseId}:`)) continue;
    n += (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1);
  }
  return n;
}

export interface MasteryResult {
  /** Star indexes newly earned this hole (1=par, 2=birdie, 3=challenge). */
  newStars: Array<1 | 2 | 3>;
  /** Bitmask after the update. */
  stars: number;
}

/**
 * Evaluate a completed hole. Mutates `m`; returns only NEWLY earned stars
 * (already-earned stars are never re-celebrated). `def` is the hole's
 * authored third-star challenge, or undefined when none is authored.
 */
export function applyHoleMastery(
  m: MasteryState,
  h: HoleMasteryInput,
  def: ThirdStarDef | undefined
): MasteryResult {
  const k = key(h.courseId, h.holeNumber);
  const before = m.stars[k] ?? 0;
  let after = before;
  const scored = h.strokes - h.par;
  if (scored <= 0) after |= STAR_PAR;
  if (scored <= -1) after |= STAR_BIRDIE;
  if (def && def.test(h)) after |= STAR_CHALLENGE;
  m.stars[k] = after;
  const gained = after & ~before;
  const newStars: Array<1 | 2 | 3> = [];
  if (gained & STAR_PAR) newStars.push(1);
  if (gained & STAR_BIRDIE) newStars.push(2);
  if (gained & STAR_CHALLENGE) newStars.push(3);
  return { newStars, stars: after };
}

/** The single "nearby star opportunity" for the results screen: the first
 *  unearned star on the course just played, in hole order, preferring the
 *  easiest tier. Returns null when the course is fully mastered. */
export function nextStarHint(
  m: MasteryState,
  courseId: string,
  holes: Array<{ number: number; par: number }>,
  defs: ThirdStarDef[]
): { holeNumber: number; star: 1 | 2 | 3; label: string } | null {
  for (const tier of [1, 2, 3] as const) {
    for (const hole of holes) {
      const bits = holeStars(m, courseId, hole.number);
      const bit = tier === 1 ? STAR_PAR : tier === 2 ? STAR_BIRDIE : STAR_CHALLENGE;
      if (bits & bit) continue;
      if (tier === 1) return { holeNumber: hole.number, star: 1, label: `Par hole ${hole.number} for a star` };
      if (tier === 2) return { holeNumber: hole.number, star: 2, label: `Birdie hole ${hole.number} for a star` };
      const def = defs.find((d) => d.courseId === courseId && d.holeNumber === hole.number);
      if (def) return { holeNumber: hole.number, star: 3, label: `${def.desc} on hole ${hole.number}` };
    }
  }
  return null;
}
