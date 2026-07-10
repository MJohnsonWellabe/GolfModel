// Downscale the purchased Unity terrain-layer grass texture into a small,
// web-sized tiling pair for the ground-bake grain sampler and the ground
// material's bump map.
//
//   npm run convert:turf
//
// Source: asset-packs/forest-nature-fbx/Grass/ (2048x2048 PNGs, ~33MB total
// across albedo/normal/flower variants — moved out of the served assets/
// tree specifically because that's too heavy to ship). Output: 512x512 jpg
// at ~85% quality — under 180KB combined, trivial next to a single
// character glb (3.2MB). 512px is plenty for a TILED, repeating texture
// sampled per-course at gameplay distance, not viewed as a single hero image.

import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'asset-packs', 'forest-nature-fbx', 'Grass');
const OUT = path.join(root, 'assets', 'textures');

const JOBS = [
  { src: 'Grass_Albedo_02.png', out: 'turf_grain.jpg', quality: 85 },
  { src: 'Grass_Normal.png', out: 'turf_normal.jpg', quality: 88 },
  // Rough gets a genuinely different real photo (wilder grass+wildflower
  // blend) rather than the fairway image retinted — no normal map needed,
  // bump detail is secondary and turf_normal.jpg is shared across surfaces.
  { src: 'Grass_Albedo_Flower_01.png', out: 'turf_grain_rough.jpg', quality: 85 }
];

for (const job of JOBS) {
  const outPath = path.join(OUT, job.out);
  await sharp(path.join(SRC, job.src))
    .resize(512, 512)
    .jpeg({ quality: job.quality })
    .toFile(outPath);
  console.log(job.out);
}
