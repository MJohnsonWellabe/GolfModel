// Re-measure the Tour Season field against the live simulator and print the
// per-course winning-score stats + suggested easing deltas for
// src/data/courseDifficulty.ts. See scripts/calibrateTourField.entry.ts.
//
//   node scripts/calibrate-tour-field.mjs
//
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'jg-calibrate-'));
const outfile = join(out, 'calibrate.mjs');
try {
  const res = await build({
    entryPoints: [join(root, 'scripts/calibrateTourField.entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'error'
  });
  if (res.errors.length) {
    console.error(res.errors);
    process.exit(1);
  }
  const run = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
  process.exit(run.status ?? 1);
} finally {
  rmSync(out, { recursive: true, force: true });
}
