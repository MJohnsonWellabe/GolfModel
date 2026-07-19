import { beforeEach, describe, expect, it } from 'vitest';
import { adminUnlocked, clearSignInHint, readSignInHint, writeSignInHint } from '../../src/core/signInHint';

/**
 * The sign-in hint is the SYNCHRONOUS device-local signal that (a) labels the
 * Profile button before Firebase loads and (b) unlocks the expansion courses in
 * production for the admin account only (`adminUnlocked()` is read while the
 * COURSES map is built at import). These tests pin the round-trip, the
 * legacy-hint back-compat, and the admin lifecycle.
 */

// Minimal localStorage stub (the node test env has none).
const store = new Map<string, string>();
beforeEach(() => store.clear());
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear()
};

const HINT_KEY = 'bsg-signed-in-hint-v1';

describe('sign-in hint', () => {
  it('round-trips uid/name/admin', () => {
    writeSignInHint('uid-1', 'Ada', true);
    expect(readSignInHint()).toEqual({ uid: 'uid-1', name: 'Ada', admin: true });
  });

  it('a non-admin hint reads admin:false and does not unlock', () => {
    writeSignInHint('uid-2', 'Grace', false);
    expect(readSignInHint()?.admin).toBe(false);
    expect(adminUnlocked()).toBe(false);
  });

  it('adminUnlocked() is true only for an admin hint', () => {
    expect(adminUnlocked()).toBe(false); // no hint
    writeSignInHint('uid-3', 'Root', true);
    expect(adminUnlocked()).toBe(true);
  });

  it('a legacy hint without the admin field reads as non-admin', () => {
    store.set(HINT_KEY, JSON.stringify({ uid: 'uid-4', name: 'Legacy' }));
    expect(readSignInHint()).toEqual({ uid: 'uid-4', name: 'Legacy', admin: false });
    expect(adminUnlocked()).toBe(false);
  });

  it('clearing the hint drops the admin unlock (sign-out)', () => {
    writeSignInHint('uid-5', 'Root', true);
    expect(adminUnlocked()).toBe(true);
    clearSignInHint();
    expect(readSignInHint()).toBeNull();
    expect(adminUnlocked()).toBe(false);
  });

  it('malformed / empty storage fails safe to null (never throws at import)', () => {
    store.set(HINT_KEY, '{not json');
    expect(readSignInHint()).toBeNull();
    store.set(HINT_KEY, JSON.stringify({ name: 'no uid' })); // uid missing
    expect(readSignInHint()).toBeNull();
    expect(adminUnlocked()).toBe(false);
  });
});
