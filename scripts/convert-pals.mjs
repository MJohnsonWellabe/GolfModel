// Convert the raw uploaded pal GLBs in asset-packs/pals/ into the web-sized
// companions committed under assets/models/pals/.
//
//   npm run convert:pals
//
// Unlike convert-nature.mjs these are already GLB (no FBX step) and ship real
// PBR textures, so the pipeline is decimate + texture shrink: dedup -> weld ->
// simplify -> prune -> textureCompress (1024px jpeg via sharp) -> quantize.
// Outputs are committed — build machines and the deployed game never run this.

import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, quantize, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'asset-packs', 'pals');
const OUT = path.join(root, 'assets', 'models', 'pals');

/**
 * outKey -> { src, ratio, error }. The dragon is a 200k-tri AI scan and needs
 * a hard decimation to sit next to ~10k-tri golfers; the fox is hand-modeled
 * at 20k and only gets a trim. Both drop normal maps: pals are small stylized
 * pets read at fairway distance, and the fox's 2048px normal PNG alone was
 * 4.8MB of its 6.7MB payload.
 */
const MANIFEST = {
  fox: { src: 'fox_raw.glb', ratio: 0.75, error: 0.001 },
  dragon: { src: 'dragon_raw.glb', ratio: 0.13, error: 0.02 }
};

const io = new NodeIO();
await MeshoptSimplifier.ready;

function triCount(document) {
  let tris = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(tris);
}

for (const [key, { src, ratio, error }] of Object.entries(MANIFEST)) {
  const document = await io.read(path.join(SRC, src));
  const before = triCount(document);

  for (const mat of document.getRoot().listMaterials()) {
    mat.setNormalTexture(null);
    mat.setOcclusionTexture(null);
  }

  await document.transform(
    dedup(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: 85, resize: [1024, 1024] }),
    quantize()
  );

  const out = path.join(OUT, `${key}.glb`);
  await io.write(out, document);
  const kb = Math.round(statSync(out).size / 1024);
  console.log(`${key}.glb  ${kb} KB  tris ${before} -> ${triCount(document)}`);
}
