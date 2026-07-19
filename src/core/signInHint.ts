/**
 * "This device was signed in" hint.
 *
 * Written after a successful account adopt and cleared on sign-out, the hint
 * lets a reload render the CACHED account copy instantly (weak-connection fix)
 * while the real auth check + cloud sync reconcile in the background. It carries:
 *  - `name`  — so the Profile button labels correctly before Firebase's SDK
 *    chunks have even downloaded, and
 *  - `admin` — a SYNCHRONOUS signal that a signed-in admin is present on this
 *    device, read at module-load time to unlock the expansion courses in
 *    production for the admin account only (see the COURSES gate in main.ts).
 *
 * This is a UX/rendering hint, not a security boundary — real protection lives
 * in the Firebase rules. Reading it is safe at import time: it touches only
 * localStorage and never throws (storage-unavailable falls through to null).
 */

const SIGNIN_HINT_KEY = 'bsg-signed-in-hint-v1';

export interface SignInHint {
  uid: string;
  name: string;
  admin: boolean;
}

/** Read the persisted hint, or null when absent/invalid/unavailable. A legacy
 *  hint without the `admin` field reads as non-admin. */
export function readSignInHint(): SignInHint | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SIGNIN_HINT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { uid?: unknown; name?: unknown; admin?: unknown };
    return typeof v.uid === 'string' && v.uid
      ? { uid: v.uid, name: typeof v.name === 'string' ? v.name : '', admin: v.admin === true }
      : null;
  } catch {
    return null;
  }
}

/** Persist the hint (best-effort — a blocked storage is a silent no-op). */
export function writeSignInHint(uid: string, name: string, admin: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SIGNIN_HINT_KEY, JSON.stringify({ uid, name, admin }));
  } catch {
    /* hint is best-effort */
  }
}

/** Drop the hint (on sign-out or a definitively-revoked session). */
export function clearSignInHint(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(SIGNIN_HINT_KEY);
  } catch {
    /* best-effort */
  }
}

/** True when this device carries a signed-in ADMIN hint — the synchronous
 *  signal that unlocks the expansion courses in production (admin-only play).
 *  Safe at module-load; cleared on sign-out, so it tracks "an admin is signed
 *  in on this device". */
export function adminUnlocked(): boolean {
  return readSignInHint()?.admin === true;
}
