// Convert the CC-BY Red Mountain (asset-packs/red-mountain) into the game's
// textured-prototype format. The source ships 46 materials/45 textures at
// large sizes — resize to 256px webp, quantize, prune. Placed as a 2-3
// instance horizon range on Red Hollow (frozen, fog-managed).
//   node scripts/convert-red-mountain.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { dedup, flatten, prune, quantize, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const io = new NodeIO();
const doc = await io.read(path.join(root, 'asset-packs', 'red-mountain', 'scene.gltf'));
await doc.transform(
  dedup(),
  flatten(),
  weld(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256] }),
  quantize(),
  prune()
);
await io.write(path.join(root, 'assets', 'models', 'nature', 'mountain_red.glb'), doc);
console.log('mountain_red.glb written');
