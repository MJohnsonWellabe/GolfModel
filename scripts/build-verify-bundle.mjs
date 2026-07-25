// Bundles the server-side score verifier for Cloud Functions.
//
//   node scripts/build-verify-bundle.mjs
//   → functions/verifyRound.bundle.cjs
//
// The verifier replays a submitted round through the REAL physics
// (src/systems/RoundReplay.ts) and compares the score it produces with the
// score the client claimed. For that to mean anything, the server must run the
// same code as the game — not a re-implementation that can drift. Bundling the
// actual TypeScript modules is what guarantees that.
//
// The entry point (src/server/verifyEntry.ts) imports only pure systems, so the
// bundle contains physics, geometry, course JSON and nothing else: no Babylon,
// no DOM, no Firebase. If this bundle ever grows past a megabyte or so, an
// import has leaked into the server path and should be traced.
//
// REGENERATE AND REDEPLOY whenever physics, course data or the replay changes —
// a stale bundle silently judges rounds by old rules. `npm run build:verify`
// is wired into the same command that builds the site so it is hard to forget.
import { build } from 'esbuild';
import { statSync } from 'node:fs';

const OUT = 'functions/verifyRound.bundle.cjs';

await build({
  entryPoints: ['src/server/verifyEntry.ts'],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  target: 'node20',
  // CommonJS: functions/index.js is CJS and `require`s this directly.
  format: 'cjs',
  minify: true,
  sourcemap: false,
  // The client build injects these; the server never reads them, but the
  // modules that mention them must still compile.
  define: {
    __APP_VERSION__: '"server"',
    __BUILD_SHA__: '"server"',
    __BUILD_TIME__: '"server"'
  },
  logLevel: 'warning'
});

const kb = Math.round(statSync(OUT).size / 1024);
console.log(`${OUT} — ${kb} KB`);
if (kb > 1500) {
  console.warn(
    `WARNING: the verifier bundle is ${kb} KB. It should be physics + course JSON only; ` +
      'something heavy (Babylon, Firebase, the DOM) has leaked into src/server/verifyEntry.ts.'
  );
  process.exitCode = 1;
}
