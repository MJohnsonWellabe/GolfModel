// Convert curated FBX props from asset-packs/forest-nature-fbx into the
// game-ready glbs committed under assets/models/nature/.
//
//   npm run convert:nature
//
// Pipeline per prop: FBX2glTF (the fbx2gltf devDependency ships a prebuilt
// binary) -> @gltf-transform post-process that keeps only the LOD0 mesh
// nodes (the pack bakes _LOD0/_LOD1/_LOD2 chains into one file), welds,
// conservatively simplifies, and prunes. Outputs are committed — build
// machines and the deployed game never run this script.
//
// The pack ships no textures: material *slots* survive conversion
// (MainMaterial, *Leavse* ...) and src/slice3d/natureModels.ts recolors them
// per course theme at load, same as the fantastic-nature props.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, quantize, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(root, 'asset-packs', 'forest-nature-fbx');
const MEADOW = path.join(root, 'asset-packs', 'meadow-fbx');
const KIT = path.join(root, 'asset-packs', 'nature-kit-glb');
const OUT = path.join(root, 'assets', 'models', 'nature');

/**
 * outKey -> pack-relative FBX source (string) or { src, ratio } where ratio
 * overrides the default simplify target. Keys are what natureModels.ts loads.
 * The dense broadleaf meshes get a harder decimation — they were the bulk of
 * the first-load payload (oak alone was 1 MB).
 */
const MANIFEST = {
  // Broadleaf (Wildwood Glen mix)
  tree_oak: { src: 'Oak/SM_Oak_LOD.fbx', ratio: 0.32 },
  tree_birch: { src: 'Birch/Birch_01/SM_Birch_LOD.fbx', ratio: 0.42 },
  tree_birch_b: { src: 'Birch/Birch_02/SM_Birch_02_LOD.fbx', ratio: 0.35 },
  tree_maple: 'Maple/SM_Maple_LOD.fbx',
  tree_aspen: 'Aspen/SM_Aspen_LOD.fbx',
  tree_poplar: { src: 'Poplar/SM_Poplar_LOD.fbx', ratio: 0.42 },
  // Conifers (Timberline mix)
  tree_spruce: 'Spruce/SM_Spruce_LOD.fbx',
  tree_spruce_tall: 'Big Hight Spruce/SM_Hight_Spruce_LOD.fbx',
  tree_pine: { src: 'Pine/SM_Pine_LOD.fbx', ratio: 0.4 },
  // Deadwood storytelling (rough scatter on forest courses)
  tree_fallen: 'Fallen/SM_Fallen_Tree_LOD.fbx',
  tree_broken: 'Broken/SM_Broken_Tree_LOD.fbx',
  // Forest-floor scatter
  stump_a: 'Trunks/SM_Stump_01_LOD.fbx',
  log_a: 'Trunks/SM_Log_01_LOD.fbx',
  fern_a: 'Bushe/SM_Fern_01.fbx', // LOD-less single mesh
  bush_berry: 'Bushe/SM_Blackberry_LOD.fbx',
  bush_juniper: 'Bushe/SM_Junipper_LOD.fbx',
  bush_c: 'Bushe/SM_Bushe_01_LOD.fbx',
  bush_currant: 'Bushe/SM_Currant_LOD.fbx',
  bush_raspberry: 'Bushe/SM_Raspberry_LOD.fbx',
  // Sky props (LOD-less)
  cloud_a: 'Clouds/SM_Cloud_01.fbx',
  cloud_b: 'Clouds/SM_Cloud_02.fbx',
  cloud_c: 'Clouds/SM_Cloud_03.fbx',
  cloud_d: 'Clouds/SM_Cloud_04.fbx',
  cloud_e: 'Clouds/SM_Cloud_05.fbx',
  cloud_f: 'Clouds/SM_Cloud_06.fbx',
  cloud_g: 'Clouds/SM_Cloud_07.fbx',
  cloud_h: 'Clouds/SM_Cloud_08.fbx',
  cloud_i: 'Clouds/SM_Cloud_09.fbx'
};

/**
 * Meadow pack (asset-packs/meadow-fbx) grass tufts + wildflowers. These are
 * thin crossed blade-cards, so `light: true` skips the border-unlocking
 * decimation the trees use (it would shred the blades) — just weld + quantize.
 * Recolored by slot like the rest: grass_* → flat unlit grass, flower_* → the
 * unlit flower material (natureModels.ts pickMat). Kept OUT of the default
 * GRASS_KEYS/FLOWER_KEYS — only a course opting in via theme.grassKeys places
 * them, so the other courses stay identical.
 */
const MEADOW_MANIFEST = {
  grass_g: 'SM_Grass_01.fbx',
  grass_h: 'SM_Grass_03.fbx',
  grass_i: 'SM_Grass_Shorts.fbx',
  flower_b: 'SM_Wild_Flower_02.fbx',
  flower_c: 'SM_Lavender.fbx',
  flower_d: 'SM_Wild_Flower_01.fbx',
  flower_e: 'SM_Sunflower_LOD.fbx'
};

