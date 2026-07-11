// Convert one club out of the uploaded golf_clubs glTF (two clubs share the file:
// golf_club_01 and golf_club_02, each a head+shaft pair) into the clean, small
// club.glb the 3D club rig loads. Keeps only the requested club's meshes, drops
// everything else, then dedup/weld/prune/quantize. Run offline; the glb is
// committed and the build never runs this.
//   node scripts/convert-club-gltf.mjs [golf_club_01|golf_club_02] [out.glb]
import { NodeIO } from '@gltf-transform/core';
import { dedup, weld, prune, quantize } from '@gltf-transform/functions';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KEEP = process.argv[2] || 'golf_club_01';
const SRC = path.join(ROOT, 'asset-packs', 'uploaded-club', 'golf_clubs', 'scene.gltf');
const OUT = process.argv[3] || path.join(ROOT, 'assets', 'models', 'equipment', 'club.glb');

const io = new NodeIO();
const doc = await io.read(SRC);
const root = doc.getRoot();

// Detach every mesh whose node isn't part of the chosen club (names look like
// `golf_club_01_blinn1_0`), and dispose the now-empty sibling club node so prune
// drops its meshes/materials/accessors entirely.
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  if (!mesh.getName().startsWith(KEEP)) node.setMesh(null);
}
for (const cam of root.listCameras()) cam.dispose();

await doc.transform(dedup(), weld(), prune(), quantize());
await io.write(OUT, doc);
console.log('wrote', OUT, 'from', KEEP);
