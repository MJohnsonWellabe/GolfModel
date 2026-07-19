import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd(), 'assets');
const OUT = path.resolve(process.cwd(), 'assets/environment/generated-inventory.json');
const ABSOLUTE_LIMIT = 30 * 1024 * 1024;
const WARN_LIMIT = 8 * 1024 * 1024;
const TRACKED_EXTENSIONS = new Set(['.glb', '.gltf', '.bin', '.png', '.jpg', '.jpeg', '.webp', '.ktx2']);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (TRACKED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

function mb(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

let files;
try {
  files = await walk(ROOT);
} catch (error) {
  console.error(`[asset-audit] unable to scan ${ROOT}:`, error);
  process.exit(1);
}

const inventory = [];
let failed = false;
for (const file of files) {
  const info = await stat(file);
  const relativePath = path.relative(process.cwd(), file).split(path.sep).join('/');
  const status = info.size >= ABSOLUTE_LIMIT ? 'fail' : info.size >= WARN_LIMIT ? 'warn' : 'ok';
  if (status === 'fail') failed = true;
  inventory.push({ path: relativePath, bytes: info.size, megabytes: mb(info.size), status });
}

inventory.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));

const report = {
  generatedAt: new Date().toISOString(),
  rules: {
    absoluteMaximumBytes: ABSOLUTE_LIMIT,
    warningBytes: WARN_LIMIT,
    note: 'No single committed asset may reach 30 MB. Environment GLBs should normally stay below 8 MB.'
  },
  totals: {
    files: inventory.length,
    bytes: inventory.reduce((sum, item) => sum + item.bytes, 0),
    megabytes: mb(inventory.reduce((sum, item) => sum + item.bytes, 0)),
    warnings: inventory.filter((item) => item.status === 'warn').length,
    failures: inventory.filter((item) => item.status === 'fail').length
  },
  files: inventory
};

await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`\nEnvironment asset inventory: ${inventory.length} files, ${report.totals.megabytes} MB total\n`);
console.table(inventory.map(({ path: filePath, megabytes, status }) => ({ file: filePath, MB: megabytes, status })));
console.log(`\nWrote ${path.relative(process.cwd(), OUT)}\n`);

if (failed) {
  console.error(`[asset-audit] FAILED: ${report.totals.failures} asset(s) are at or above 30 MB.`);
  process.exit(1);
}

if (report.totals.warnings) {
  console.warn(`[asset-audit] ${report.totals.warnings} asset(s) exceed the preferred 8 MB budget.`);
}
