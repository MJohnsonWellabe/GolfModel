import { FIREBASE } from '../config';
import { mergeProfiles, PlayerProfile } from '../profile/Profile';

/**
 * Full Firebase auth + cloud saves (Phase 5). Everything here is gated on
 * FIREBASE.apiKey being present in config.ts — until the Firebase console
 * setup in docs/FIREBASE_SETUP.md is completed the game runs local-only
 * with zero Firebase code even loaded (dynamic imports).
 *
 * Flow (docs 08 §Account Philosophy — zero auth friction):
 *  - first cloud touch signs in ANONYMOUSLY (invisible to the player)
 *  - profile lives at RTDB /profiles/{uid}, guarded by the rules in the
 *    setup doc (each uid can only read/write its own)
 *  - "Link Google account" upgrades the anonymous user in place, keeping
 *    the uid and therefore all progress
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
      const { getAuth, signInAnonymously, setPersistence, browserLocalPersistence, indexedDBLocalPersistence } =
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
      // Finalize a pending redirect-based link (the iOS-Safari fallback in
      // linkGoogleAccount) so the upgraded account is restored on return before
      // we'd otherwise sign in a fresh anonymous user.
      try {
        const { getRedirectResult } = await import('firebase/auth');
        await getRedirectResult(auth);
      } catch {
        /* no pending redirect */
      }
      // CRITICAL: `auth.currentUser` is null synchronously right after
      // getAuth(); the persisted session (anonymous OR the Google-linked
      // account) restores asynchronously. Wait for it before deciding to sign
      // in — otherwise every load minted a NEW anonymous uid, stranding all
      // saved progress under the previous uid and dropping the Google link.
      await auth.authStateReady();
      if (!auth.currentUser) await signInAnonymously(auth);
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
 * True when the signed-in user has upgraded from the anonymous guest session to
 * a real (e.g. Google) account. Used to hide the "Link Google" prompt on the
 * main menu once the account is already linked.
 */
export async function googleLinked(): Promise<boolean> {
  if (!authConfigured()) return false;
  try {
    const { auth } = await ensureFirebase();
    const u = auth.currentUser;
    return !!u && !u.isAnonymous && u.providerData.length > 0;
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
 * Sign out of the linked account and return to a fresh anonymous guest session.
 * The linked account's progress stays safe in the cloud under its own uid —
 * signing back in restores it.
 */
export async function signOutAccount(): Promise<void> {
  if (!authConfigured()) return;
  try {
    const { auth } = await ensureFirebase();
    const { signOut, signInAnonymously } = await import('firebase/auth');
    await signOut(auth);
    await signInAnonymously(auth);
  } catch {
    /* ignore — stays on the current session */
  }
}

/**
 * Sync the profile with the cloud: pull the stored copy, merge (progress is
 * never lost — see mergeProfiles), push the result. Returns the merged
 * profile, or the input unchanged when the cloud is unreachable/unconfigured.
 */
export async function cloudSyncProfile(profile: PlayerProfile): Promise<PlayerProfile> {
  if (!authConfigured()) return profile;
  try {
    const { auth, db } = await ensureFirebase();
    const uid = auth.currentUser?.uid;
    if (!uid) return profile;
    const { get, ref, set } = await import('firebase/database');
    const snap = await get(ref(db, `profiles/${uid}`));
    const remote = snap.exists() ? (snap.val() as PlayerProfile) : null;
    const merged = remote ? mergeProfiles(profile, remote) : { ...profile, id: uid };
    merged.id = uid;
    await set(ref(db, `profiles/${uid}`), merged);
    return merged;
  } catch {
    return profile; // offline / rules not deployed yet — play continues locally
  }
}

/** Best human-readable name for a signed-in user. */
function accountName(u: { displayName: string | null; email: string | null }): string {
  return u.displayName ?? u.email ?? 'your account';
}

/**
 * Upgrade the anonymous session to a Google account (same uid, progress kept),
 * using a SINGLE popup. If that Google account already has its own Firebase
 * user (credential-already-in-use), we reuse the credential from the same popup
 * to sign into it — no second popup — and cloudSyncProfile merges the local
 * profile up afterwards. Returns the real Google display name (or email), or
 * null if linking failed / was dismissed, or 'redirect' on the iOS fallback.
 */
export async function linkGoogleAccount(): Promise<string | null> {
  if (!authConfigured()) return null;
  try {
    const { auth } = await ensureFirebase();
    const { GoogleAuthProvider, linkWithPopup, linkWithRedirect, signInWithCredential } = await import('firebase/auth');
    const user = auth.currentUser;
    if (!user) return null;
    const provider = new GoogleAuthProvider();
    try {
      const res = await linkWithPopup(user, provider);
      await res.user.reload().catch(() => undefined);
      return accountName(auth.currentUser ?? res.user);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      // Only fall back to a redirect when popups genuinely can't be used (iOS
      // Safari); a user-closed popup should just cancel, not redirect.
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-environment') {
        await linkWithRedirect(user, provider);
        return 'redirect';
      }
      if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
        const cred = GoogleAuthProvider.credentialFromError(
          e as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]
        );
        if (cred) {
          const res = await signInWithCredential(auth, cred);
          await res.user.reload().catch(() => undefined);
          return accountName(auth.currentUser ?? res.user);
        }
      }
      return null; // popup closed / cancelled / unusable
    }
  } catch {
    return null;
  }
}
