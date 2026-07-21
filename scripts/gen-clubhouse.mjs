// Generate a PRAIRIE-LODGE CLUBHOUSE GLB (assets/models/props/clubhouse.glb).
// No fetchable CC0 clubhouse GLB here (poly.pizza API-gated; others FBX/OBJ
// needing Blender), so this authors one with @gltf-transform: a low cedar-log
// lodge with a gable shingle roof, a covered front porch on posts, warm-lit
// windows, a door, and a stone chimney. Oriented +Y up with its long axis on X
// (the widest extent) so the prop loader (upright:true) scales that span to the
// authored `len` and stands the base on the ground.
//
// Run: node scripts/gen-clubhouse.mjs  → assets/models/props/clubhouse.glb
import { Document, NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'models', 'props', 'clubhouse.glb');
const doc = new Document();
const buf = doc.createBuffer();
const scene = doc.createScene();

const materials = {};
function matFor(color, emissive = [0, 0, 0]) {
  const key = color.join(',') + '|' + emissive.join(',');
  if (!materials[key]) {
    materials[key] = doc.createMaterial(key).setBaseColorFactor([...color, 1]).setRoughnessFactor(0.92).setMetallicFactor(0)
      .setEmissiveFactor(emissive);
  }
  return materials[key];
}

// Collect triangles per material, emit one primitive/mesh per material at the end.
const groups = new Map(); // matKey -> { mat, verts:[], idx:[] }
function group(color, emissive) {
  const mat = matFor(color, emissive);
  const key = color.join(',') + '|' + (emissive || [0, 0, 0]).join(',');
  if (!groups.has(key)) groups.set(key, { mat, verts: [], idx: [] });
  return groups.get(key);
}
// Add one flat quad (a,b,c,d CCW) with a shared face normal.
function quad(g, a, b, c, d) {
  const base = g.verts.length / 3;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  for (const p of [a, b, c, d]) g.verts.push(p[0], p[1], p[2]);
  // normals stored parallel to verts via a side table
  g._nor = g._nor || [];
  for (let i = 0; i < 4; i++) g._nor.push(nx, ny, nz);
  g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function tri(g, a, b, c) {
  const base = g.verts.length / 3;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  for (const p of [a, b, c]) g.verts.push(p[0], p[1], p[2]);
  g._nor = g._nor || [];
  for (let i = 0; i < 3; i++) g._nor.push(nx, ny, nz);
  g.idx.push(base, base + 1, base + 2);
}
// Axis-aligned box [x0,x1]x[y0,y1]x[z0,z1] with outward normals.
function box(g, x0, x1, y0, y1, z0, z1) {
  quad(g, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // +z
  quad(g, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]); // -z
  quad(g, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); // +x
  quad(g, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // -x
  quad(g, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]); // +y
  quad(g, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // -y
}

const LOG = [0.55, 0.41, 0.26];      // cedar-log walls
const TRIM = [0.42, 0.30, 0.18];     // darker corner posts / door frame
const ROOF = [0.30, 0.23, 0.17];     // brown shingle gable
const STONE = [0.5, 0.49, 0.46];     // chimney fieldstone
const GLASS = [0.98, 0.86, 0.5];     // warm-lit windows
const PORCH = [0.46, 0.34, 0.21];    // porch deck / posts

// --- Main lodge body: long axis on X (widest), front faces +Z ---
const HW = 1.0, HD = 0.62, WALL = 0.82; // half-width, half-depth, wall height
box(group(LOG), -HW, HW, 0, WALL, -HD, HD);
// Corner posts (log-cabin ends) for a touch of relief.
for (const sx of [-HW, HW]) for (const sz of [-HD, HD]) {
  box(group(TRIM), sx - 0.07, sx + 0.07, 0, WALL + 0.04, sz - 0.07, sz + 0.07);
}
// Front door + two warm windows on the +Z wall.
box(group(TRIM), -0.16, 0.16, 0, 0.62, HD, HD + 0.02);           // door frame
box(group([0.3, 0.2, 0.12]), -0.12, 0.12, 0.02, 0.58, HD + 0.005, HD + 0.03); // door
for (const wx of [-0.62, 0.62]) box(group(GLASS, [0.5, 0.4, 0.16]), wx - 0.16, wx + 0.16, 0.34, 0.62, HD, HD + 0.02);
// A window on each gable end too.
for (const sx of [-HW, HW]) box(group(GLASS, [0.5, 0.4, 0.16]), sx, sx + 0.02 * Math.sign(sx || 1), 0.34, 0.6, -0.14, 0.14);

// --- Gable roof: ridge along X, eaves overhang front/back and the ends ---
const RIDGE = 1.34, EAVE = 0.8, OX = HW + 0.14, OZ = HD + 0.16;
const gR = group(ROOF);
// two sloped planes
quad(gR, [-OX, EAVE, OZ], [OX, EAVE, OZ], [OX, RIDGE, 0], [-OX, RIDGE, 0]);   // front slope
quad(gR, [OX, EAVE, -OZ], [-OX, EAVE, -OZ], [-OX, RIDGE, 0], [OX, RIDGE, 0]); // back slope
// gable triangles filling the wall-top to ridge at each end
for (const sx of [-HW, HW]) {
  const g = group(LOG);
  tri(g, [sx, WALL, HD], [sx, WALL, -HD], [sx, RIDGE, 0]);
}
// eave fascia end-caps (thin) so the roof reads solid from the side
for (const sx of [-OX, OX]) {
  const s = Math.sign(sx);
  tri(group(ROOF), [sx, EAVE, OZ], [sx, RIDGE, 0], [sx, EAVE, -OZ]);
}

// --- Covered front porch: a lower shed roof on two posts ---
const PZ = HD + 0.5; // porch front edge
box(group(PORCH), -0.02, 0.02, 0, 0.66, 0, 0); // (noop guard)
for (const px of [-0.72, 0.72]) box(group(PORCH), px - 0.05, px + 0.05, 0, 0.7, PZ - 0.06, PZ + 0.06);
// porch deck
box(group(PORCH), -0.9, 0.9, 0, 0.06, HD, PZ + 0.05);
// porch shed roof (slopes down from the wall to the post tops)
quad(group(ROOF), [-0.92, 0.66, PZ + 0.08], [0.92, 0.66, PZ + 0.08], [0.92, 0.86, HD], [-0.92, 0.86, HD]);

// --- Stone chimney on the back-left roof slope ---
box(group(STONE), 0.5, 0.74, 0, 1.6, -0.34, -0.1);

// Emit accessors/meshes per material group.
for (const [key, g] of groups) {
  if (!g.idx.length) continue;
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.verts)).setBuffer(buf);
  const nrm = doc.createAccessor().setType('VEC3').setArray(new Float32Array(g._nor)).setBuffer(buf);
  const ind = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(g.idx)).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nrm).setIndices(ind).setMaterial(g.mat);
  scene.addChild(doc.createNode('part_' + key).setMesh(doc.createMesh('m_' + key).addPrimitive(prim)));
}

await new NodeIO().write(OUT, doc);
console.log('wrote', OUT);
