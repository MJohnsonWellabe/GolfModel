/**
 * ADAPTIVE RENDER QUALITY — the device decides, not the course author.
 *
 * Owner report: "the game keeps crashing on the links style courses and on
 * wild wood. it's laggy on those then sometimes crashes all together."
 *
 * Everything the renderer spends was, until now, a FIXED budget: a 1024²
 * shadow map, a planar water mirror at the authored ratio, a ground albedo
 * baked to a four-megatexel budget, and a render resolution pinned at
 * min(devicePixelRatio, 2). A desktop swallows that; a phone three years into
 * its life does not, and it has no way to say so. It just renders slower and
 * slower until iOS reclaims the tab — which is exactly the two symptoms
 * reported, in exactly that order (laggy, then gone).
 *
 * Measuring the courses did NOT support the obvious theory that the reported
 * courses are the heaviest ones. Sable Bay, Port Johnson and Wild Prairie are
 * the LIGHTEST scenes in the game by mesh and vertex count (~190-236 meshes,
 * 0.09-0.15M verts against Timberline West's 1.9M). What they are is wide and
 * open — sky, water and unoccluded ground — which costs fill rate and memory
 * bandwidth rather than geometry, and a phone's tile-based GPU is bound by
 * exactly those. Wildwood adds a planar water mirror on top of the game's
 * densest garden scatter. So the fix cannot be "thin course X": it has to be a
 * budget the DEVICE sets from what it actually achieves.
 *
 * This module is the pure half — the tier table and the promote/demote policy,
 * with no engine, DOM or storage in it, so the policy is unit-testable and the
 * wiring stays thin (see `src/slice3d/qualityGovernor.ts`).
 *
 * Design rules:
 *  - DEMOTE FAST, PROMOTE SLOWLY. A player who is lagging wants relief this
 *    hole; a player who is fine will not notice the extra half-minute it takes
 *    to earn a tier back. Asymmetric windows also stop the tier oscillating on
 *    a scene whose cost sits right at a boundary.
 *  - MEASURE THE MEDIAN, NOT THE MEAN. One 400 ms hitch (a glTF resolving, the
 *    ground bake) must not demote a device that is otherwise smooth.
 *  - NEVER PROMOTE PAST WHERE THE DEVICE HAS ALREADY FAILED this session. A
 *    phone that fell to tier 2 on hole 1 gets tier 2's cheaper scene BUILT for
 *    hole 2, rather than paying full price again and re-learning the same
 *    lesson nine times a round.
 */

/** 0 is everything on; 3 is the cheapest scene the game will draw. */
export type QualityTier = 0 | 1 | 2 | 3;

export const QUALITY_TIERS: readonly QualityTier[] = [0, 1, 2, 3];

/** The knobs a tier turns. Every consumer reads these — no consumer branches
 *  on the tier number itself, so adding a tier stays a one-line table edit. */
export interface QualityProfile {
  tier: QualityTier;
  /** Short label for the settings screen and the perf probe. */
  label: string;
  /** Multiplier on the render resolution, applied over min(dpr, 2). Fill rate
   *  scales with the SQUARE of this, so it is the biggest single lever. */
  renderScale: number;
  /** Shadow-map edge in texels. */
  shadowSize: number;
  /** True to bake the shadow map ONCE per hole instead of regenerating it every
   *  other frame. Only the ball and the golfer move, so a static map is a small
   *  visual loss for the largest fixed per-frame GPU cost in the scene. */
  staticShadows: boolean;
  /** Multiplier on the theme's planar water-mirror RTT ratio. 0 drops the
   *  mirror (the water keeps its depth tint, wavelets and fresnel sheen). */
  waterReflectScale: number;
  /** Multiplier on the ground-albedo bake's texel budget. The bake is the
   *  single largest texture in every scene, and it is paid twice at build —
   *  once as a source canvas, once as the uploaded DynamicTexture. */
  bakeScale: number;
  /** Multiplier on decorative scatter density (grass/flower/garden cards).
   *  Trees and every collision hitbox are untouched at every tier. */
  scatterScale: number;
}

const PROFILES: Readonly<Record<QualityTier, QualityProfile>> = {
  0: {
    tier: 0,
    label: 'Full',
    renderScale: 1,
    shadowSize: 1024,
    staticShadows: false,
    waterReflectScale: 1,
    bakeScale: 1,
    scatterScale: 1
  },
  1: {
    // First relief: 28% fewer pixels, a smaller shadow map, and a ground bake
    // at 2.8 megatexels instead of 4 (14 MB rather than 20). Every element is
    // still present and it is near-indistinguishable at arm's length.
    tier: 1,
    label: 'High',
    renderScale: 0.85,
    shadowSize: 768,
    staticShadows: false,
    waterReflectScale: 0.7,
    bakeScale: 0.7,
    scatterScale: 1
  },
  2: {
    // Half the pixels of full, a 9 MB ground bake, a soft mirror, and the
    // first trim of decorative scatter.
    tier: 2,
    label: 'Balanced',
    renderScale: 0.7,
    shadowSize: 512,
    staticShadows: false,
    waterReflectScale: 0.5,
    bakeScale: 0.45,
    scatterScale: 0.7
  },
  3: {
    // Last resort, aimed at a device the OS is about to kill: no mirror, a
    // shadow map baked once instead of every other frame, a third of full's
    // pixels, and a 6 MB ground bake. The hole is still the hole — geometry,
    // elevation, hazards, wind and putting are bit-identical at every tier;
    // only what the frame COSTS changes.
    tier: 3,
    label: 'Performance',
    renderScale: 0.55,
    shadowSize: 512,
    staticShadows: true,
    waterReflectScale: 0,
    bakeScale: 0.3,
    scatterScale: 0.45
  }
};

