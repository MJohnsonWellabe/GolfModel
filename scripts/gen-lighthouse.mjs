// Generate a real striped LIGHTHOUSE GLB to replace the Kenney castle watchtower
// (assets/models/props/lighthouse.glb — its node is "tower-complete-large", a
// battlemented turret, not a lighthouse). No CC0 striped-lighthouse GLB was
// fetchable here (poly.pizza API-gated; others FBX/OBJ needing Blender), so this
// authors one with @gltf-transform: a tapered white tower with red bands, a dark
// gallery, a glowing lantern room, and a conical cap. Oriented +Y up; the prop
// loader (upright:true) scales it to the authored `len` and stands it on ground.
//
// Run: node scripts/gen-lighthouse.mjs  → assets/models/props/lighthouse.glb
import { Document, NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'models', 'props', 'lighthouse.glb');
const doc = new Document();
const buf = doc.createBuffer();
const N = 24; // radial segments

const materials = {};
function matFor(color, emissive = [0, 0, 0]) {
  const key = color.join(',') + '|' + emissive.join(',');
  if (!materials[key]) {
    materials[key] = doc.createMaterial(key).setBaseColorFactor([...color, 1]).setRoughnessFactor(0.9).setMetallicFactor(0)
      .setEmissiveFactor(emissive);
  }
  return materials[key];
}

const scene = doc.createScene();
// A frustum ring segment (r0 at y0 → r1 at y1), with optional caps.
function frustum(name, y0, y1, r0, r1, color, emissive, capTop = false, capBottom = false) {
  const verts = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    verts.push(r0 * c, y0, r0 * s); // bottom ring
    verts.push(r1 * c, y1, r1 * s); // top ring
  }
  for (let i = 0; i < N; i++) {
    const b0 = i * 2, t0 = i * 2 + 1, b1 = i * 2 + 2, t1 = i * 2 + 3;
    idx.push(b0, t0, b1, b1, t0, t1);
  }
  if (capTop) { const ci = verts.length / 3; verts.push(0, y1, 0); for (let i = 0; i < N; i++) idx.push(i * 2 + 1, ci, i * 2 + 3); }
  if (capBottom) { const ci = verts.length / 3; verts.push(0, y0, 0); for (let i = 0; i < N; i++) idx.push(i * 2, i * 2 + 2, ci); }
  // normals
  const nor = new Array(verts.length).fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const vi of [idx[t], idx[t + 1], idx[t + 2]]) { nor[vi * 3] += nx; nor[vi * 3 + 1] += ny; nor[vi * 3 + 2] += nz; }
  }
  for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; }
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(verts)).setBuffer(buf);
  const nrm = doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf);
  const ind = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nrm).setIndices(ind).setMaterial(matFor(color, emissive));
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
}

const WHITE = [0.94, 0.94, 0.92], RED = [0.78, 0.16, 0.13], DARK = [0.18, 0.2, 0.24], GLASS = [1.0, 0.96, 0.7];
// Tapered tower base→top y 0..1.5, r 0.5..0.3, split into alternating white/red bands.
const bands = 7, y0 = 0.0, y1 = 1.5, r0 = 0.5, r1 = 0.3;
frustum('base', 0, 0.12, 0.56, 0.5, WHITE, [0, 0, 0], false, true); // flared footing
for (let i = 0; i < bands; i++) {
  const ya = y0 + (y1 - y0) * (i / bands), yb = y0 + (y1 - y0) * ((i + 1) / bands);
  const ra = r0 + (r1 - r0) * (i / bands), rb = r0 + (r1 - r0) * ((i + 1) / bands);
  frustum('band' + i, 0.12 + ya, 0.12 + yb, ra, rb, i % 2 === 1 ? RED : WHITE, [0, 0, 0]);
}
const top = 0.12 + y1;
frustum('gallery', top, top + 0.12, 0.36, 0.36, DARK, [0, 0, 0], false, false); // walkway ring
frustum('lantern', top + 0.12, top + 0.42, 0.24, 0.24, GLASS, [0.9, 0.78, 0.3]); // glowing light room
frustum('roof', top + 0.42, top + 0.66, 0.28, 0.0, RED, [0, 0, 0], true); // conical cap

await new NodeIO().write(OUT, doc);
console.log('wrote', OUT);
