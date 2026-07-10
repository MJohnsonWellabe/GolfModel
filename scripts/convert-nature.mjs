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
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, quantize, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(root, 'asset-packs', 'forest-nature-fbx');
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
  // Sky props (LOD-less)
  cloud_a: 'Clouds/SM_Cloud_01.fbx',
  cloud_b: 'Clouds/SM_Cloud_02.fbx',
  cloud_c: 'Clouds/SM_Cloud_03.fbx'
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

try {
  for (const [key, entry] of Object.entries(MANIFEST)) {
    const { src: rel, ratio = 0.6 } = typeof entry === 'string' ? { src: entry } : entry;
    const src = path.join(PACK, rel);
    const raw = path.join(work, `${key}.glb`);
    execFileSync(fbx2gltf, ['--binary', '--input', src, '--output', raw.replace(/\.glb$/, '')], {
      stdio: ['ignore', 'ignore', 'inherit']
    });

    const document = await io.read(raw);
    stripLods(document);
    await document.transform(
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
    );

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
} finally {
  rmSync(work, { recursive: true, force: true });
}
