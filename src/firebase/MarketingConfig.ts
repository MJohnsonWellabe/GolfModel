/**
 * Admin-only read/write of the public `/marketingConfig` node via the Firebase
 * SDK, reusing the auth + app already initialized by the admin dashboard
 * (src/admin/main.ts) and the write pattern from cloudSyncProfile.
 *
 * PUBLISH RULES NOTE: writing this node requires the RTDB rule documented in
 * docs/FIREBASE_SETUP.md —
 *   "marketingConfig": { ".read": true,
 *     ".write": "auth != null && root.child('admins').child(auth.uid).val() === true" }
 * plus an /admins/{uid}=true entry for the owner. UNTIL that rule + node are
 * deployed in the console, publishMarketingConfig() returns { status: 'denied' }
 * (a clean permission-denied) and the live About page keeps rendering the static
 * fallback — nothing breaks, the change simply doesn't go live yet.
 */
import { FIREBASE } from '../config';
import { MarketingConfig } from '../marketing/config';

export type PublishStatus = 'saved' | 'denied' | 'offline' | 'skipped';
export interface PublishResult {
  status: PublishStatus;
  error?: string;
}

async function firebaseApp(): Promise<import('firebase/app').FirebaseApp> {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  return getApps().length ? getApp() : initializeApp(FIREBASE);
}

function isPermissionDenied(e: unknown): boolean {
  const code = (e as { code?: string }).code ?? '';
  const msg = (e as { message?: string }).message ?? String(e);
  return /permission[_ ]?denied/i.test(code) || /permission[_ ]?denied/i.test(msg);
}

/** Read the current published config via the SDK. Returns null on absent/failure/
 *  timeout (the admin then loads the built-in default to edit) — the read is
 *  raced against a timeout so a stuck connection can never hang the editor on a
 *  "Loading…" screen. */
export async function loadMarketingConfig(): Promise<MarketingConfig | null> {
  try {
    const { getDatabase, ref, get } = await import('firebase/database');
    const read = get(ref(getDatabase(await firebaseApp()), 'marketingConfig')).then((snap) =>
      snap.exists() ? (snap.val() as MarketingConfig) : null
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000));
    return await Promise.race([read, timeout]);
  } catch {
    return null;
  }
}

/**
 * Publish the draft to `/marketingConfig` using the signed-in admin's token.
 * Mirrors cloudSyncProfile: classifies permission-denied (rules not yet deployed)
 * distinctly from a plain offline failure so the UI can point the owner at the
 * setup doc rather than imply the write silently failed.
 */
export async function publishMarketingConfig(draft: MarketingConfig): Promise<PublishResult> {
  try {
    const app = await firebaseApp();
    const { getAuth } = await import('firebase/auth');
    const auth = getAuth(app);
    await auth.authStateReady();
    if (!auth.currentUser) return { status: 'skipped', error: 'Not signed in' };
    const { getDatabase, ref, set } = await import('firebase/database');
    await set(ref(getDatabase(app), 'marketingConfig'), draft);
    return { status: 'saved' };
  } catch (e) {
    return {
      status: isPermissionDenied(e) ? 'denied' : 'offline',
      error: (e as { message?: string }).message ?? String(e)
    };
  }
}
