/**
 * Admin-only read/write of the `/adminDrafts/<key>` subtree via the Firebase
 * SDK, reusing the auth + app the admin dashboard already initialized
 * (src/admin/main.ts). Mirrors MarketingConfig.ts's publish helper.
 *
 * These are STAGING drafts (Next Season Pass, Future Store Items) — NOT public
 * content. Unlike `/marketingConfig` (public-read), `/adminDrafts` must be
 * readable AND writable ONLY by allow-listed admins. The required RTDB rule is
 * documented in docs/FIREBASE_SETUP.md:
 *
 *   "adminDrafts": {
 *     ".read":  "auth != null && root.child('admins').child(auth.uid).val() === true",
 *     ".write": "auth != null && root.child('admins').child(auth.uid).val() === true"
 *   }
 *
 * Until that rule + an /admins/{uid}=true entry are deployed, load/save return a
 * clean 'denied' so the editor surfaces a real error instead of a silent success
 * — a draft is NEVER reported saved when the write did not land.
 */
import { FIREBASE } from '../config';

export type DraftStatus = 'saved' | 'denied' | 'offline' | 'skipped';
export interface DraftResult {
  status: DraftStatus;
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

/** RTDB keys must not contain . $ # [ ] / — guard the caller's key. */
function safeKey(key: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error(`Invalid admin-draft key: ${key}`);
  return key;
}

/**
 * Read the current draft at `/adminDrafts/<key>` via the SDK (admin token).
 * Returns { value } on success (value is null when nothing is saved yet), or a
 * status when the read could not complete — so the editor can tell "no draft
 * yet" (value: null, status: 'saved') apart from "couldn't read" ('denied'/
 * 'offline'), and never silently shows an empty editor over a real draft.
 */
export async function loadAdminDraft<T>(
  key: string
): Promise<{ value: T | null; status: DraftStatus; error?: string }> {
  try {
    const app = await firebaseApp();
    const { getAuth } = await import('firebase/auth');
    const auth = getAuth(app);
    await auth.authStateReady();
    if (!auth.currentUser) return { value: null, status: 'skipped', error: 'Not signed in' };
    const { getDatabase, ref, get } = await import('firebase/database');
    const snap = await get(ref(getDatabase(app), `adminDrafts/${safeKey(key)}`));
    return { value: snap.exists() ? (snap.val() as T) : null, status: 'saved' };
  } catch (e) {
    return {
      value: null,
      status: isPermissionDenied(e) ? 'denied' : 'offline',
      error: (e as { message?: string }).message ?? String(e)
    };
  }
}

/**
 * Persist a draft to `/adminDrafts/<key>` using the signed-in admin's token.
 * Classifies permission-denied (rules not yet deployed) apart from a plain
 * offline failure, so the UI points the owner at the setup doc rather than
 * implying the write silently succeeded.
 */
export async function saveAdminDraft<T>(key: string, draft: T): Promise<DraftResult> {
  try {
    const app = await firebaseApp();
    const { getAuth } = await import('firebase/auth');
    const auth = getAuth(app);
    await auth.authStateReady();
    if (!auth.currentUser) return { status: 'skipped', error: 'Not signed in' };
    const { getDatabase, ref, set } = await import('firebase/database');
    await set(ref(getDatabase(app), `adminDrafts/${safeKey(key)}`), draft);
    return { status: 'saved' };
  } catch (e) {
    return {
      status: isPermissionDenied(e) ? 'denied' : 'offline',
      error: (e as { message?: string }).message ?? String(e)
    };
  }
}

/** Human-readable one-liner for a save/load status (shared by both editors). */
export function draftStatusMessage(res: DraftResult, verb = 'Save'): string {
  switch (res.status) {
    case 'saved':
      return `✅ ${verb}d as draft.`;
    case 'denied':
      return `⛔ Permission denied — deploy the /adminDrafts rule + /admins node (docs/FIREBASE_SETUP.md). Nothing was ${verb.toLowerCase()}d.`;
    case 'skipped':
      return '⚠️ Not signed in — sign in as an admin to save drafts.';
    default:
      return `⚠️ ${verb} failed (offline/other): ${res.error ?? 'unknown'}. Try again — nothing was saved.`;
  }
}
