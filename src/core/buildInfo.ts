/**
 * Build identity for support/debugging — the app version, the git SHA of the
 * build, and when it was built. Injected by Vite `define` (vite.config.ts);
 * under the unit runner (no define) the `typeof` guards fall back to 'dev'.
 *
 * Surfaced in the admin footer and the dev environment badge so a bug report
 * can name the exact build without guesswork.
 */

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const BUILD_SHA: string = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

/** Compact, human-readable build label, e.g. "v1.0.0 · a2050e7". */
export function buildLabel(): string {
  return `v${APP_VERSION} · ${BUILD_SHA}`;
}

/** Full label including build time when known. */
export function buildLabelLong(): string {
  const when = BUILD_TIME ? ` · ${BUILD_TIME.replace('T', ' ').replace(/\..*$/, ' UTC')}` : '';
  return `${buildLabel()}${when}`;
}
