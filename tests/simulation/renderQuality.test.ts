import { describe, expect, it } from 'vitest';
import {
  asTier,
  bootTier,
  DEMOTE_FRAMES,
  DEMOTE_MS,
  nextTier,
  PANIC_MS,
  PANIC_RUN,
  PROMOTE_FRAMES,
  PROMOTE_MS,
  QUALITY_TIERS,
  qualityProfile,
  STALL_MS,
  type QualityTier
} from '../../src/core/rendering/quality';

/**
 * ADAPTIVE RENDER QUALITY — the policy half.
 *
 * Owner: "the game keeps crashing on the links style courses and on wild wood.
 * it's laggy on those then sometimes crashes all together." The renderer used
 * to spend a fixed budget on every device; this policy lets the device set it.
 * These tests pin the properties that make that safe: it reacts, it does not
 * flap, and a phone that has already failed is never sent back to the budget
 * that failed it.
 */

const frames = (ms: number, n: number): number[] => Array.from({ length: n }, () => ms);

describe('the tier table', () => {
  it('gets strictly cheaper as the tier rises', () => {
    for (let i = 1; i < QUALITY_TIERS.length; i++) {
      const better = qualityProfile(QUALITY_TIERS[i - 1]);
      const worse = qualityProfile(QUALITY_TIERS[i]);
      expect(worse.renderScale, `tier ${i} renderScale`).toBeLessThan(better.renderScale);
      expect(worse.bakeScale, `tier ${i} bakeScale`).toBeLessThan(better.bakeScale);
      expect(worse.shadowSize, `tier ${i} shadowSize`).toBeLessThanOrEqual(better.shadowSize);
      expect(worse.waterReflectScale, `tier ${i} mirror`).toBeLessThanOrEqual(better.waterReflectScale);
      expect(worse.scatterScale, `tier ${i} scatter`).toBeLessThanOrEqual(better.scatterScale);
    }
  });

  it('leaves tier 0 exactly as the game shipped', () => {
    const full = qualityProfile(0);
    expect(full).toMatchObject({
      renderScale: 1,
      shadowSize: 1024,
      staticShadows: false,
      waterReflectScale: 1,
      bakeScale: 1,
      scatterScale: 1
    });
  });

  it('keeps the ground bake — the 20MB texture in every scene — under a third at the floor', () => {
    expect(qualityProfile(3).bakeScale).toBeLessThanOrEqual(1 / 3);
  });

  it('clamps junk from storage or the URL onto the range', () => {
    expect(asTier('2')).toBe(2);
    expect(asTier(9)).toBe(3);
    expect(asTier(-4)).toBe(0);
    expect(asTier('banana')).toBe(0);
    expect(asTier(null)).toBe(0);
  });
});

describe('demoting', () => {
  it('waits for real evidence — a short bad burst is not enough', () => {
    expect(nextTier(0, frames(60, DEMOTE_FRAMES - 1)).changed).toBe(false);
  });

  it('drops one tier once the median frame is over budget', () => {
    const d = nextTier(0, frames(DEMOTE_MS + 5, DEMOTE_FRAMES));
    expect(d.changed).toBe(true);
    expect(d.tier).toBe(1);
    expect(d.reason).toContain('ms');
  });

  it('drops only ONE tier at a time, however bad it is', () => {
    expect(nextTier(0, frames(400, DEMOTE_FRAMES)).tier).toBe(1);
  });

  it('survives one huge hitch inside an otherwise smooth window — median, not mean', () => {
    // A 2-second stall (a glTF resolving) among 89 comfortable frames.
    const window = frames(12, DEMOTE_FRAMES - 1).concat([2000]);
    expect(nextTier(0, window).changed).toBe(false);
  });

  it('stops at the cheapest tier rather than running off the end', () => {
    expect(nextTier(3, frames(500, PROMOTE_FRAMES)).changed).toBe(false);
  });
});

describe('promoting', () => {
  it('needs a much longer clean stretch than a demotion needs', () => {
    // Long enough to demote on, nowhere near long enough to promote on.
    expect(nextTier(2, frames(5, DEMOTE_FRAMES)).changed).toBe(false);
    expect(nextTier(2, frames(5, PROMOTE_FRAMES)).tier).toBe(1);
  });

  it('will not climb on frames that merely scrape the budget', () => {
    // Comfortably under the demote threshold, but not under the promote one —
    // promoting here would immediately re-break the budget and flap.
    const marginal = (DEMOTE_MS + PROMOTE_MS) / 2;
    expect(marginal).toBeLessThan(DEMOTE_MS);
    expect(marginal).toBeGreaterThan(PROMOTE_MS);
    expect(nextTier(2, frames(marginal, PROMOTE_FRAMES)).changed).toBe(false);
  });

  it('never climbs past the floor the device has already failed at', () => {
    // This phone fell to tier 2 earlier; an easy hole must not send it back.
    expect(nextTier(2, frames(3, PROMOTE_FRAMES), 2).changed).toBe(false);
    // With no floor set it climbs normally.
    expect(nextTier(2, frames(3, PROMOTE_FRAMES), 0).tier).toBe(1);
  });

  it('cannot oscillate: a window that promotes can never also demote', () => {
    for (const tier of QUALITY_TIERS) {
      const promoting = nextTier(tier, frames(PROMOTE_MS - 1, PROMOTE_FRAMES));
      const demoting = nextTier(tier, frames(DEMOTE_MS + 1, PROMOTE_FRAMES));
      expect(promoting.tier).toBeLessThanOrEqual(tier);
      expect(demoting.tier).toBeGreaterThanOrEqual(tier);
    }
  });
});

