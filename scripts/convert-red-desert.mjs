// Convert the CC-BY red desert set (asset-packs/*, see
// asset-packs/red-desert-set-README.md) into textured game prototypes.
// Sources are heavy (4K textures, dense meshes) — resize to 512 webp,
// simplify, quantize. node scripts/convert-red-desert.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { dedup, flatten, prune, quantize, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const io = new NodeIO();
const JOBS = {
  // Backgrounds carry silhouette, not close-up detail — hard decimation +
  // small textures keep each piece phone-friendly.
  mountain_range_red: { pack: 'red_desert_mountains', ratio: 0.08, tex: 512 },
  rocks_red_cluster: { pack: 'stylized_red_rocks', ratio: 0.5, tex: 512 },
  canyon_red_a: { pack: 'red_canyon_landscape', ratio: 0.12, tex: 512 },
  canyon_red_b: { pack: 'red_sand_desert_canyon', ratio: 0.15, tex: 512 }
};
for (const [key, job] of Object.entries(JOBS)) {
  const doc = await io.read(path.join(root, 'asset-packs', job.pack, 'scene.gltf'));
  await doc.transform(
    dedup(),
    flatten(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: job.ratio, error: 0.01 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [job.tex, job.tex] }),
    quantize(),
    prune()
  );
  await io.write(path.join(root, 'assets', 'models', 'nature', `${key}.glb`), doc);
  console.log(key, 'written');
}
