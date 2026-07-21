// Generate a clean stylized SAILBOAT GLB to replace the mis-scaled pirate
// galleon (assets/models/nature/ship.glb — its node is literally named "pirate
// ship", garish orange, with a pathological baked scale). A resort island green
// (Sable Bay H2) must not be backdropped by pirate ships. No suitable CC0
// sailboat GLB was fetchable here (poly.pizza API-gated; others FBX/OBJ needing
// Blender), so this authors a genuine sailboat mesh with @gltf-transform.
//
// The course3d ship loader maps parts to materials by LUMINANCE (bright→sail,
// mid→trim, dark→hull) and normalizes the whole model by its X-length, so the
// boat is built along +X (bow +X) with a DARK hull, MID mast, and BRIGHT sails.
//
// Run: node scripts/gen-sailboat.mjs  → assets/models/nature/ship.glb
import { Document, NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'models', 'nature', 'ship.glb');
const doc = new Document();
const buf = doc.createBuffer();

// helper: push a triangle-mesh part from flat vertex list + indices
function part(name, verts, idxs, color, rough = 1) {
  // per-vertex normals (flat, per triangle)
  const normals = new Array(verts.length).fill(0);
  for (let t = 0; t < idxs.length; t += 3) {
    const a = idxs[t] * 3, b = idxs[t + 1] * 3, c = idxs[t + 2] * 3;
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const vi of [idxs[t], idxs[t + 1], idxs[t + 2]]) { normals[vi * 3] += nx; normals[vi * 3 + 1] += ny; normals[vi * 3 + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) { const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1; normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l; }
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(verts)).setBuffer(buf);
  const nrm = doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buf);
  const ind = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idxs)).setBuffer(buf);
  const m = doc.createMaterial(name).setBaseColorFactor([...color, 1]).setRoughnessFactor(rough).setMetallicFactor(0);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nrm).setIndices(ind).setMaterial(m);
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
}

// HULL — a chine hull along X: flat-ish bottom, flared sides, pointed bow (+X),
// square transom (−X). Deck open. Dark varnished wood (luma ~0.12 → shipHull).
const bx = 1.0, sx = -0.9, bw = 0.0, mw = 0.34, by = -0.34, dy = 0.02; // bow/stern x, beam, keel/deck y
const hv = [
  bx, dy, bw,        // 0 bow deck point
  bx - 0.15, by * 0.5, bw, // 1 bow keel
  sx, dy, mw, sx, dy, -mw, // 2,3 stern deck L/R
  sx, by, mw * 0.5, sx, by, -mw * 0.5, // 4,5 stern keel L/R
  0.15, dy, mw, 0.15, dy, -mw,   // 6,7 mid deck L/R
  0.1, by, mw * 0.45, 0.1, by, -mw * 0.45 // 8,9 mid keel L/R
];
const hi = [
  0,6,1, 0,1,7,        // bow sides (deck edge to keel)
  6,8,1, 7,1,9,        // bow lower
  6,2,8, 8,2,4,        // mid-stern left side
  7,9,3, 9,5,3,        // mid-stern right side
  8,4,9, 9,4,5,        // bottom aft
  1,8,9,               // bottom fore
  2,3,4, 4,3,5,        // transom
  0,7,6, 2,6,7, 2,7,3  // deck (open-ish top, thin)
];
const hull = part('hull', hv, hi, [0.14, 0.09, 0.05]);

// MAST — a thin tall box at midship, medium wood (luma ~0.34 → shipTrim).
const mm = 0.03, mh = 1.15, mbx = 0.15;
const mv = [
  mbx-mm,dy,-mm, mbx+mm,dy,-mm, mbx+mm,dy,mm, mbx-mm,dy,mm,
  mbx-mm,mh,-mm, mbx+mm,mh,-mm, mbx+mm,mh,mm, mbx-mm,mh,mm
];
const mi = [0,1,5,0,5,4, 1,2,6,1,6,5, 2,3,7,2,7,6, 3,0,4,3,4,7, 4,5,6,4,6,7];
const mast = part('mast', mv, mi, [0.42, 0.34, 0.22]);

// MAINSAIL — a triangle from the mast (fore) back to a low aft boom; bright
// cream cloth (luma ~0.9 → shipSail). Double-sided handled by lighting; add a
// mirrored winding so both faces show.
const smv = [ mbx, 0.06, 0.0,  mbx, mh - 0.06, 0.0,  sx + 0.15, 0.02, 0.0 ];
const smi = [ 0,1,2, 0,2,1 ];
const mainsail = part('mainsail', smv, smi, [0.95, 0.94, 0.88], 1);

// JIB — a smaller foresail triangle from mast top toward the bow.
const jv = [ mbx, mh - 0.1, 0.0,  mbx, 0.06, 0.0,  bx - 0.05, 0.04, 0.0 ];
const ji = [ 0,1,2, 0,2,1 ];
const jib = part('jib', jv, ji, [0.93, 0.92, 0.86], 1);

const scene = doc.createScene();
for (const n of [hull, mast, mainsail, jib]) scene.addChild(n);
await new NodeIO().write(OUT, doc);
console.log('wrote', OUT);
