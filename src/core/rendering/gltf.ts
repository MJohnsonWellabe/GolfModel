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
