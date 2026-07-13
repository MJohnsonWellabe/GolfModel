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
 * outKey -> { src, ratio, error, skipSimplify?, baseColor? }. The dragon and
 * crab are AI/photogrammetry scans (200k / 60k tris) and need a hard
 * decimation to sit next to ~10k-tri golfers; the fox is hand-modeled at 20k
 * and only gets a trim. All drop normal maps: pals are small stylized pets
 * read at fairway distance, and the fox's 2048px normal PNG alone was 4.8MB
 * of its 6.7MB payload.
 *
 * `skipSimplify` bypasses the decimate step entirely — for a low-tri SKINNED
 * mesh (the trex) simplification isn't needed and risks the joint-weight
 * remap. `baseColor` injects a flat PBR material on any primitive that ships
 * without one (also the trex — a bare glTF default material renders as
 * near-black metal without this). `recolor:[r,g,b]` (0-255) re-chromas the
 * baked base-color textures via a luminance-preserving tint — it turns the
 * arctic fox's grey coat orange while keeping every light/dark marking (a
 * runtime albedo multiply can only darken, so a genuine recolor has to bake
 * the texture; this ships the orange fox as its own glb reusing the same mesh).
 */
const MANIFEST = {
  fox: { src: 'fox_raw.glb', ratio: 0.75, error: 0.001 },
  // Warm red-fox coat baked from the same mesh as the arctic fox — a second
  // fox option, not a replacement (playtest: "an orange fox as a second fox").
  foxorange: { src: 'fox_raw.glb', ratio: 0.75, error: 0.001, recolor: [214, 126, 58] },
  dragon: { src: 'dragon_raw.glb', ratio: 0.13, error: 0.02 },
  gecko: { src: 'gecko_raw.glb', ratio: 0.7, error: 0.001 },
  // Bright-orange re-chroma of the gecko — the Season 1 pass level-50
  // exclusive (never sold in the store), same mesh as Zippy.
  geckoorange: { src: 'gecko_raw.glb', ratio: 0.7, error: 0.001, recolor: [255, 122, 26] },
  // Bright apple green — user-picked from a three-way comparison (Pass 10);
  // was vivid leaf [0.3,0.72,0.34], before that a muddy olive.
  trex: { src: 'trex_raw.glb', skipSimplify: true, baseColor: [0.45, 0.85, 0.35, 1] },
  // Rich red-orange re-chroma — unifies the shell (the original texture had a
  // greenish belly patch); user-picked from a three-way comparison (Pass 10).
  crab: { src: 'mystery_raw.glb', ratio: 0.16, error: 0.02, recolor: [225, 90, 45] },
  // Uploaded multi-file glTF pets → single web glb. Pug is a 87k-tri scan
  // (hard decimation like the dragon); the toon cat is already light.
  pug: { src: 'pug_raw/scene.gltf', ratio: 0.1, error: 0.02 },
  cat: { src: 'cat_raw/scene.gltf', ratio: 0.85, error: 0.001 }
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

for (const [key, { src, ratio, error, skipSimplify, baseColor, recolor }] of Object.entries(MANIFEST)) {
  const document = await io.read(path.join(SRC, src));
  const before = triCount(document);

  for (const mat of document.getRoot().listMaterials()) {
    mat.setNormalTexture(null);
    mat.setOcclusionTexture(null);
  }

  if (baseColor) {
    const mat = document.createMaterial(`${key}Skin`).setBaseColorFactor(baseColor).setMetallicFactor(0).setRoughnessFactor(0.85);
    for (const mesh of document.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        if (!prim.getMaterial()) prim.setMaterial(mat);
      }
    }
  }

  // Re-chroma the baked base-color textures BEFORE compression so the recolored
  // pixels are what gets shrunk to jpeg. sharp.tint keeps luminance and swaps
  // the chroma, so the coat's markings survive the color change (grey → orange).
  if (recolor) {
    for (const tex of document.getRoot().listTextures()) {
      const img = tex.getImage();
      if (!img) continue;
      const out = await sharp(Buffer.from(img)).tint({ r: recolor[0], g: recolor[1], b: recolor[2] }).png().toBuffer();
      tex.setImage(new Uint8Array(out)).setMimeType('image/png');
    }
  }

  const steps = [dedup(), weld()];
  if (!skipSimplify) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
  steps.push(prune(), textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: 85, resize: [1024, 1024] }), quantize());
  await document.transform(...steps);

  const out = path.join(OUT, `${key}.glb`);
  await io.write(out, document);
  const kb = Math.round(statSync(out).size / 1024);
  console.log(`${key}.glb  ${kb} KB  tris ${before} -> ${triCount(document)}`);
}
