/**
 * The ONE place the game reaches into Babylon.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `import { Mesh } from '@babylonjs/core'` reads nicely and costs a fortune.
 * The barrel re-exports the entire engine — WebXR, node materials, PBR, the
 * physics plugins, the audio engine, every post-process — and Babylon's own
 * `sideEffects` manifest marks large parts of it as side-effectful, so Rollup
 * cannot prove they are unused and keeps them. Measured on this project: the
 * `babylon` chunk was **6.75 MB raw / 1.48 MB gzipped**, which is most of the
 * ~8 MB a first-time player downloads before their opening tee shot.
 *
 * The game uses 33 symbols. Importing each from its own module lets the
 * bundler drop everything else. Doing that inline across eleven source files
 * would scatter thirty deep paths through the codebase and make it easy to
 * reintroduce a barrel import by accident, so the deep paths live here once and
 * every other module imports from `core/rendering/babylon`.
 *
 * ADDING A SYMBOL
 * ---------------
 * Add its deep path below — never re-export from '@babylonjs/core', and never
 * import '@babylonjs/core' anywhere else. `tests/bundle.test.ts` enforces both.
 * If a feature silently stops working after being added here, it is almost
 * certainly a missing SIDE-EFFECT registration (see the block at the bottom):
 * Babylon wires optional capabilities onto Scene/Mesh prototypes from separate
 * modules that the barrel used to pull in for free.
 */

export { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
export { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
export { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
export { AssetContainer } from '@babylonjs/core/assetContainer';
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
export { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
export { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
export { Engine } from '@babylonjs/core/Engines/engine';
export { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
export { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
export { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
export { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
export { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
export { Mesh } from '@babylonjs/core/Meshes/mesh';
export { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
export { MirrorTexture } from '@babylonjs/core/Materials/Textures/mirrorTexture';
export { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
export { Plane } from '@babylonjs/core/Maths/math.plane';
export { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
export { Scene } from '@babylonjs/core/scene';
export { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
export { SolidParticleSystem } from '@babylonjs/core/Particles/solidParticleSystem';
export { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
export { Texture } from '@babylonjs/core/Materials/Textures/texture';
export { TrailMesh } from '@babylonjs/core/Meshes/trailMesh';
export { TransformNode } from '@babylonjs/core/Meshes/transformNode';
export { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
export { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
export { Viewport } from '@babylonjs/core/Maths/math.viewport';

// ------------------------------------------------------- side-effect imports
// Babylon attaches optional capabilities to Scene/Mesh/Engine prototypes from
// standalone modules. The barrel import pulled these in implicitly; with deep
// imports they must be requested by name or the feature fails at RUNTIME, not
// at build time — which is exactly the kind of regression a bundle-size change
// must not smuggle in. Each entry below names the feature that needs it.

// THIN INSTANCES — `Mesh.thinInstanceSetBuffer` / `thinInstanceCount` /
// `thinInstanceBufferUpdated` are installed onto Mesh.prototype by this module.
// Without it Babylon leaves behind stub methods that do nothing, so the
// `natureBatching` planter silently draws no scenery at all. (It did exactly
// that the first time these deep imports landed.)
import '@babylonjs/core/Meshes/thinInstanceMesh';
// ShadowGenerator only participates in the render loop once its scene component
// is registered (the game's directional-light shadows).
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
// Depth renderer backs the shadow map's depth pass.
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
// MeshBuilder.CreateGround/Sphere/etc. live in per-shape modules.
import '@babylonjs/core/Meshes/Builders/groundBuilder';
import '@babylonjs/core/Meshes/Builders/sphereBuilder';
import '@babylonjs/core/Meshes/Builders/boxBuilder';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import '@babylonjs/core/Meshes/Builders/planeBuilder';
import '@babylonjs/core/Meshes/Builders/discBuilder';
import '@babylonjs/core/Meshes/Builders/torusBuilder';
import '@babylonjs/core/Meshes/Builders/ribbonBuilder';
import '@babylonjs/core/Meshes/Builders/tubeBuilder';
import '@babylonjs/core/Meshes/Builders/latheBuilder';
import '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import '@babylonjs/core/Meshes/Builders/polygonBuilder';
import '@babylonjs/core/Meshes/Builders/linesBuilder';
// Mesh.MergeMeshes + CreateInstance data paths.
import '@babylonjs/core/Meshes/meshBuilder';
// Particle systems (landing puffs, celebration bursts) need their component.
import '@babylonjs/core/Particles/particleSystemComponent';
// Animation playback for the character/pal glTF animation groups.
import '@babylonjs/core/Animations/animatable';
