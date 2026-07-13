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
import { dedup, prune, quantize, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(root, 'asset-packs', 'forest-nature-fbx');
const MEADOW = path.join(root, 'asset-packs', 'meadow-fbx');
const KIT = path.join(root, 'asset-packs', 'nature-kit-glb');
const UPLOADS = path.join(root, 'asset-packs', 'nature-uploads');
const UPLOADS_FBX = path.join(root, 'asset-packs', 'nature-uploads-fbx');
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
  // Conifers (Timberline mix). tree_spruce_tall + tree_pine retired in Pass
  // 10 (playtest) in favor of the Kenney pines below — sources stay in the
  // pack if they're ever wanted back.
  tree_spruce: 'Spruce/SM_Spruce_LOD.fbx',
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
  flower_h: 'Plant_1',
  // True 3D bushes/ferns (rounded volumes, ~300-900 tris) that replace the
  // mixed-quality forest-pack shrubs course-wide.
  bush_kenney_a: 'Bush_Common',
  bush_kenney_b: 'Plant_1_Big',
  fern_kenney: 'Fern_1',
  // Kenney low-poly pines, user-picked from an on-course catalog (Pass 10):
  // k1 = the universal pine, k3 = Sable Bay's bare-trunk pine. Their
  // Bark_NormalTree / Leaves_Pine slots recolor per theme like the FBX
  // conifers'. (Pine_2/4/5 were unpicked candidates.)
  tree_pine_k1: 'Pine_1',
  tree_pine_k3: 'Pine_3'
};

/**
 * User-uploaded GLB props (asset-packs/nature-uploads/) — already GLB, so no
 * FBX2glTF step. Unlike the rest of the nature set these ship REAL textures
 * that ARE the point (a sakura's blossom photo, a flower's petal photo), so
 * natureModels.ts keeps them (see TEXTURED_KEYS) instead of recoloring by
 * slot. webp (not jpeg) keeps the alpha channel these need for cutout leaves/
 * petals. outKey -> { src, ratio }.
 */
const UPLOAD_MANIFEST = {
  tree_sakura: { src: 'sakura.glb', ratio: 0.85 },
  flower_coreopsis: { src: 'coreopsis.glb', ratio: 0.85 },
  ship: { src: 'ship.glb', ratio: 0.45 }
};

/**
 * User-uploaded FBX props (asset-packs/nature-uploads-fbx/). Unlike the
 * nature-uploads GLBs these ship NO usable textures (the palm kit's atlas PNG
 * is a dead 70-byte placeholder), so they take the recolor-by-slot path like
 * the forest pack — which means their material slots must carry names
 * natureModels.ts pickMat understands ("*Leaves*" -> foliage, "*Trunk*" ->
 * bark). The palm kit is one mesh per variant with a SINGLE material for
 * trunk+fronds, so `splitPalm` re-slots it geometrically: the largest
 * connected component (verified: the 125-tri trunk column; every frond is a
 * separate 16-tri island, coconuts 4-tri) becomes PalmTrunk, the rest
 * PalmLeaves. The cattail ships 5 distinct slots that just need renaming
 * (leaves/stems -> ReedLeaves, the brown seed heads + tips -> ReedHeadTrunk).
 */
const UPLOAD_FBX_MANIFEST = {
  tree_palm: { src: 'LowPoly_Palms.fbx', node: 'Palm1_VAR2', split: 'palm' },
  tree_palm_b: { src: 'LowPoly_Palms.fbx', node: 'Palm1_VAR4', split: 'palm' },
  reed_cattail: {
    src: 'cattail.fbx',
    ratio: 0.3,
    rename: {
      folhas: 'ReedLeaves',
      cilinder: 'ReedStemLeaves',
      curvedcilinder: 'ReedStemLeaves',
      hotdog: 'ReedHeadTrunk',
      corno: 'ReedHeadTrunk'
    }
  }
};

async function convertUploadOne(key, { src, ratio }) {
  const document = await io.read(path.join(UPLOADS, src));
  const before = triCount(document);
  await document.transform(
    dedup(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: false }),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [512, 512] }),
    quantize()
  );
  const out = path.join(OUT, `${key}.glb`);
  await io.write(out, document);
  const kb = Math.round(statSync(out).size / 1024);
  console.log(`${key}.glb  ${kb} KB  tris ${before} -> ${triCount(document)}`);
}

/**
 * Re-slot a single-material palm mesh into PalmTrunk + PalmLeaves primitives.
 * Connected components are found by union-find over shared/coincident verts;
 * the component with the most triangles is the trunk (the fronds and coconuts
 * are small disconnected islands). Splitting at convert time keeps the
 * runtime loader's one-prototype-per-material-slot model intact.
 */
