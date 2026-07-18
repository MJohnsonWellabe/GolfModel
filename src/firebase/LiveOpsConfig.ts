/**
 * Admin-only read/write of the public `/liveOpsConfig` node (retention
 * live-ops overrides) via the Firebase SDK — the exact pattern of
 * MarketingConfig.ts: SDK publish with the signed-in admin's token, clean
 * status classification, 6s-raced reads so nothing can hang the editor.
 *
 * The game itself never uses this module — it reads the node with a plain
 * REST GET (fetchLiveOpsConfigREST below, no SDK) with a deterministic local
 * fallback, so offline play is unaffected.
 *
 * RULES (docs/FIREBASE_SETUP.md): "liveOpsConfig": { ".read": true,
 *   ".write": "auth != null && root.child('admins').child(auth.uid).val() === true" }
 */
import { FIREBASE } from '../config';
import { LiveOpsAuditEntry, LiveOpsConfig, migrateLiveOpsConfig } from '../data/liveOpsConfig';
import { PublishResult } from './MarketingConfig';

async function firebaseApp(): Promise<import('firebase/app').FirebaseApp> {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  return getApps().length ? getApp() : initializeApp(FIREBASE);
}

function isPermissionDenied(e: unknown): boolean {
  const code = (e as { code?: string }).code ?? '';
  const msg = (e as { message?: string }).message ?? String(e);
  return /permission[_ ]?denied/i.test(code) || /permission[_ ]?denied/i.test(msg);
}

/** SDK read for the admin editor (raced against a 6s timeout). */
export async function loadLiveOpsConfig(): Promise<LiveOpsConfig | null> {
  try {
    const { getDatabase, ref, get } = await import('firebase/database');
    const read = get(ref(getDatabase(await firebaseApp()), 'liveOpsConfig')).then((snap) =>
      snap.exists() ? migrateLiveOpsConfig(snap.val()) : null
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000));
    return await Promise.race([read, timeout]);
  } catch {
    return null;
  }
}

/**
 * Publish to `/liveOpsConfig` (admin token; denied until rules deployed).
 * Formalized (Phase 7): before overwriting, the currently-live config is copied
 * to `/liveOpsConfigPrev` as a one-click rollback point, the publisher's email
 * is stamped on the config, and an append-only entry is written to
 * `/adminAudit/liveOps`. The prev-snapshot and audit writes are best-effort —
 * neither can fail the publish itself.
 */
export async function publishLiveOpsConfig(
  cfg: LiveOpsConfig,
  action: 'publish' | 'revert' = 'publish'
): Promise<PublishResult> {
  try {
    const app = await firebaseApp();
    const { getAuth } = await import('firebase/auth');
    const auth = getAuth(app);
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return { status: 'skipped', error: 'Not signed in' };
    const by = user.email ?? user.uid;
    const { getDatabase, ref, set, get, push } = await import('firebase/database');
    const db = getDatabase(app);
    // Rollback point: snapshot the currently-live config before overwriting.
    try {
      const cur = await get(ref(db, 'liveOpsConfig'));
      if (cur.exists()) await set(ref(db, 'liveOpsConfigPrev'), cur.val());
    } catch {
      /* best-effort — a missing snapshot only disables one revert */
    }
    const stamped: LiveOpsConfig = { ...cfg, publishedBy: by };
    await set(ref(db, 'liveOpsConfig'), stamped);
    // Append-only audit entry (best-effort — never blocks the publish result).
    try {
      const entry: LiveOpsAuditEntry = {
        at: cfg.publishedAt || Date.now(),
        by,
        version: cfg.version,
        dailyCount: Object.keys(cfg.dailyOverrides ?? {}).length,
        weeklyCount: Object.keys(cfg.weeklyOverrides ?? {}).length,
        action
      };
      await push(ref(db, 'adminAudit/liveOps'), entry);
    } catch {
      /* audit is best-effort — the publish already succeeded */
    }
    return { status: 'saved' };
  } catch (e) {
    return {
      status: isPermissionDenied(e) ? 'denied' : 'offline',
      error: (e as { message?: string }).message ?? String(e)
    };
  }
}

/** The rollback snapshot (the config that was live before the last publish). */
export async function loadPrevLiveOpsConfig(): Promise<LiveOpsConfig | null> {
  try {
    const { getDatabase, ref, get } = await import('firebase/database');
    const read = get(ref(getDatabase(await firebaseApp()), 'liveOpsConfigPrev')).then((snap) =>
      snap.exists() ? migrateLiveOpsConfig(snap.val()) : null
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000));
    return await Promise.race([read, timeout]);
  } catch {
    return null;
  }
}

/** Recent audit entries, newest first (best-effort; empty on any failure). */
export async function loadLiveOpsAudit(limit = 12): Promise<LiveOpsAuditEntry[]> {
  try {
    const { getDatabase, ref, get } = await import('firebase/database');
    const read = get(ref(getDatabase(await firebaseApp()), 'adminAudit/liveOps')).then((snap) => {
      if (!snap.exists()) return [];
      const raw = snap.val() as Record<string, LiveOpsAuditEntry>;
      return Object.values(raw)
        .filter((e) => e && typeof e.at === 'number')
        .sort((a, b) => b.at - a.at)
        .slice(0, limit);
    });
    const timeout = new Promise<LiveOpsAuditEntry[]>((resolve) => setTimeout(() => resolve([]), 6000));
    return await Promise.race([read, timeout]);
  } catch {
    return [];
  }
}

/** Public REST read for the GAME (no SDK, no auth): null on absent/offline —
 *  the caller keeps its deterministic defaults. 5s abort so a stalled fetch
 *  never delays anything (it is fired-and-forgotten at menu time, never during
 *  gameplay). */
export async function fetchLiveOpsConfigREST(baseUrl: string): Promise<LiveOpsConfig | null> {
  if (!baseUrl) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/liveOpsConfig.json`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return data && typeof data === 'object' ? migrateLiveOpsConfig(data) : null;
  } catch {
    return null;
  }
}
