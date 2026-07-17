/**
 * Three-star hole mastery (retention plan, Part 5). Pure engine + versioned
 * state; the authored challenges live in src/data/masteryChallenges.ts as
 * explicit course data — three progressively harder, hole-specific challenges
 * per hole (no conditions scattered through gameplay code).
 *
 *  Star 1 — an approachable goal (solid play).
 *  Star 2 — a skilled goal (a birdie or a clean hole).
 *  Star 3 — a mastery goal (the rare one — an eagle, a hole-out, a dagger).
 *
 * Stars are PERMANENT (a bitmask per hole, only ever OR-ed in), duplicate
 * awards are structurally impossible, and state merges by union for
 * cross-device sync.
 */

export interface MasteryState {
  v: 1;
  /** `${courseId}:${holeNumber}` → star bitmask (bit0 star1, bit1 star2, bit2 star3). */
  stars: Record<string, number>;
}

/** Positional star bits (bit0 = the first/easiest authored challenge). */
export const STAR_1 = 1;
export const STAR_2 = 2;
export const STAR_3 = 4;
export const STAR_BITS = [STAR_1, STAR_2, STAR_3] as const;

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
  /** Putts taken on THIS hole (1 = one-putt; 0 = holed from off the green). */
  holePutts?: number;
  /** Approach finish distance from the pin (feet) when the green was hit. */
  approachFt?: number | null;
  /** Player was on fire for at least one swing of this hole. */
  onFire?: boolean;
  /** Wind speed for this hole. */
  windSpeed?: number;
  /** WHOLE-ROUND context (evaluated at round end, so round-scale challenges —
   *  "shoot 4 under", "3 putts or fewer" — can anchor to a hole slot). */
  roundToPar?: number;
  /** Total putts taken across the whole round. */
  roundPutts?: number;
}

/** One authored star challenge (a single tier of a hole's ladder). */
export interface StarChallenge {
  /** Short player-facing name, e.g. 'Island Dagger'. */
  name: string;
  /** One-line requirement, e.g. 'Stick the tee shot inside 8 ft'. */
  desc: string;
  test: (h: HoleMasteryInput) => boolean;
}

/** A hole's three progressively harder challenges (tier 1 → 3). */
export interface HoleMasteryDef {
  /** Stable id, e.g. 'sablebay:1'. */
  id: string;
  courseId: string;
  holeNumber: number;
  /** Exactly three challenges, easiest first. */
  stars: [StarChallenge, StarChallenge, StarChallenge];
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
  /** Star tiers newly earned this hole (1, 2, or 3). */
  newStars: Array<1 | 2 | 3>;
  /** Bitmask after the update. */
  stars: number;
}

/**
 * Evaluate a completed hole against its three authored challenges. Mutates
 * `m`; returns only NEWLY earned stars (already-earned stars are never
 * re-celebrated). Each tier is tested independently — earning a harder star
 * does not require the easier ones, and vice versa. `def` is the hole's
 * authored ladder, or undefined when none is authored.
 */
export function applyHoleMastery(
  m: MasteryState,
  h: HoleMasteryInput,
  def: HoleMasteryDef | undefined
): MasteryResult {
  const k = key(h.courseId, h.holeNumber);
  const before = m.stars[k] ?? 0;
  let after = before;
  if (def) {
    def.stars.forEach((c, i) => {
      if (c.test(h)) after |= STAR_BITS[i];
    });
  }
  m.stars[k] = after;
  const gained = after & ~before;
  const newStars: Array<1 | 2 | 3> = [];
  if (gained & STAR_1) newStars.push(1);
  if (gained & STAR_2) newStars.push(2);
  if (gained & STAR_3) newStars.push(3);
  return { newStars, stars: after };
}

/** The single "nearby star opportunity" for the results screen: the first
 *  unearned star on the course just played, in hole order, easiest tier first.
 *  Returns null when the course is fully mastered. */
export function nextStarHint(
  m: MasteryState,
  courseId: string,
  holes: Array<{ number: number; par: number }>,
  defs: HoleMasteryDef[]
): { holeNumber: number; star: 1 | 2 | 3; label: string } | null {
  for (const tier of [0, 1, 2] as const) {
    for (const hole of holes) {
      const bits = holeStars(m, courseId, hole.number);
      if (bits & STAR_BITS[tier]) continue;
      const def = defs.find((d) => d.courseId === courseId && d.holeNumber === hole.number);
      if (!def) continue;
      return {
        holeNumber: hole.number,
        star: (tier + 1) as 1 | 2 | 3,
        label: `${def.stars[tier].desc} on hole ${hole.number}`
      };
    }
  }
  return null;
}
