import { FIREBASE } from '../config';
import { mergeProfiles, migrateProfile, PlayerProfile } from '../profile/Profile';

/**
 * Full Firebase auth + cloud saves (Phase 5). Everything here is gated on
 * FIREBASE.apiKey being present in config.ts — until the Firebase console
 * setup in docs/FIREBASE_SETUP.md is completed the game runs local-only
 * with zero Firebase code even loaded (dynamic imports).
 *
 * Flow (account-gated progression — docs 08 §Account Philosophy):
 *  - NO anonymous auto-sign-in. The cloud is touched only once the player
 *    signs in with Google; signed-out play is purely ephemeral (main.ts).
 *  - a signed-in player's profile lives at RTDB /profiles/{uid}, guarded by
 *    the rules in the setup doc (each uid can only read/write its own)
 *  - signing in on a device merges any local progress up once (mergeProfiles,
 *    grow-only counters), so switching to an account never loses coins
 */

export function authConfigured(): boolean {
  return Boolean(FIREBASE.apiKey && FIREBASE.appId);
}

interface FirebaseHandles {
  auth: import('firebase/auth').Auth;
  db: import('firebase/database').Database;
}

let handles: Promise<FirebaseHandles> | null = null;

async function ensureFirebase(): Promise<FirebaseHandles> {
  if (!handles) {
    handles = (async () => {
      const { initializeApp } = await import('firebase/app');
      const { getAuth, setPersistence, browserLocalPersistence, indexedDBLocalPersistence } =
        await import('firebase/auth');
      const { getDatabase } = await import('firebase/database');
      const app = initializeApp({
        apiKey: FIREBASE.apiKey,
        authDomain: FIREBASE.authDomain,
        projectId: FIREBASE.projectId,
        appId: FIREBASE.appId,
        databaseURL: FIREBASE.databaseURL
      });
      const auth = getAuth(app);
      // Persist the session (and therefore the uid) across reloads so progress
      // stays attached to one account. Prefer IndexedDB, fall back to
      // localStorage — without this, some browsers drop the anonymous/linked
      // session and a new uid is minted, appearing to lose all progress.
      try {
        await setPersistence(auth, indexedDBLocalPersistence);
      } catch {
        try {
          await setPersistence(auth, browserLocalPersistence);
        } catch {
          /* in-memory only — nothing more we can do */
        }
      }
      // Finalize a pending redirect-based sign-in (the iOS-Safari fallback in
      // signInWithGoogle) so the account is restored on return.
      try {
        const { getRedirectResult } = await import('firebase/auth');
        await getRedirectResult(auth);
      } catch {
        /* no pending redirect */
      }
      // CRITICAL: `auth.currentUser` is null synchronously right after
      // getAuth(); a persisted Google session restores asynchronously. Wait for
      // it so a returning signed-in player is recognized before we render.
      // No anonymous fallback: signed-out means genuinely no cloud user, and
      // progress is only ever attached to a real (Google) account.
      await auth.authStateReady();
      return { auth, db: getDatabase(app) };
    })();
  }
  return handles;
}

/** Shared auth+db handles for sibling firebase modules (Purchases). Null when
 *  auth is unconfigured or init fails — callers degrade to local-only. */
export async function firebaseHandles(): Promise<FirebaseHandles | null> {
  if (!authConfigured()) return null;
  try {
    return await ensureFirebase();
  } catch {
    return null;
  }
}

/** The signed-in account's email (lowercased), or null. Used to gate the
 *  in-game link to the admin dashboard. */
