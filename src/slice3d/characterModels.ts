import '@babylonjs/loaders/glTF';
import {
  AssetContainer,
  LoadAssetContainerAsync,
  Mesh,
  Quaternion,
  Scene,
  TransformNode,
  Vector3
} from '@babylonjs/core';

/**
 * Downloaded chibi character pack (Blender → glTF, no armature/animations —
 * see docs/ARCHITECTURE_REVIEW.md). Of the five bodies inside, only two are
 * fully assembled (body + face + hair + full outfit all sharing one baked
 * transform) — a "Knight" and a "Ninja". Everything else in the pack has
 * hair/clothing baked at mismatched positions (the export lost its rig) and
 * isn't safely reassemblable without the source .blend file, so it's unused.
 */
export type CharacterModelKey = 'knight' | 'ninja';

const MODEL_URL = '/models/chibi_characters.glb';

/** Node names sharing one consistent baked transform in the source file. */
const GROUP_NODES: Record<CharacterModelKey, string[]> = {
  knight: [
    'amorarm.001',
    'amorplastron.001',
    'amorshoulders',
    'armorceinturethighs.001',
    'armorhelmet.001',
    'armorknees.001',
    'armorlegs.001',
    'armorshoe.001',
    'armorskirt.001',
    'armorthights.001',
    'ceinture.001',
    'character_low.001',
    'eyelashes.001',
    'eyes.001',
    'hairtailknight.001',
    'tooth.001'
  ],
  ninja: [
    'character_low.002',
    'eyelashes.002',
    'eyes.002',
    'hairtail.001',
    'ninjassuit.001',
    'ninjassuitmask.001',
    'ninjassuitshoe.001',
    'ninjassuitthigh.001',
    'short.002',
    'tooth.002'
  ]
};

/** Both bodies bake to ~2.1 world units tall pre-scale; the procedural
 * golfer targets ~5.2 units ("oversized at ~2.6yd" — see golfer3d.ts), so
 * one shared multiplier brings either body up to that same stylized size. */
const TARGET_SCALE = 2.48;

let containerPromise: Promise<AssetContainer> | null = null;

/** Load the pack once per page session; every clone reuses this container. */
function loadContainer(scene: Scene): Promise<AssetContainer> {
  if (!containerPromise) {
    containerPromise = LoadAssetContainerAsync(MODEL_URL, scene).then((container) => {
      container.addAllToScene();
      // The master copies sit at the pack's original (unrelated) layout
      // positions — hide them; only clones we spawn per-golfer should render.
      container.meshes.forEach((m) => m.setEnabled(false));
      return container;
    });
  }
  return containerPromise;
}

/**
 * Clone one character body out of the shared pack and return it parented
 * under a fresh, correctly-scaled TransformNode ready to attach under a
 * Golfer3D's root. Resolves once the (session-cached) asset has loaded.
 */
export async function cloneCharacterBody(scene: Scene, key: CharacterModelKey): Promise<TransformNode> {
  const container = await loadContainer(scene);
  const names = GROUP_NODES[key];
  const wrapper = new TransformNode(`bodyModel-${key}`, scene);
  wrapper.scaling = new Vector3(TARGET_SCALE, TARGET_SCALE, TARGET_SCALE);

  for (const name of names) {
    const master = container.meshes.find((m) => m.name === name) as Mesh | undefined;
    if (!master) continue; // defensive — never expected once verified
    const clone = master.clone(`${name}-${key}`, null, false) as Mesh;
    clone.setEnabled(true);
    clone.position = Vector3.Zero();
    clone.rotationQuaternion = Quaternion.Identity();
    clone.scaling = Vector3.One();
    clone.parent = wrapper;
  }

  // Recenter on X/Z and rest the feet at y=0, independent of this pack's own
  // arbitrary per-character proportions/origins.
  wrapper.computeWorldMatrix(true);
  const { min, max } = wrapper.getHierarchyBoundingVectors(true);
  wrapper.position.x -= (min.x + max.x) / 2;
  wrapper.position.y -= min.y;
  wrapper.position.z -= (min.z + max.z) / 2;
  wrapper.computeWorldMatrix(true);

  return wrapper;
}
