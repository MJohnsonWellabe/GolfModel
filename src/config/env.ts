/**
 * Environment resolver (V2 dev-environment foundation — see
 * docs/technical/DEVELOPMENT_ENVIRONMENT_AND_RELEASES.md).
 *
 * The game ships a single bundle that behaves as PRODUCTION on the production
 * hostnames and as DEVELOPMENT everywhere else. This module is the ONE place
 * that decides which, and returns a validated config object the rest of the
 * app reads through `src/config.ts`.
 *
 * Production safety — the whole point of this design:
 *  - On a production hostname the resolver returns the exact production
 *    literals that used to live in config.ts. A real player loads byte-for-byte
 *    what they loaded before this module existed. Nothing here can change
 *    production behavior.
 *  - Development NEVER writes to production data. Until a separate dev Firebase
 *    project is configured (a deferred human step), development falls back to
 *    LOCAL-ONLY: an empty Firebase apiKey keeps the entire cloud/auth layer
 *    dormant (see FirebaseClient.authConfigured) and an empty leaderboard URL
 *    makes every REST transport a no-op. This is safer than a same-project
 *    "dev/" namespace (no path retrofit, no chance of a stray production write)
 *    and satisfies the spec's data-isolation requirement outright.
 *
 * When a real dev project is stood up later, set the VITE_DEV_FIREBASE_* build
 * variables and development uses that project wholesale — no code change here.
 */

export type EnvName = 'prod' | 'dev';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  databaseURL: string;
}

export interface EnvConfig {
  /** 'prod' | 'dev'. */
  name: EnvName;
  /** Convenience: name === 'prod'. */
  isProd: boolean;
  /** Shared leaderboard / RTDB REST base. Empty string = local-only. */
  leaderboardUrl: string;
  /** Firebase web-app config. Empty apiKey = auth/cloud layer stays dormant. */
  firebase: FirebaseConfig;
  /** RTDB node analytics events land under (kept distinct per environment). */
  analyticsNamespace: string;
  /** RTDB node the admin allowlist lives under (rules-gated). */
  adminPath: string;
  /** Console verbosity for the app logger (dev is chattier than prod). */
  logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}

/** Hostnames that serve the live production game. Everything else is dev. */
export const PROD_HOSTNAMES: readonly string[] = [
  'bsgolf.fun',
  'www.bsgolf.fun',
  'mjohnsonwellabe.github.io'
];

/**
 * The production Firebase project (golfgame-9c11e). These are PUBLIC identifiers
 * — security lives in the database rules — and are the same literals that were
 * previously hardcoded in config.ts. This is now their single source of truth.
 */
const PROD_FIREBASE: FirebaseConfig = {
  apiKey: 'AIzaSyAdEG6OgXAL8qugqO4PZUv37QKAV193r8M',
  authDomain: 'golfgame-9c11e.firebaseapp.com',
  projectId: 'golfgame-9c11e',
  appId: '1:122624336711:web:7dd59548b19d434d60a262',
  databaseURL: 'https://golfgame-9c11e-default-rtdb.firebaseio.com'
};

/** Minimal shape of `import.meta.env` we read — keeps the resolver testable. */
export type MetaEnvLike = Record<string, string | undefined>;

function readEnvOverride(search: string): EnvName | null {
  try {
    const v = new URLSearchParams(search).get('env');
    return v === 'dev' || v === 'prod' ? v : null;
  } catch {
    return null;
  }
}

/** Which environment a given hostname + query string resolves to. */
export function resolveEnvName(hostname: string, search: string): EnvName {
  const override = readEnvOverride(search);
  if (override) return override;
  return PROD_HOSTNAMES.includes(hostname) ? 'prod' : 'dev';
}

/**
 * Build the dev Firebase config from build-time variables. All-empty (no dev
 * project configured yet) is the intentional LOCAL-ONLY fallback. A PARTIALLY
 * set config is a misconfiguration and throws — the spec requires the build to
 * fail clearly when required environment config is missing.
 */
function devFirebase(meta: MetaEnvLike): FirebaseConfig {
  const apiKey = meta.VITE_DEV_FIREBASE_API_KEY ?? '';
  if (!apiKey) {
    return { apiKey: '', authDomain: '', projectId: '', appId: '', databaseURL: '' };
  }
  const fb: FirebaseConfig = {
    apiKey,
    authDomain: meta.VITE_DEV_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: meta.VITE_DEV_FIREBASE_PROJECT_ID ?? '',
    appId: meta.VITE_DEV_FIREBASE_APP_ID ?? '',
    databaseURL: meta.VITE_DEV_FIREBASE_DB_URL ?? ''
  };
  const missing = (['authDomain', 'projectId', 'appId', 'databaseURL'] as const).filter(
    (k) => !fb[k]
  );
  if (missing.length) {
    throw new Error(
      `[env] Dev Firebase config is incomplete — missing ${missing.join(', ')}. ` +
        `Set every VITE_DEV_FIREBASE_* build variable, or clear them all to run ` +
        `development local-only.`
    );
  }
  return fb;
}

/** Resolve the full environment config from raw inputs (pure — unit-testable). */
export function resolveEnv(hostname: string, search: string, meta: MetaEnvLike): EnvConfig {
  const name = resolveEnvName(hostname, search);
  if (name === 'prod') {
    return {
      name,
      isProd: true,
      leaderboardUrl: PROD_FIREBASE.databaseURL,
      firebase: PROD_FIREBASE,
      analyticsNamespace: 'events',
      adminPath: 'admins',
      logLevel: 'warn'
    };
  }
  const firebase = devFirebase(meta);
  return {
    name,
    isProd: false,
    // Empty when local-only → REST leaderboard/analytics stay dormant.
    leaderboardUrl: firebase.databaseURL,
    firebase,
    analyticsNamespace: 'dev_events',
    adminPath: 'admins',
    logLevel: 'debug'
  };
}

function currentHostname(): string {
  return typeof location !== 'undefined' ? location.hostname : '';
}
function currentSearch(): string {
  return typeof location !== 'undefined' ? location.search : '';
}
function currentMeta(): MetaEnvLike {
  // `import.meta.env` is injected by Vite; `{}` in a plain test/node context.
  return ((import.meta as unknown as { env?: MetaEnvLike }).env ?? {}) as MetaEnvLike;
}

/** The resolved environment for this page load. */
export const ENV: EnvConfig = resolveEnv(currentHostname(), currentSearch(), currentMeta());
