import { SHOT } from '../core/debugFlags';
import {
  asTier,
  bootTier,
  nextTier,
  PROMOTE_FRAMES,
  qualityProfile,
  type QualityProfile,
  type QualityTier
} from '../core/rendering/quality';

/**
 * The wiring half of adaptive render quality (policy lives in
 * `src/core/rendering/quality.ts`).
 *
 * One module-level governor for the whole page: the render loop feeds it frame
 * times, scene builds read `renderQuality()` for their budgets, and it owns the
 * engine's hardware-scaling level and the persisted per-device tier.
 *
 * WHY IT IS INERT UNDER AUTOMATION. Playwright renders through SwiftShader at
 * 1-3 fps on every course — frame times there describe a software rasteriser,
 * not a player's phone, so a live governor would slam every spec to the
 * cheapest tier and rewrite every reference screenshot. The capture harness
 * (`?hole=`) is pinned for the same reason: a screenshot must show the art at
 * full quality. Both remain overridable with `?q=<0-3>` so the tiers can be
 * inspected and captured on purpose.
 */

const STORAGE_KEY = 'jg-quality';

/** Frame samples kept for the promote window; demotion reads the tail of it. */
const WINDOW = PROMOTE_FRAMES;
/**
 * Ceiling a sample is CLAMPED to — not dropped at.
 *
 * This used to be a drop: any frame over 250ms was discarded so a one-off glTF
 * stall could not demote a smooth device. That reasoning was wrong twice over.
 * A single outlier cannot move a median or a stall-share anyway, so the filter
 * protected nothing — and it silenced the governor exactly when it mattered: a
 * device rendering at 4fps produces frames that are ALL over the cutoff, so it
 * recorded zero samples and never demoted, no matter how bad things got.
 *
 * Clamping instead keeps the frame as evidence (it counts as a stall, and it
 * counts toward a panic run) without letting one 8-second hitch distort the
 * arithmetic.
 */
const CLAMP_MS = 2000;

interface GovernorState {
  tier: QualityTier;
  /** Worst tier reached this session — promotion never climbs past it. */
  floor: QualityTier;
  samples: number[];
  /** Set while automation, the capture harness or the player owns the quality. */
  pinned: boolean;
  /** Frames since the last promote/demote evaluation (see DECIDE_EVERY). */
  sinceDecision: number;
  onApply: ((p: QualityProfile) => void) | null;
  lastReason: string;
}

const state: GovernorState = {
  tier: 0,
  floor: 0,
  samples: [],
  pinned: false,
  sinceDecision: 0,
  onApply: null,
  lastReason: ''
};

function storedTier(): QualityTier | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? undefined : asTier(raw);
  } catch {
    return undefined; // private mode / storage disabled — just don't remember
  }
}

function remember(tier: QualityTier): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(tier));
  } catch {
    /* best-effort */
  }
}

function urlOverride(): QualityTier | undefined {
  if (typeof location === 'undefined') return undefined;
  const raw = new URLSearchParams(location.search).get('q');
  return raw === null ? undefined : asTier(raw);
}

function isAutomated(): boolean {
  return typeof navigator !== 'undefined' && navigator.webdriver === true;
}

/**
 * Start the governor. Call once at boot, before the first scene is built.
 * `onApply` receives the profile whenever the tier changes (and once now), and
 * is where the engine's hardware scaling is set.
 */
export function startQualityGovernor(
  onApply: (p: QualityProfile) => void,
  preference: 'auto' | QualityTier = 'auto'
): void {
  state.onApply = onApply;
  const forced = urlOverride();
  if (forced !== undefined) {
    state.pinned = true;
    state.tier = forced;
    state.floor = forced;
  } else if (isAutomated() || SHOT.hole !== undefined) {
    state.pinned = true;
    state.tier = 0;
    state.floor = 0;
  } else if (preference !== 'auto') {
    // The player chose. Respect it exactly — including a choice that is worse
    // for them than the governor's; being overruled by the game after asking
    // for a setting is the thing a setting is supposed to prevent.
    state.pinned = true;
    state.tier = preference;
    state.floor = preference;
  } else {
    const nav = navigator as Navigator & { deviceMemory?: number };
    state.tier = bootTier({
      remembered: storedTier(),
      dpr: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
      cores: nav.hardwareConcurrency,
      memoryGb: nav.deviceMemory,
      coarsePointer:
        typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)').matches : (nav.maxTouchPoints ?? 0) > 0
    });
    // THE FLOOR STARTS OPEN. It used to be seeded from `state.tier` — a boot
    // GUESS, not a measured failure — which pinned the device to that ceiling
    // before a single frame had been drawn. Combined with `bootTier` returning
    // the remembered value first, one bad session became a permanent cap in
    // every future session: promotion needs `current > floor`, so `floor` at the
    // boot tier meant the device could never climb. Only an EARNED demote raises
    // it now (see sampleFrame and demoteQuality).
    state.floor = 0;
  }
  onApply(qualityProfile(state.tier));
}

/** The budget a scene build should spend. Read at build time, not per frame. */
export function renderQuality(): QualityProfile {
  return qualityProfile(state.tier);
}

