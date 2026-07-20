// Convert downloaded CC0 Poly Pizza / Quaternius nature glbs into the game's
// optimized asset format, mirroring scripts/convert-nature.mjs's transform
// chain (dedup, weld, simplify, prune, textureCompress→webp, quantize).
//
// Source: Quaternius "Stylized Nature MegaKit" (CC0 / public domain,
// https://quaternius.com), fetched via poly.pizza. See asset-packs/
// poly-quaternius/LICENSE.txt.
//
// Run: node scripts/convert-poly.mjs   (reads asset-packs/poly-quaternius/raw/,
// writes assets/models/nature/<key>.glb). Outputs are committed.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, quantize, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(root, 'asset-packs', 'poly-quaternius', 'raw');
const OUT = path.join(root, 'assets', 'models', 'nature');

// downloaded filename (in RAW) -> { key (asset key), ratio (simplify target) }
const MAP = {
  'q_pine_a.glb': { key: 'tree_fir_a', ratio: 0.45 },
  'q_pine_b.glb': { key: 'tree_fir_b', ratio: 0.45 },
  'q_pine_c.glb': { key: 'tree_fir_c', ratio: 0.45 },
  'q_rock_a.glb': { key: 'rock_granite_a', ratio: 0.5 },
  'q_rock_b.glb': { key: 'rock_granite_b', ratio: 0.5 },
  'q_rock_c.glb': { key: 'rock_granite_c', ratio: 0.5 },
  'q_bush_a.glb': { key: 'bush_leafy', ratio: 0.6 },
  'q_bush_flower.glb': { key: 'bush_bloom', ratio: 0.6 }
};

const io = new NodeIO();

for (const [file, { key, ratio }] of Object.entries(MAP)) {
  const src = path.join(RAW, file);
  const out = path.join(OUT, `${key}.glb`);
  const document = await io.read(src);
  await document.transform(
    dedup(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: false }),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [512, 512] }),
    quantize()
  );
  await io.write(out, document);
  const kb = (statSync(out).size / 1024).toFixed(0);
  console.log(`${file} -> ${key}.glb (${kb} KB)`);
}
