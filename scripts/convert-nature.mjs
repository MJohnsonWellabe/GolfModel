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
import { dedup, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(root, 'asset-packs', 'forest-nature-fbx');
const OUT = path.join(root, 'assets', 'models', 'nature');

/** outKey -> pack-relative FBX source. Keys are what natureModels.ts loads. */
const MANIFEST = {
  // Broadleaf (Wildwood Glen mix)
  tree_oak: 'Oak/SM_Oak_LOD.fbx',
  tree_birch: 'Birch/Birch_01/SM_Birch_LOD.fbx',
  tree_birch_b: 'Birch/Birch_02/SM_Birch_02_LOD.fbx',
  tree_maple: 'Maple/SM_Maple_LOD.fbx',
  tree_aspen: 'Aspen/SM_Aspen_LOD.fbx',
  tree_poplar: 'Poplar/SM_Poplar_LOD.fbx',
  // Conifers (Timberline mix)
  tree_spruce: 'Spruce/SM_Spruce_LOD.fbx',
  tree_spruce_tall: 'Big Hight Spruce/SM_Hight_Spruce_LOD.fbx',
  tree_pine: 'Pine/SM_Pine_LOD.fbx',
  // Forest-floor scatter
  stump_a: 'Trunks/SM_Stump_01_LOD.fbx',
  log_a: 'Trunks/SM_Log_01_LOD.fbx',
  fern_a: 'Bushe/SM_Fern_01.fbx', // LOD-less single mesh
  bush_berry: 'Bushe/SM_Blackberry_LOD.fbx'
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
  for (const [key, rel] of Object.entries(MANIFEST)) {
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
      // Conservative decimation: these are stylized low-poly props seen from
      // fairway distance; lockBorder keeps trunk/foliage seams intact.
      simplify({ simplifier: MeshoptSimplifier, ratio: 0.6, error: 0.001, lockBorder: true }),
      prune()
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
