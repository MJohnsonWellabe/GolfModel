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
      const { getAuth, signInAnonymously } = await import('firebase/auth');
      const { getDatabase } = await import('firebase/database');
      const app = initializeApp({
        apiKey: FIREBASE.apiKey,
        authDomain: FIREBASE.authDomain,
        projectId: FIREBASE.projectId,
        appId: FIREBASE.appId,
        databaseURL: FIREBASE.databaseURL
      });
      const auth = getAuth(app);
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

/**
 * Upgrade the anonymous session to a Google account (same uid, progress
 * kept). Popup first, redirect fallback for iOS Safari. Returns the linked
 * display name, or null if linking failed / was dismissed.
 */
export async function linkGoogleAccount(): Promise<string | null> {
  if (!authConfigured()) return null;
  try {
    const { auth } = await ensureFirebase();
    const { GoogleAuthProvider, linkWithPopup, linkWithRedirect } = await import('firebase/auth');
    const user = auth.currentUser;
    if (!user) return null;
    const provider = new GoogleAuthProvider();
    try {
      const res = await linkWithPopup(user, provider);
      return res.user.displayName ?? res.user.email ?? 'linked';
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (code.includes('popup')) {
        await linkWithRedirect(user, provider);
        return 'redirect';
      }
      if (code === 'auth/credential-already-in-use') {
        // Account exists: sign into it instead (cloud copy will merge in)
        const { signInWithPopup } = await import('firebase/auth');
        const res = await signInWithPopup(auth, provider);
        return res.user.displayName ?? 'linked';
      }
      return null;
    }
  } catch {
    return null;
  }
}