/**
 * Kenney nature-kit (asset-packs/nature-kit-glb) — genuinely 3D low-poly
 * flowers/plants (real volume, ~300-1700 tris) as opposed to the meadow pack's
 * flat crossed cards. Used for dense authored flower gardens where blooms are
 * seen up close and must read as rounded 3D shapes from every angle.
 *
 * The kit ships glTF + .bin but its texture PNGs are absent from the pack; we
 * recolor by material slot at load time anyway, so we strip every image/texture
 * reference (point the buffer at the original .bin) and run the light cleanup.
 * outKey -> pack file stem. Recolored via natureModels.ts pickMat: flower_* →
 * the two-sided lit flower material (tintable per instance).
 */
const KENNEY_MANIFEST = {
  flower_f: 'Flower_3_Group',
  flower_g: 'Flower_4_Group',
  flower_h: 'Plant_1'
};

const fbx2gltf = path.join(
  root,
  'node_modules',
  'fbx2gltf',
  'bin',
  { darwin: 'Darwin', linux: 'Linux', win32: 'Windows_NT' }[process.platform],
  process.platform === 'win32' ? 'FBX2glTF.exe' : 'FBX2glTF'
);

/** Drop every node carrying a non-zero LOD mesh; keep LOD0 and LOD-less. */
function stripLods(document) {
  for (const node of document.getRoot().listNodes()) {
    if (/_LOD[1-9]\d*$/i.test(node.getName())) node.dispose();
  }
}

const io = new NodeIO();
await MeshoptSimplifier.ready;
const work = mkdtempSync(path.join(tmpdir(), 'nature-'));

async function convertOne(packDir, key, entry, light) {
  const { src: rel, ratio = 0.6 } = typeof entry === 'string' ? { src: entry } : entry;
  const src = path.join(packDir, rel);
  const raw = path.join(work, `${key}.glb`);
  execFileSync(fbx2gltf, ['--binary', '--input', src, '--output', raw.replace(/\.glb$/, '')], {
    stdio: ['ignore', 'ignore', 'inherit']
  });

  const document = await io.read(raw);
  stripLods(document);
  // Thin blade-cards (grass/flowers) skip decimation — the simplifier collapses
  // the crossed quads into slivers; they're already tiny. Everything else gets
  // the border-aware simplify pass.
  const steps = light
    ? [dedup(), weld(), prune(), quantize()]
    : [
        dedup(),
        weld(),
        // Decimation: stylized low-poly props seen from fairway distance.
        // The default keeps lockBorder (protects trunk/foliage seams); the
        // aggressive manifest entries are disconnected leaf-card soup where
        // every edge is a border, so they must unlock borders (plus a looser
        // error bound) or the simplifier can't remove anything.
        simplify(
          ratio < 0.6
            ? { simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: false }
            : { simplifier: MeshoptSimplifier, ratio, error: 0.001, lockBorder: true }
        ),
        prune(),
        // Quantized attributes (KHR_mesh_quantization — Babylon-supported)
        // roughly halve every file for free.
        quantize()
      ];
  await document.transform(...steps);

  const out = path.join(OUT, `${key}.glb`);
  await io.write(out, document);
  const kb = Math.round(statSync(out).size / 1024);
  const mats = document
    .getRoot()
    .listMaterials()
    .map((m) => m.getName())
    .join(', ');
  console.log(`${key}.glb  ${kb} KB  [${mats}]`);
}

/** Convert one Kenney nature-kit glTF: strip its (absent) textures, then run
 *  the same light cleanup the meadow cards get. Geometry only — recolored by
 *  slot at load, so the missing PNGs never matter. */
async function convertKenneyOne(key, stem) {
  const gj = JSON.parse(readFileSync(path.join(KIT, `${stem}.gltf`), 'utf8'));
  delete gj.images;
  delete gj.textures;
  delete gj.samplers;
  for (const m of gj.materials ?? []) {
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
  }
  // Resolve the .bin by absolute path so the rewritten glTF reads from anywhere.
  for (const b of gj.buffers ?? []) if (b.uri) b.uri = path.join(KIT, b.uri);
  const tmp = path.join(work, `${stem}.gltf`);
  writeFileSync(tmp, JSON.stringify(gj));
  const document = await io.read(tmp);
  await document.transform(dedup(), weld(), prune(), quantize());
  const out = path.join(OUT, `${key}.glb`);
  await io.write(out, document);
  console.log(`${key}.glb  ${Math.round(statSync(out).size / 1024)} KB  [kenney ${stem}]`);
}

try {
  for (const [key, entry] of Object.entries(MANIFEST)) {
    await convertOne(PACK, key, entry, false);
  }
  for (const [key, entry] of Object.entries(MEADOW_MANIFEST)) {
    await convertOne(MEADOW, key, entry, true);
  }
  for (const [key, stem] of Object.entries(KENNEY_MANIFEST)) {
    await convertKenneyOne(key, stem);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
