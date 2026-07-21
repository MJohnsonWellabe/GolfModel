// Generate a rounded SAND-DUNE mound GLB for the Nebraska Sand Hills horizon
// (Wild Prairie). No suitable rounded-dune model was fetchable in this
// environment (poly.pizza is API-key-gated; OpenGameArt/Quaternius dunes ship as
// FBX/OBJ needing Blender, which isn't installed), so this authors a genuine
// dune-shaped mesh with the same @gltf-transform toolchain the repo's other
// convert scripts use. The peaks-backdrop system instances this single mound 5×
// per hole (overlapping, mirrored, width-stretched) into a continuous rolling
// ridgeline, and tints it to the theme's hill colour — so the model only needs
// the right ROUNDED-DUNE silhouette; colour is applied downstream.
//
// Run: node scripts/gen-sandhill-range.mjs  → assets/models/nature/dunes_sandhill.glb
import { Document, NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'models', 'nature', 'dunes_sandhill.glb');

// Smooth rounded dune height field. Wide + low (dunes are ~5–8× wider than tall),
// an asymmetric main crest plus a lower shoulder, gently waving along depth so
// the crest line isn't a straight extrusion.
const NX = 64, NZ = 20;
const X0 = -1.25, X1 = 1.25, Z0 = -0.42, Z1 = 0.42;
const bump = (x, c, w, a) => a * Math.exp(-((x - c) * (x - c)) / (w * w));
function height(x, z) {
  // crest line waves slightly with depth
  const wob = 0.06 * Math.sin(z * 6.0) + 0.03 * Math.sin(x * 3.0 + 1.7);
  let h = bump(x, -0.18 + wob, 0.42, 0.34)   // main dune crest
        + bump(x, 0.58 + wob, 0.30, 0.185)   // lower right shoulder
        + bump(x, -0.85 + wob, 0.24, 0.12);  // small left shoulder
  // taper to zero at the front/back edges so the mound sits flat on the ground
  const zt = Math.cos((z / Z1) * (Math.PI / 2));
  h *= 0.55 + 0.45 * Math.max(0, zt);
  return Math.max(0, h);
}

const positions = [];
const normals = [];
const indices = [];
const idx = (i, j) => i * NZ + j;
for (let i = 0; i < NX; i++) {
  const x = X0 + (X1 - X0) * (i / (NX - 1));
  for (let j = 0; j < NZ; j++) {
    const z = Z0 + (Z1 - Z0) * (j / (NZ - 1));
    positions.push(x, height(x, z), z);
  }
}
// finite-difference normals
const dx = (X1 - X0) / (NX - 1), dz = (Z1 - Z0) / (NZ - 1);
for (let i = 0; i < NX; i++) {
  const x = X0 + (X1 - X0) * (i / (NX - 1));
  for (let j = 0; j < NZ; j++) {
    const z = Z0 + (Z1 - Z0) * (j / (NZ - 1));
    const hL = height(x - dx, z), hR = height(x + dx, z);
    const hD = height(x, z - dz), hU = height(x, z + dz);
    const nx = (hL - hR), ny = 2 * dx, nz = (hD - hU);
    const len = Math.hypot(nx, ny, nz) || 1;
    normals.push(nx / len, ny / len, nz / len);
  }
}
for (let i = 0; i < NX - 1; i++) {
  for (let j = 0; j < NZ - 1; j++) {
    const a = idx(i, j), b = idx(i + 1, j), c = idx(i + 1, j + 1), d = idx(i, j + 1);
    indices.push(a, c, b, a, d, c);
  }
}

const doc = new Document();
const buf = doc.createBuffer();
const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buf);
const nrm = doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buf);
const ind = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buf);
const mat = doc.createMaterial('dune').setBaseColorFactor([0.82, 0.72, 0.42, 1]).setRoughnessFactor(1).setMetallicFactor(0);
const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nrm).setIndices(ind).setMaterial(mat);
const mesh = doc.createMesh('dunes_sandhill').addPrimitive(prim);
const node = doc.createNode('dunes_sandhill').setMesh(mesh);
doc.createScene().addChild(node);

await new NodeIO().write(OUT, doc);
console.log('wrote', OUT, '—', positions.length / 3, 'verts,', indices.length / 3, 'tris');
