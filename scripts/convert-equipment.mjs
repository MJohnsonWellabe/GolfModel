// Convert the uploaded golf-club FBX to a clean, small glb for the 3D club rig.
// Pipeline: FBX2glTF (prebuilt binary from the fbx2gltf devDependency) -> keep
// ONLY the club mesh (drop the huge ball icosphere + Blender lights/cameras) ->
// gltf-transform dedup/weld/prune/quantize. Run offline; the glb is committed
// and the build never runs this.
//   node scripts/convert-equipment.mjs
import { NodeIO } from '@gltf-transform/core';
import { dedup, weld, prune, quantize } from '@gltf-transform/functions';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const fbx2gltf = path.join(ROOT, 'node_modules', 'fbx2gltf', 'bin', os.type(), os.type() === 'Windows_NT' ? 'FBX2glTF.exe' : 'FBX2glTF');

const SRC = process.argv[2] || path.join(ROOT, 'asset-packs', 'uploaded-club', 'golf_club_and_ball_fbx.fbx');
const OUT = process.argv[3] || path.join(ROOT, 'assets', 'models', 'equipment', 'club.glb');
const rawBase = OUT.replace(/\.glb$/, '_raw');

execFileSync(fbx2gltf, ['--binary', '--input', SRC, '--output', rawBase], { stdio: 'inherit' });

const io = new NodeIO();
const doc = await io.read(`${rawBase}.glb`);
const root = doc.getRoot();

// Keep only the club: detach every other mesh, drop cameras/lights/empties.
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  const name = node.getName();
  if (mesh && !mesh.getName().toLowerCase().includes('club')) node.setMesh(null);
  if (name === 'Camera' || name.startsWith('Light') || name.startsWith('Point')) node.dispose();
}
for (const cam of root.listCameras()) cam.dispose();

await doc.transform(dedup(), weld(), prune(), quantize());
await io.write(OUT, doc);
console.log('wrote', OUT);
