/**
 * The glTF loader, registered with ONLY what this game's models use.
 *
 * `import '@babylonjs/loaders/glTF'` registers the glTF 1.0 loader (which no
 * asset here uses), the 2.0 loader, and every one of its ~30 extensions —
 * area lights, IES profiles, image-based lighting, animation pointers,
 * variants, XMP metadata, AVIF/WebP texture codecs. Each drags in the engine
 * code it needs, and none of it can be tree-shaken because registration is a
 * side effect.
 *
 * Reading `extensionsUsed` out of every .glb in assets/models shows the real
 * requirement is six extensions. They are registered individually below; the
 * meshopt decoder is registered too because the asset pipeline compresses
 * geometry with it (scripts/compress-models.mjs).
 *
 * If a newly-authored model fails to load with a "not supported" warning in the
 * console, its extension needs adding here. `npm run models:audit` prints the
 * extension set every shipped model declares, which is the list this file must
 * cover.
 */

// Registers the .glb/.gltf plugin with Babylon's SceneLoader. WITHOUT THIS
// NOTHING LOADS — and it fails silently: `LoadAssetContainerAsync` simply
// resolves with an empty container, so the course builds with no trees and no
// characters rather than throwing. (That is exactly what happened the first
// time this file was written; the batching pixel gate reported "0 props" on
// both paths and passed, because both were equally empty.)
import '@babylonjs/loaders/glTF/glTFFileLoader';
// The glTF 2.0 reader itself. (1.0 is deliberately not registered — no asset
// in this project is glTF 1.0.)
import '@babylonjs/loaders/glTF/2.0/glTFLoader';

// The six extensions the shipped models actually declare.
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_ior';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_pbrSpecularGlossiness';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform';

// Geometry compression applied by the asset pipeline. Registered
// unconditionally: an uncompressed model simply never asks for it.
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression';

import { AssetContainer, LoadAssetContainerAsync, Scene } from './babylon';

/**
 * Load a model into a scene that might not be there when it arrives.
 *
 * Every model in this game loads asynchronously into a scene that lives exactly
 * one hole, and a hole can end — or be abandoned — while a load is still in
 * flight. Babylon disposes a container along with its scene, but only through
 * an observer the container registers when it is CONSTRUCTED: a container built
 * after `scene.dispose()` has already run never sees that signal, so its
 * geometry and textures are created on a dead scene with nothing left to free
 * them. Adding one to a disposed scene is worse still — `addAllToScene` marks it
 * as the scene's problem, and the scene is gone.
 *
 * So the resolution is guarded in exactly one place. Callers get `null` when the
 * scene did not survive the wait, and the container disposes itself.
 */
export async function loadModelInto(file: string, scene: Scene): Promise<AssetContainer | null> {
  const container = await LoadAssetContainerAsync(file, scene);
  if (scene.isDisposed) {
    container.dispose();
    return null;
  }
  return container;
}

/**
 * Thrown by the loaders that cache a promise, where "null" has nowhere to go.
 *
 * Callers treat it differently from a failed fetch: a fetch that fails deserves
 * a retry or a fallback, while a scene that has gone deserves neither — every
 * fallback would build into the same dead scene.
 */
export class SceneGoneError extends Error {
  constructor() {
    super('the scene was disposed while the model loaded');
    this.name = 'SceneGoneError';
  }
}