export async function cloudEmail(): Promise<string | null> {
  if (!authConfigured()) return null;
  try {
    const { auth } = await ensureFirebase();
    return auth.currentUser?.email?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** The signed-in uid, or null when auth is unconfigured/unavailable. */
export async function cloudUid(): Promise<string | null> {
  if (!authConfigured()) return null;
  try {
    const { auth } = await ensureFirebase();
    return auth.currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

/**
 * Admin-only: gift Season XP / True Vision charges to another account by
 * email (functions/index.js `giftSeasonReward`). The callable itself
 * re-checks the admin allowlist server-side, so a non-admin caller gets a
 * clean 'permission-denied' error back rather than any write happening.
 */
export interface GiftResult {
  ok: boolean;
  error?: string;
  grantedXp?: number;
  grantedTrueVision?: number;
}

export async function giftSeasonReward(
  targetEmail: string,
  seasonXp: number,
  trueVisionCharges: number
): Promise<GiftResult> {
  if (!authConfigured()) return { ok: false, error: 'Firebase not configured' };
  try {
    const { auth } = await ensureFirebase();
    if (!auth.currentUser) return { ok: false, error: 'Not signed in' };
    const { getApp } = await import('firebase/app');
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const fns = getFunctions(getApp(), 'us-central1');
    const call = httpsCallable(fns, 'giftSeasonReward');
    const res = await call({ targetEmail, seasonXp, trueVisionCharges });
    return { ok: true, ...(res.data as object) };
  } catch (e) {
    return { ok: false, error: (e as { message?: string }).message ?? String(e) };
  }
}

/**
 * True once the player has signed in with a real (Google) account. With no
 * anonymous auto-sign-in, this is the single gate for "progress is saved":
 * signed out → ephemeral local play; signed in → cloud-backed account.
 */
export async function isSignedIn(): Promise<boolean> {
  if (!authConfigured()) return false;
  try {
    const { auth } = await ensureFirebase();
    const u = auth.currentUser;
    return !!u && !u.isAnonymous;
  } catch {
    return false;
  }
}

/**
 * Three-state auth check for boot flows that render optimistically from a
 * local cache: 'in' / 'out' are DEFINITIVE answers from a restored auth
 * state; 'unknown' means the SDK itself was unreachable (offline / chunks
 * failed to download / 15s cap) — the caller must NOT treat that as signed
 * out, or a weak connection wipes a genuinely signed-in device's view.
 */
export async function authState(): Promise<'in' | 'out' | 'unknown'> {
  if (!authConfigured()) return 'out';
  try {
    const handlesOrTimeout = await Promise.race([
      ensureFirebase(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000))
    ]);
    if (!handlesOrTimeout) return 'unknown';
    const u = handlesOrTimeout.auth.currentUser;
    return u && !u.isAnonymous ? 'in' : 'out';
  } catch {
    return 'unknown';
  }
}

/**
 * Display name (or email) of the linked account, or null when the session is
 * still an anonymous guest / unconfigured. Drives the "Signed in as …" label so
 * the Profile and menu reflect the persistent link state instead of always
 * offering to link.
 */
export async function linkedAccountName(): Promise<string | null> {
  if (!authConfigured()) return null;
  try {
    const { auth } = await ensureFirebase();
    const u = auth.currentUser;
    if (!u || u.isAnonymous || u.providerData.length === 0) return null;
    return u.displayName ?? u.email ?? 'your account';
  } catch {
    return null;
  }
}

/**
 * Sign out of the account, leaving NO cloud user signed in (no anonymous
 * fallback). The account's progress stays safe in the cloud under its own uid —
 * signing back in restores it. The caller (main.ts) resets the local view to a
 * fresh empty profile so signed-out truly shows no coins/records.
 */
export async function signOutAccount(): Promise<void> {
  if (!authConfigured()) return;
  try {
    const { auth } = await ensureFirebase();
    const { signOut } = await import('firebase/auth');
    await signOut(auth);
  } catch {
    /* ignore — stays on the current session */
  }
}

/**
 * Outcome of a cloud sync, so the UI can show the player whether their progress
 * actually reached the cloud:
 *  - 'saved'   — pulled, merged, and wrote back successfully
 *  - 'denied'  — permission denied: the RTDB rules for profiles/{uid} aren't
 *                published (docs/FIREBASE_SETUP.md). THE cause of "coins vanish".
 *  - 'offline' — network/other error; retried on the next sync
 *  - 'skipped' — signed out or auth unconfigured (nothing to save)
 */
export type CloudSaveStatus = 'saved' | 'denied' | 'offline' | 'skipped';
export interface CloudSyncResult {
  profile: PlayerProfile;
  status: CloudSaveStatus;
}

function isPermissionDenied(e: unknown): boolean {
  const code = (e as { code?: string }).code ?? '';
  const msg = (e as { message?: string }).message ?? String(e);
  return /permission[_ ]?denied/i.test(code) || /permission[_ ]?denied/i.test(msg);
}

/**
 * Sync the profile with the cloud for a SIGNED-IN player: pull the stored copy,
 * merge (progress is never lost — see mergeProfiles), push the result. Returns
 * the merged profile plus a status so the UI can confirm the save reached the
 * cloud (or surface a rules/offline failure instead of a silent reset-to-zero).
 */
export async function cloudSyncProfile(profile: PlayerProfile): Promise<CloudSyncResult> {
  if (!authConfigured()) return { profile, status: 'skipped' };
  try {
    const { auth, db } = await ensureFirebase();
    const u = auth.currentUser;
    // Only signed-in players have a cloud profile — a signed-out session is
    // ephemeral and must never write to the cloud.
    if (!u || u.isAnonymous) return { profile, status: 'skipped' };
    const uid = u.uid;
    const { get, ref, set } = await import('firebase/database');
    const snap = await get(ref(db, `profiles/${uid}`));
    // Normalize the cloud copy: RTDB omits empty arrays/objects/null, so the
    // snapshot reads back with collections undefined. migrateProfile backfills
    // them to a complete profile before merging (otherwise the merge threw and
    // the save silently aborted — the "coins never persist" bug).
    const remote = snap.exists() ? migrateProfile(snap.val() as Partial<PlayerProfile>) : null;
    const merged = remote ? mergeProfiles(profile, remote) : { ...profile, id: uid };
    merged.id = uid;
    await set(ref(db, `profiles/${uid}`), merged);
    return { profile: merged, status: 'saved' };
  } catch (e) {
    const denied = isPermissionDenied(e);
    console.warn(
      denied
        ? '[cloud] profile save DENIED — publish the RTDB rules (docs/FIREBASE_SETUP.md):'
        : '[cloud] profile sync failed (offline); will retry:',
      e
    );
    return { profile, status: denied ? 'denied' : 'offline' };
  }
}

/** Best human-readable name for a signed-in user. */
function accountName(u: { displayName: string | null; email: string | null }): string {
  return u.displayName ?? u.email ?? 'your account';
}

/**
 * Sign in with Google (account-gated model — there is no anonymous user to
 * "link", so this is a plain sign-in that works for both new and existing
 * accounts). Uses a SINGLE popup; falls back to a redirect only where popups
 * genuinely can't be used (iOS Safari) — a user-closed popup just cancels.
 * Returns the account's display name (or email), null if dismissed/failed, or
 * 'redirect' on the iOS fallback. After a successful sign-in the caller merges
 * the local profile up via cloudSyncProfile so current progress is kept.
 */
export async function signInWithGoogle(): Promise<string | null> {
  if (!authConfigured()) return null;
  try {
    const { auth } = await ensureFirebase();
    const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    // Always show Google's account chooser. Without this, Google silently reuses
    // the device's active session — on iPhone (usually one Safari-signed-in
    // Google account) that means "Log in with Google" auto-signs the wrong
    // account with no way to pick another. `prompt: 'select_account'` forces the
    // picker every time so the player chooses which account to use.
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const res = await signInWithPopup(auth, provider);
      await res.user.reload().catch(() => undefined);
      return accountName(auth.currentUser ?? res.user);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-environment') {
        await signInWithRedirect(auth, provider);
        return 'redirect';
      }
      return null; // popup closed / cancelled / unusable
    }
  } catch {
    return null;
  }
}
