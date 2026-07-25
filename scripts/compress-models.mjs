// Model payload pass — shrinks the shipped .glb assets IN PLACE.
//
//   node scripts/compress-models.mjs            # compress everything not yet done
//   node scripts/compress-models.mjs --dry      # report only, write nothing
//   node scripts/compress-models.mjs --force    # redo files already compressed
//
// WHY
// ---
// A first-time player downloads ~5 MB of .glb before their opening tee shot,
// and the repo carries 110 MB of models. Inspecting them showed the weight is
// not where you would guess:
//
//   chip.glb  3.36 MB  =  15.7k tris + ONE 11 KB texture + 3.17 MB of ANIMATION
//
// Every character is ~95 % baked animation keyframes, sampled per frame and
// stored as raw float32 — including the long runs of frames where a joint does
// not move at all. Resampling to keyframes that actually carry information
// (linear tolerance 1e-4, far below what a 1024-px viewport can resolve) cuts a
// character by two thirds and does not touch a single vertex.
//
// WHAT EACH FAMILY GETS
// ---------------------
//   characters/, pals/  dedup + resample   — animation keyframe reduction.
//                                            Geometry is bit-identical.
//   nature/, props/,    dedup + weld +     — no animation to resample; welding
//   equipment/          prune                merges duplicate vertices left by
//                                            the source exporters.
//
// Nothing here quantizes positions, normals or UVs, and nothing recompresses a
// texture: the rendered image is meant to be unchanged, and
// tests/visual/natureBatching.spec.ts pixel-compares three courses to prove it.
//
// IDEMPOTENT: a compressed file is stamped in `asset.extras.bsgCompressed`, and
// stamped files are skipped unless --force is passed. The pre-compression
// originals live in git history if a file ever needs to be recovered.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, weld } from '@gltf-transform/functions';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'assets/models';
/** Linear-interpolation error allowed when dropping a keyframe, in the model's
 *  own units. Joints move by whole units; 1e-4 is four orders of magnitude
 *  below anything a viewport can show. */
const RESAMPLE_TOLERANCE = 1e-4;
/** Stamp written into the glTF asset extras so re-runs skip finished files. */
const STAMP = 'bsgCompressed';
const STAMP_VERSION = 1;

const ANIMATED_DIRS = new Set(['characters', 'pals']);

const dry = process.argv.includes('--dry');
const force = process.argv.includes('--force');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.glb')) out.push(p);
  }
  return out;
}

// Some source models were exported with KHR_mesh_quantization (and the nature
// pack uses KHR_texture_transform); the reader refuses a file whose REQUIRED
// extensions it does not know, so register the full set for I/O.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const files = walk(ROOT).sort();
let before = 0;
let after = 0;
let done = 0;
let skipped = 0;
const failures = [];

for (const file of files) {
  const size = statSync(file).size;
  const family = file.split('/')[2] ?? '';
  let doc;
  try {
    doc = await io.read(file);
  } catch (err) {
    // A model that references an external texture that is not on disk (a few
    // props ship that way) cannot be rewritten safely — leave it exactly as it
    // is and report it, rather than aborting the whole pass.
    failures.push(`${file}: ${err.message}`);
    before += size;
    after += size;
    continue;
  }
  const extras = doc.getRoot().getAsset().extras ?? {};
  if (extras[STAMP] === STAMP_VERSION && !force) {
    skipped++;
    before += size;
    after += size;
    continue;
  }

  if (ANIMATED_DIRS.has(family)) {
    await doc.transform(dedup(), resample({ tolerance: RESAMPLE_TOLERANCE }));
  } else {
    await doc.transform(
      dedup(),
      weld({ tolerance: 0 }),
      // Accessors/materials/textures/meshes only — NEVER nodes. Babylon's
      // animation groups and the game's bone lookups address nodes by name, so
      // an "unreferenced" node is not safely removable here.
      prune({ propertyTypes: ['Accessor', 'Material', 'Texture', 'Mesh'] })
    );
  }

  const asset = doc.getRoot().getAsset();
  asset.extras = { ...extras, [STAMP]: STAMP_VERSION };
  const bytes = await io.writeBinary(doc);
  // Never let the pass make a file bigger (a tiny model's added stamp can
  // outweigh what the transforms save).
  const keep = bytes.length < size;
  if (!dry && keep) writeFileSync(file, bytes);
  before += size;
  after += keep ? bytes.length : size;
  if (keep) done++;
}

const mb = (n) => (n / 1048576).toFixed(1);
console.log(
  `${dry ? '[dry] ' : ''}${done} compressed, ${skipped} already done, ${failures.length} skipped (unreadable), ` +
    `${files.length} total: ${mb(before)} MB -> ${mb(after)} MB (${Math.round(100 - (100 * after) / before)}% saved)`
);
for (const f of failures) console.warn(`  left untouched — ${f}`);
