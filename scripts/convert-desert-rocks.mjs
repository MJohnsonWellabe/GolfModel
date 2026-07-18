// Convert the curated Kenney Nature Kit cliff/rock glbs (see
// asset-packs/kenney-nature-kit-2/README.md) into game-ready prototypes under
// assets/models/nature/. Same post-process as convert-nature.mjs (weld,
// quantize, prune) — these are already tiny low-poly glbs, so no simplify.
//   node scripts/convert-desert-rocks.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'asset-packs', 'kenney-nature-kit-2');
const OUT = path.join(root, 'assets', 'models', 'nature');

const MANIFEST = {
  mesa_a: 'cliff_large_rock.glb',
  mesa_b: 'cliff_rock.glb',
  mesa_c: 'cliff_half_rock.glb',
  rock_desert_a: 'rock_largeA.glb',
  rock_desert_b: 'rock_largeB.glb',
  rock_desert_c: 'rock_largeC.glb',
  rock_desert_d: 'rock_largeD.glb',
  rock_desert_e: 'rock_largeE.glb',
  rock_desert_f: 'rock_largeF.glb',
  rock_desert_g: 'rock_smallA.glb',
  rock_desert_h: 'rock_smallB.glb'
};

const io = new NodeIO();
for (const [key, src] of Object.entries(MANIFEST)) {
  const doc = await io.read(path.join(SRC, src));
  await doc.transform(dedup(), weld(), quantize(), prune());
  await io.write(path.join(OUT, `${key}.glb`), doc);
  console.log(`${key} <- ${src}`);
}
