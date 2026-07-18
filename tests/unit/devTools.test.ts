import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * devTools activation + date-simulation seam. ENV resolves from the
 * hostname at import time, so each case stubs the environment module and
 * re-imports fresh.
 */

async function loadWith(isProd: boolean, flagOn: boolean) {
  vi.resetModules();
  vi.doMock('../../src/config/env', () => ({ ENV: { isProd, name: isProd ? 'prod' : 'dev' } }));
  vi.doMock('../../src/core/flags', () => ({ flag: (k: string) => (k === 'devTools' ? flagOn : false) }));
  return import('../../src/core/devTools');
}

// Minimal localStorage stub (node test env has none).
const store = new Map<string, string>();
beforeEach(() => store.clear());
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear()
};

describe('devTools hard gate', () => {

  it('inactive in production even with the flag forced on', async () => {
    const dt = await loadWith(true, true);
    expect(dt.devToolsActive()).toBe(false);
    dt.setDevDateOverride('2026-12-25'); // must be a no-op
    expect(dt.devDateOverride()).toBeNull();
    // devNow falls back to real time (same calendar day as new Date()).
    expect(dt.devNow().toDateString()).toBe(new Date().toDateString());
  });

  it('inactive in dev with the flag off', async () => {
    const dt = await loadWith(false, false);
    expect(dt.devToolsActive()).toBe(false);
  });

  it('active in dev with the flag on; date override round-trips', async () => {
    const dt = await loadWith(false, true);
    expect(dt.devToolsActive()).toBe(true);
    dt.setDevDateOverride('2026-12-25');
    expect(dt.devDateOverride()).toBe('2026-12-25');
    expect(dt.devNow().getFullYear()).toBe(2026);
    expect(dt.devNow().getMonth()).toBe(11);
    expect(dt.devNow().getDate()).toBe(25);
    dt.setDevDateOverride(null);
    expect(dt.devDateOverride()).toBeNull();
  });

  it('rejects malformed date keys', async () => {
    const dt = await loadWith(false, true);
    dt.setDevDateOverride('christmas');
    expect(dt.devDateOverride()).toBeNull();
  });
});