describe('where a cold boot starts', () => {
  const strong = { dpr: 2, cores: 12, memoryGb: 16 };

  it('gives a capable device everything', () => {
    expect(bootTier(strong)).toBe(0);
  });

  it('starts a dense-display phone with modest cores one step down', () => {
    expect(bootTier({ dpr: 3, cores: 6 })).toBe(1);
  });

  it('starts a genuinely weak device at a safe tier', () => {
    expect(bootTier({ dpr: 2, cores: 2, memoryGb: 8 })).toBe(2);
    expect(bootTier({ dpr: 2, cores: 8, memoryGb: 2 })).toBe(2);
  });

  it('honours what the device already proved, above every heuristic', () => {
    // A strong-looking device that has crashed its way to tier 3 stays there…
    expect(bootTier({ ...strong, remembered: 3 as QualityTier })).toBe(3);
    // …and a weak-looking one that measured fine is not held back.
    expect(bootTier({ dpr: 3, cores: 2, memoryGb: 1, remembered: 0 as QualityTier })).toBe(0);
  });

  it('does not punish Safari for withholding deviceMemory', () => {
    // navigator.deviceMemory is Chrome-only, and Safari is where the reported
    // crashes happen — its absence must never itself cost a tier.
    expect(bootTier({ dpr: 2, cores: 8 })).toBe(bootTier({ dpr: 2, cores: 8, memoryGb: 8 }));
  });
});


/**
 * THE CASES THE FIRST POLICY PROVABLY FAILED.
 *
 * Owner: "I lagged out with the ball in the air on wild prairie number 3 again.
 * the power meter on the drive was really choppy." The governor watched that
 * happen and never demoted. Two reasons, both fixed here, both tested:
 *
 *   1. it judged on a 90-frame MEDIAN, and the scatter drain's cost was a
 *      periodic spike among cheap frames — measured at 459ms against a 1.5ms
 *      median, which a median cannot see by construction;
 *   2. the wiring DROPPED frames over 250ms as outliers, so a device at 4fps
 *      recorded nothing at all and the governor went silent precisely when it
 *      was needed.
 */
describe('seeing a stall, not just slowness', () => {
  const smooth = (n: number): number[] => Array.from({ length: n }, () => 8);

  it('demotes on a periodic hitch that never moves the median', () => {
    // One stall in every eight frames. The median stays at 8ms — comfortably
    // inside budget — while the player sees a lurch several times a second.
    const window = Array.from({ length: DEMOTE_FRAMES }, (_, i) => (i % 8 === 0 ? 300 : 8));
    const sorted = [...window].sort((a, b) => a - b);
    expect(sorted[sorted.length >> 1], 'the median really is fine').toBeLessThan(DEMOTE_MS);
    expect(nextTier(0, window).changed, 'a visible hitch must still demote').toBe(true);
  });

  it('still ignores a single isolated stall', () => {
    // The behaviour the old outlier filter was meant to protect, kept — a glTF
    // resolving must not cost a smooth device a tier.
    const window = smooth(DEMOTE_FRAMES - 1).concat([4000]);
    expect(nextTier(0, window).changed).toBe(false);
  });

  it('demotes a device whose every frame exceeds the old outlier cutoff', () => {
    // This is the 4fps case. Under the old wiring these frames were discarded
    // as outliers and the sample window stayed EMPTY, so no amount of misery
    // could move the tier.
    const dying = Array.from({ length: PANIC_RUN }, () => PANIC_MS + 50);
    expect(nextTier(0, dying).changed, 'a dying device must demote').toBe(true);
  });

  it('panics on a short run, without waiting for a full window', () => {
    const run = Array.from({ length: PANIC_RUN }, () => 400);
    expect(run.length, 'the panic gate must fire well before a 90-frame window').toBeLessThan(DEMOTE_FRAMES);
    const d = nextTier(1, run);
    expect(d.changed).toBe(true);
    expect(d.tier).toBe(2);
  });

  it('does not panic on a run that is merely slow', () => {
    const slow = Array.from({ length: PANIC_RUN }, () => STALL_MS + 5);
    expect(nextTier(0, slow).changed, 'below the panic threshold, wait for evidence').toBe(false);
  });

  it('never demotes past the cheapest tier, however bad it gets', () => {
    expect(nextTier(3, Array.from({ length: DEMOTE_FRAMES }, () => 5000)).changed).toBe(false);
  });
});

describe('the first demotion actually sheds the dominant cost', () => {
  it('tier 1 thins grass', () => {
    // It was 1.0, which made tier 1 nearly a no-op on the holes that struggle:
    // Port Johnson h3 plants ~40k grass cards, Wild Prairie h3 ~26k. Trimming
    // pixels and the shadow map while leaving every blade missed the point.
    expect(qualityProfile(1).scatterScale).toBeLessThan(1);
  });
});

describe('a phone is a phone whatever it claims about its CPU', () => {
  it('never boots a touch device at full price', () => {
    // The reported crash device: a modern Android reporting 8 cores and dpr 3,
    // which sailed through the core-count test straight to tier 0.
    expect(bootTier({ dpr: 3, cores: 8, coarsePointer: true })).toBeGreaterThan(0);
  });

  it('leaves a mouse-driven desktop alone', () => {
    expect(bootTier({ dpr: 2, cores: 8, coarsePointer: false })).toBe(0);
  });

  it('still honours what the device already proved', () => {
    expect(bootTier({ dpr: 3, cores: 8, coarsePointer: true, remembered: 0 as QualityTier })).toBe(0);
  });
});