/** Frames between decisions. `nextTier` sorts its window to take a median, and
 *  running that EVERY frame would spend real time on the exact device the
 *  governor exists to relieve. A quarter-second cadence is far finer than the
 *  90-frame evidence window it reads, so nothing is missed. */
const DECIDE_EVERY = 15;
/** Trim the window in blocks rather than shifting one element per frame —
 *  `shift()` on a 360-element array is an O(n) memmove every frame. */
const TRIM_SLACK = 60;

/**
 * Feed one rendered frame. Called from the render loop with the engine's
 * delta time. Costs a push on most frames; the median runs on one frame in
 * fifteen.
 */
export function sampleFrame(deltaMs: number): void {
  if (state.pinned || !(deltaMs > 0)) return;
  state.samples.push(Math.min(deltaMs, CLAMP_MS));
  if (state.samples.length > WINDOW + TRIM_SLACK) state.samples.splice(0, state.samples.length - WINDOW);
  if (++state.sinceDecision < DECIDE_EVERY) return;
  state.sinceDecision = 0;
  // Read the newest WINDOW frames — `samples` may carry up to TRIM_SLACK stale
  // ones ahead of them, and a decision must never see a frame that old.
  const decision = nextTier(state.tier, state.samples.slice(-WINDOW), state.floor);
  if (!decision.changed) return;
  state.tier = decision.tier;
  state.lastReason = decision.reason;
  // Within a SESSION the floor only ever sinks: a device that failed here must
  // not be sent back by a quiet stretch on a cheap hole. Across sessions it
  // resets (see setQualityApplier), so a bad afternoon is not a life sentence.
  if (decision.tier > state.floor) state.floor = decision.tier;
  // Start the evidence over — the samples that justified the move describe the
  // OLD budget and would immediately justify it again.
  state.samples.length = 0;
  state.sinceDecision = 0;
  // Remember WHERE IT SETTLED, not the worst it ever saw. This used to persist
  // `floor`, which — now that the floor is a per-session guard rather than a
  // permanent cap — would have written 0 back on the first promotion and thrown
  // the memory away. The settled tier is the useful hint: next boot starts
  // there instead of re-running the same jank, and climbs from there if it can.
  remember(state.tier);
  state.onApply?.(qualityProfile(state.tier));
}

/**
 * A scene teardown/rebuild throws away the frame-time history: the build
 * itself, the intro flyover and the first frames of a new hole are not
 * representative of steady play.
 */
export function resetQualitySamples(): void {
  state.samples.length = 0;
  state.sinceDecision = 0;
}

/**
 * Step down a tier on hard evidence rather than on frame times — a lost WebGL
 * context is the GPU telling us it ran out of memory, which is a stronger
 * signal than any median and must not wait for the 90-frame window. Also sinks
 * the session floor, so the device does not climb back within this session to
 * the budget that killed it — but the next session starts fresh, because one
 * lost context should not cost a tier forever.
 */
export function demoteQuality(reason: string): void {
  if (state.pinned || state.tier >= 3) return;
  state.tier = (state.tier + 1) as QualityTier;
  // An earned demote, so it raises the session floor — unlike the boot guess,
  // which no longer does.
  state.floor = state.tier;
  state.lastReason = reason;
  state.samples.length = 0;
  state.sinceDecision = 0;
  // Same rule as sampleFrame: remember where it settled, which after a demote
  // IS the floor — but say it in the terms the boot path reads it in.
  remember(state.tier);
  state.onApply?.(qualityProfile(state.tier));
}

/** Diagnostics for the perf probe and the in-game settings readout. */
export function qualityStatus(): {
  tier: QualityTier;
  label: string;
  floor: QualityTier;
  pinned: boolean;
  samples: number;
  reason: string;
} {
  return {
    tier: state.tier,
    label: qualityProfile(state.tier).label,
    floor: state.floor,
    pinned: state.pinned,
    samples: state.samples.length,
    reason: state.lastReason
  };
}

/**
 * Apply a change to the Settings → Graphics preference without a reload.
 * Takes effect on the NEXT hole build for everything sized at build time (the
 * ground bake, the shadow map, the mirror, the scatter); the render resolution
 * moves immediately, because it is the one knob the engine can retune live.
 */
export function setQualityPreference(preference: 'auto' | QualityTier): void {
  if (urlOverride() !== undefined || isAutomated() || SHOT.hole !== undefined) return;
  state.samples.length = 0;
  state.sinceDecision = 0;
  if (preference === 'auto') {
    state.pinned = false;
    // Back to measuring — from what this device last proved, not from scratch.
    state.tier = storedTier() ?? 0;
    state.floor = state.tier;
  } else {
    state.pinned = true;
    state.tier = preference;
    state.floor = preference;
  }
  state.onApply?.(qualityProfile(state.tier));
}

/** Test/dev seam: drop the remembered tier and start measuring again. */
export function resetQualityMemory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort */
  }
  state.floor = 0;
  state.tier = 0;
  state.samples.length = 0;
  state.sinceDecision = 0;
  state.onApply?.(qualityProfile(0));
}