export function qualityProfile(tier: QualityTier): QualityProfile {
  return PROFILES[tier];
}

/** Clamp any number onto the tier range (storage and URL overrides are
 *  untrusted input). */
export function asTier(v: unknown): QualityTier {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(3, Math.max(0, Math.round(n))) as QualityTier;
}

// ------------------------------------------------------------------- policy

/** Frame time we are willing to live with. 33 ms is 30 fps — the point where
 *  the swing meter starts to read jumpy rather than merely soft. */
export const DEMOTE_MS = 33;
/** A device must be comfortably INSIDE the budget, not merely at it, before it
 *  earns a tier back — otherwise promoting immediately re-breaks the budget
 *  and the tier flaps. 20 ms is 50 fps. */
export const PROMOTE_MS = 20;
/** Frames of evidence required to drop a tier. At 30 fps that is ~3 s. */
export const DEMOTE_FRAMES = 90;
/** Frames of evidence required to earn one back — deliberately ~4x longer. */
export const PROMOTE_FRAMES = 360;

export interface QualityDecision {
  tier: QualityTier;
  /** True when the tier moved and the caller must re-apply the profile. */
  changed: boolean;
  /** Why, for the perf probe and the docs. Empty when nothing changed. */
  reason: string;
}

/**
 * Decide the next tier from a window of recent frame times.
 *
 * `samples` is the rolling window, newest last, in milliseconds. `floor` is
 * the best tier this device has EARNED the right to return to — the governor
 * passes the worst tier reached this session, so a phone that has already
 * failed at tier 0 is never sent back to tier 0 by a quiet stretch on an easy
 * hole. Pure: no clock, no storage, no engine.
 */
export function nextTier(current: QualityTier, samples: readonly number[], floor: QualityTier = 0): QualityDecision {
  const hold = (): QualityDecision => ({ tier: current, changed: false, reason: '' });
  if (samples.length < DEMOTE_FRAMES) return hold();
  const recent = samples.slice(-DEMOTE_FRAMES);
  const med = median(recent);
  if (med > DEMOTE_MS && current < 3) {
    const tier = (current + 1) as QualityTier;
    return { tier, changed: true, reason: `median ${med.toFixed(0)}ms over ${DEMOTE_MS}ms` };
  }
  if (samples.length < PROMOTE_FRAMES) return hold();
  // Promotion reads the WHOLE long window: a device only climbs back after a
  // sustained clean stretch, not after one good second inside a bad minute.
  const longMed = median(samples.slice(-PROMOTE_FRAMES));
  if (longMed < PROMOTE_MS && current > floor) {
    const tier = (current - 1) as QualityTier;
    return { tier, changed: true, reason: `median ${longMed.toFixed(0)}ms under ${PROMOTE_MS}ms` };
  }
  return hold();
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The tier a device should START at, before it has rendered anything.
 *
 * A cold boot has no frame times, so this is the one place a guess is
 * unavoidable — and the guess is deliberately conservative in the direction
 * that cannot hurt: a fast device promoted from tier 1 to tier 0 within a few
 * seconds costs nobody anything, whereas booting a struggling phone at tier 0
 * is precisely the crash being fixed.
 *
 * `deviceMemory` is Chrome-only (undefined on Safari, which is where the
 * reported crashes happen), so it can only ever ADD confidence, never gate.
 */
export function bootTier(opts: {
  /** Remembered worst tier from a previous session, if any. */
  remembered?: QualityTier;
  /** window.devicePixelRatio. */
  dpr: number;
  /** navigator.hardwareConcurrency. */
  cores?: number;
  /** navigator.deviceMemory in GB (Chrome only). */
  memoryGb?: number;
}): QualityTier {
  // A device that has already proved what it can take gets that answer back —
  // this is the whole point of persisting it. Never boot better than earned.
  if (opts.remembered !== undefined) return opts.remembered;
  const cores = opts.cores ?? 8;
  const mem = opts.memoryGb ?? 8;
  // Two or fewer usable cores, or 2 GB or less of reported memory, is a device
  // that will not hold a full-price scene.
  if (cores <= 2 || mem <= 2) return 2;
  // A dense-display phone (dpr 3) on a modest core count is the common iPhone
  // shape in the wild: start it one step down and let it climb.
  if (opts.dpr >= 3 && cores <= 6) return 1;
  return 0;
}
