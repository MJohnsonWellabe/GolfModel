/**
 * Build-time constants injected by Vite `define` (see vite.config.ts).
 * Replaced with string literals at build time; `buildInfo.ts` reads them
 * behind a `typeof` guard so unit tests (no define) don't reference them.
 */
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;
