// Recompress the oversized marketing/course-art PNGs IN PLACE (same paths —
// the marketing admin and course cards reference exact filenames). These are
// stylized flat-color game captures, so palette quantization is visually
// lossless and cuts them ~80-90%. Also caps dimensions at their largest
// on-screen use: the landing/setup backgrounds display ≤ ~1600 px wide on any
// phone/desktop we target; card art far smaller. Rerunnable + committed.
//   node scripts/optimize-marketing.mjs
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(root, 'assets', 'marketing', 'img');
const MAX_W = 1600;
const MIN_BYTES = 400_000; // leave already-small images untouched

for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.png')) continue;
  const p = path.join(DIR, f);
  const before = statSync(p).size;
  if (before < MIN_BYTES) continue;
  const img = sharp(p);
  const meta = await img.metadata();
  const buf = await img
    .resize({ width: Math.min(meta.width ?? MAX_W, MAX_W), withoutEnlargement: true })
    .png({ palette: true, quality: 90, compressionLevel: 9, effort: 8 })
    .toBuffer();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(p, buf);
  const after = statSync(p).size;
  console.log(`${f}: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`);
}
