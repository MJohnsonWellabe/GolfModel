/**
 * Stable, privacy-conscious identity for GUEST play + per-visit sessions.
 *
 * The account-gated model (docs 08) keeps signed-out PROGRESS ephemeral — but
 * the Admin Statistics dashboard still needs to COUNT guest activity without
 * pretending a guest is an account. This module mints:
 *
 *  - a GUEST id (`g-<uuid>`): random, contains no personal information, stored
 *    device-locally so the same phone/browser keeps one identity across
 *    navigation and repeat play (NOT one per page view). Different browsers/
 *    devices are different guests — unrelated users are never merged.
 *  - a SESSION id (`s-<uuid>`): one per page load, in-memory only.
 *
 * When a guest later signs in, analytics events start carrying BOTH the uid
 * and this gid, and an `identity_linked` event records the association — so
 * the dashboard can attribute the guest's earlier sessions to the account
 * without double-counting completed rounds (each round event exists exactly
 * once either way).
 *
 * Storage failures (private mode, blocked storage) degrade to a per-page-load
 * guest id — gameplay is never blocked.
 */

import { KVStorage } from './Profile';

const GUEST_KEY = 'johnsons-golf-guest-v1';

function defaultStorage(): KVStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function randomId(prefix: string): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `${prefix}-${rnd}`;
}

/** In-memory fallback when storage is unavailable (still stable per load). */
let memoryGuestId: string | null = null;

/** The device's stable guest id, minting one on first call. */
export function guestId(storage: KVStorage | null = defaultStorage()): string {
  if (!storage) {
    if (!memoryGuestId) memoryGuestId = randomId('g');
    return memoryGuestId;
  }
  try {
    const existing = storage.getItem(GUEST_KEY);
    if (existing && /^g-[\w-]{6,}$/.test(existing)) return existing;
    const fresh = randomId('g');
    storage.setItem(GUEST_KEY, fresh);
    return fresh;
  } catch {
    if (!memoryGuestId) memoryGuestId = randomId('g');
    return memoryGuestId;
  }
}

/** One session id per page load (lazy, in-memory). */
let sessionIdValue: string | null = null;
export function sessionId(): string {
  if (!sessionIdValue) sessionIdValue = randomId('s');
  return sessionIdValue;
}

/** Test hook: reset the in-memory session/guest fallbacks. */
export function _resetIdentityForTests(): void {
  sessionIdValue = null;
  memoryGuestId = null;
}
