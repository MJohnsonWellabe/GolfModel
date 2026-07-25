import { describe, expect, it } from 'vitest';
import { flag, allFlags, FLAG_DEFS, setFlagOverride } from '../src/core/flags';

// In the unit runner `location.hostname` is empty → the environment resolves to
// 'dev', so these assertions read the dev-side defaults.

describe('feature flags', () => {
  it('every flag declares an owner, both env defaults, and a removal condition', () => {
    expect(FLAG_DEFS.length).toBeGreaterThan(0);
    for (const d of FLAG_DEFS) {
      expect(d.key.length).toBeGreaterThan(0);
      expect(d.owner.length).toBeGreaterThan(0);
      expect(d.removeWhen.length).toBeGreaterThan(0);
      expect(typeof d.defaults.prod).toBe('boolean');
      expect(typeof d.defaults.dev).toBe('boolean');
    }
  });

  it('devTools defaults on in development and off in production', () => {
    const def = FLAG_DEFS.find((d) => d.key === 'devTools')!;
    expect(def.defaults.dev).toBe(true);
    expect(def.defaults.prod).toBe(false);
    // Resolved value in the (dev) test env follows the dev default.
    expect(flag('devTools')).toBe(true);
  });

  it('an unknown flag key fails safe to off (never throws on a hot path)', () => {
    expect(flag('does-not-exist')).toBe(false);
  });

  it('the V2 polish flags are PROMOTED to production (pass 10)', () => {
    // delight/juice/atmosphere/audio/personality/layouts shipped to prod.
    for (const key of ['delight', 'juice', 'atmosphere', 'audio', 'personality', 'layouts']) {
      const def = FLAG_DEFS.find((d) => d.key === key);
      expect(def, key).toBeTruthy();
      expect(def!.defaults.dev, `${key} dev`).toBe(true);
      expect(def!.defaults.prod, `${key} prod`).toBe(true);
    }
  });

  it('the course-content flags are RELEASED to production (no more dev gating)', () => {
    // newCourses (Red Hollow + Wild Prairie), courseRebuilds (the v2 rebuilds +
    // Timberline West), and boundedWorld all default on in prod now — the public
    // site shows the full rebuilt roster, not "coming soon" teasers.
    for (const key of ['newCourses', 'courseRebuilds', 'boundedWorld']) {
      const def = FLAG_DEFS.find((d) => d.key === key);
      expect(def!.defaults.dev, `${key} dev`).toBe(true);
      expect(def!.defaults.prod, `${key} prod`).toBe(true);
    }
  });

  it('the Wildwood perf pass and the onboarding tutorial are PROMOTED to production', () => {
    // wildwoodPerf (default-course thinning) and tutorial ("Learn to play")
    // both default on in prod now — production runs the thinned Wildwood and
    // shows the onboarding entry.
    for (const key of ['wildwoodPerf', 'tutorial', 'driverOverswingNerf']) {
      const def = FLAG_DEFS.find((d) => d.key === key);
      expect(def, key).toBeTruthy();
      expect(def!.defaults.dev, `${key} dev`).toBe(true);
      expect(def!.defaults.prod, `${key} prod`).toBe(true);
    }
  });

  it('the smoothness + scale passes are PROMOTED to production (owner pass 5)', () => {
    // The owner's call, verbatim: "then you can move everything into
    // production." Everything that soaked in dev through passes 1–4 now
    // defaults on for live players too.
    for (const key of [
      'natureBatching',
      'resumeRound',
      'tutorialDepth',
      'quickPlay',
      'roundRecording',
      'verifiedScores',
      'dailyHole',
      'shotAttribution',
      'easeIn',
      'practiceRange',
      'focusedGame',
      'recordBoards'
    ]) {
      const def = FLAG_DEFS.find((d) => d.key === key);
      expect(def, key).toBeTruthy();
      expect(def!.defaults.dev, `${key} dev`).toBe(true);
      expect(def!.defaults.prod, `${key} prod`).toBe(true);
    }
  });

  it('the systems the strip-down retired stay off everywhere', () => {
    // focusedGame supersedes the rival and the ghost race wholesale (flag()
    // composes it), so their own defaults never resurrect them — and they must
    // not ship to prod as a side effect of the pass-5 promotion.
    for (const key of ['rival', 'ghostRace']) {
      const def = FLAG_DEFS.find((d) => d.key === key)!;
      expect(def.defaults.prod, `${key} prod`).toBe(false);
      expect(flag(key), `${key} resolved under focusedGame`).toBe(false);
    }
  });

  it('the traced swing is AVAILABLE everywhere, and the default control is the meter', () => {
    // The flag is availability — it puts the choice in Settings → Swing. The
    // actual default control is the three-click meter, and that lives in
    // DeviceSettings.swingType ('tap' unless the player picks otherwise),
    // which tests/profile.test.ts pins.
    const def = FLAG_DEFS.find((d) => d.key === 'dragSwing')!;
    expect(def.defaults.dev).toBe(true);
    expect(def.defaults.prod).toBe(true);
  });

  it('allFlags snapshots every registered flag with a resolved value', () => {
    const snap = allFlags();
    expect(snap.map((s) => s.def.key)).toEqual(FLAG_DEFS.map((d) => d.key));
    for (const s of snap) expect(typeof s.value).toBe('boolean');
  });

  it('setFlagOverride is a safe no-op without storage (node context)', () => {
    // localStorage is undefined under the node runner; this must not throw.
    expect(() => setFlagOverride('devTools', false)).not.toThrow();
  });
});
