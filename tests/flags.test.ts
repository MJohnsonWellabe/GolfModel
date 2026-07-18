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

  it('the V2 polish flags are dev-on / prod-off (preview in dev, release by flip)', () => {
    for (const key of ['delight', 'juice', 'atmosphere']) {
      const def = FLAG_DEFS.find((d) => d.key === key);
      expect(def, key).toBeTruthy();
      expect(def!.defaults.dev, `${key} dev`).toBe(true);
      expect(def!.defaults.prod, `${key} prod`).toBe(false);
    }
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
