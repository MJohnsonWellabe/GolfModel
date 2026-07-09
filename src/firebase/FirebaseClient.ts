import { FIREBASE } from '../config';
import { mergeProfiles, PlayerProfile } from '../profile/Profile';

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
    const remote = snap.exists() ? (snap.val() as PlayerProfile) : null;
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