function splitPalm(document, prim) {
  const idx = prim.getIndices().getArray();
  const pos = prim.getAttribute('POSITION').getArray();
  const nVerts = pos.length / 3;
  const parent = new Int32Array(nVerts).map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const uni = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[a] = b;
  };
  // Merge verts split by UV seams (identical positions) before walking tris.
  const seen = new Map();
  for (let i = 0; i < nVerts; i++) {
    const k = `${pos[i * 3].toFixed(5)},${pos[i * 3 + 1].toFixed(5)},${pos[i * 3 + 2].toFixed(5)}`;
    if (seen.has(k)) uni(i, seen.get(k));
    else seen.set(k, i);
  }
  for (let t = 0; t < idx.length; t += 3) {
    uni(idx[t], idx[t + 1]);
    uni(idx[t], idx[t + 2]);
  }
  const triCountByComp = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const c = find(idx[t]);
    triCountByComp.set(c, (triCountByComp.get(c) ?? 0) + 1);
  }
  let trunkComp = -1;
  let best = -1;
  for (const [c, n] of triCountByComp) {
    if (n > best) {
      best = n;
      trunkComp = c;
    }
  }
  const trunkIdx = [];
  const leafIdx = [];
  for (let t = 0; t < idx.length; t += 3) {
    (find(idx[t]) === trunkComp ? trunkIdx : leafIdx).push(idx[t], idx[t + 1], idx[t + 2]);
  }
  const buffer = document.getRoot().listBuffers()[0];
  const mkPrim = (indices, mat) => {
    const acc = document
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Uint16Array(indices))
      .setBuffer(buffer);
    const p = document.createPrimitive().setIndices(acc).setMaterial(mat);
    for (const sem of prim.listSemantics()) p.setAttribute(sem, prim.getAttribute(sem));
    return p;
  };
  // Distinct baseColorFactors are load-bearing: dedup() collapses materials
  // with identical properties (names don't count), which would silently merge
  // the two slots back into one. The colors themselves are just a sane
  // fallback — natureModels recolors both slots per course theme.
  const trunkMat = document
    .createMaterial('PalmTrunk')
    .setRoughnessFactor(1)
    .setMetallicFactor(0)
    .setBaseColorFactor([0.45, 0.33, 0.22, 1]);
  const leafMat = document
    .createMaterial('PalmLeaves')
    .setRoughnessFactor(1)
    .setMetallicFactor(0)
    .setBaseColorFactor([0.22, 0.5, 0.24, 1]);
  const mesh = prim.listParents().find((p) => p.propertyType === 'Mesh');
  mesh.addPrimitive(mkPrim(trunkIdx, trunkMat));
  mesh.addPrimitive(mkPrim(leafIdx, leafMat));
  mesh.removePrimitive(prim);
  prim.dispose();
}

/** Convert one uploaded FBX prop: FBX2glTF, keep only the named node (palm
 *  kits line all variants up in a row), recenter it at the origin, re-slot
 *  materials (geometric palm split or plain rename), then the standard
 *  cleanup. Textures are stripped — these props are recolored at load. */
async function convertUploadFbxOne(key, { src, node, split, rename, ratio }) {
  const raw = path.join(work, `upl_${key}.glb`);
  execFileSync(fbx2gltf, ['--binary', '--input', path.join(UPLOADS_FBX, src), '--output', raw.replace(/\.glb$/, '')], {
    stdio: ['ignore', 'ignore', 'inherit']
  });
  const document = await io.read(raw);
  const root = document.getRoot();
  if (node) {
    for (const n of root.listNodes()) {
      if (!n.getMesh()) continue;
      if (n.getName() === node) n.setTranslation([0, 0, 0]);
      else n.dispose();
    }
    for (const m of root.listMeshes()) if (m.getName() !== node) m.dispose();
  }
  if (split === 'palm') {
    const prim = root.listMeshes()[0].listPrimitives()[0];
    splitPalm(document, prim);
  }
  if (rename) {
    for (const m of root.listMaterials()) {
      const to = rename[m.getName()];
      if (to) m.setName(to);
    }
  }
  // Strip textures/images — recolor-by-slot never samples them, and the palm
  // kit's atlas is a dead placeholder anyway.
  for (const t of root.listTextures()) t.dispose();
  const steps = [dedup(), weld()];
  if (ratio) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: false }));
  steps.push(prune(), quantize());
  const before = triCount(document);
  await document.transform(...steps);
  const out = path.join(OUT, `${key}.glb`);
  await io.write(out, document);
  const kb = Math.round(statSync(out).size / 1024);
  const mats = root
    .listMaterials()
    .map((m) => m.getName())
    .join(', ');
  console.log(`${key}.glb  ${kb} KB  tris ${before} -> ${triCount(document)}  [${mats}]`);
}

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
  (gj.materials ?? []).forEach((m, i) => {
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    // Distinct factor per slot: with the textures stripped, sibling materials
    // (bark vs leaves) become byte-identical and dedup() would MERGE them —
    // collapsing the tree onto one slot and losing the per-slot recolor. The
    // factor is invisible (recolored at load); it only blocks the merge.
    m.pbrMetallicRoughness = m.pbrMetallicRoughness ?? {};
    m.pbrMetallicRoughness.baseColorFactor = [1, 1 - i * 0.004, 1 - i * 0.002, 1];
  });
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
  for (const [key, entry] of Object.entries(UPLOAD_MANIFEST)) {
    await convertUploadOne(key, entry);
  }
  for (const [key, entry] of Object.entries(UPLOAD_FBX_MANIFEST)) {
    await convertUploadFbxOne(key, entry);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
