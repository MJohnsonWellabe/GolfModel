import '@babylonjs/loaders/glTF';
import {
  AnimationGroup,
  AssetContainer,
  LoadAssetContainerAsync,
  Scene,
  TransformNode,
  Vector3
} from '@babylonjs/core';
import { characterByKey } from '../data/characters';

/**
 * Loader for the rigged chibi character pack ("Cute Characters 4"). Unlike the
 * old single-file pack, each character is its own self-contained glb (body +
 * embedded texture + a 64-bone Rigify skeleton + seven baked clips: A-pose,
 * Idle, Run, Sad, Song Jump, Walk, Win). We only use Idle (stance), Win
 * (celebrate) and Sad (deject) in-game; the golf swing itself is driven
 * procedurally on the skeleton (see golfer3d.ts), since the pack has no swing
 * clip.
 *
 * A container is cached per (scene, character) so repeated golfers on one hole
 * share the download, while a fresh hole (new Babylon scene) reloads cleanly —
 * containers are scene-bound, so caching across scenes would dangle once a
 * hole is disposed.
 */

/** Target standing height in world units — matches the procedural golfer's
 * deliberately oversized ~5.2-unit ("~2.6yd") stylized scale. */
const TARGET_HEIGHT = 5.2;

const cache = new WeakMap<Scene, Map<string, Promise<AssetContainer>>>();

function containerFor(scene: Scene, key: string, file: string): Promise<AssetContainer> {
  let perScene = cache.get(scene);
  if (!perScene) {
    perScene = new Map();
    cache.set(scene, perScene);
  }
  let p = perScene.get(key);
  if (!p) {
    p = LoadAssetContainerAsync(file, scene);
    perScene.set(key, p);
  }
  return p;
}

export interface CharacterInstance {
  /** Scaled, floor-rested (feet at y=0), X/Z-centered avatar root. */
  root: TransformNode;
  /** Animation clips by name (already stopped; caller starts what it needs). */
  anims: Map<string, AnimationGroup>;
  /** Skeleton bone → linked transform node, keyed by bone name, for the
   * procedural swing (rotate these to pose the rig). */
  bones: Map<string, TransformNode>;
}

/**
 * Instantiate one character avatar into the scene. Each call produces an
 * independent copy — its own skeleton and its own animation-group instances —
 * so two golfers never share a pose.
 */
export async function instantiateCharacter(scene: Scene, key: string): Promise<CharacterInstance> {
  const def = characterByKey(key);
  if (!def) throw new Error(`Unknown character "${key}"`);
  const container = await containerFor(scene, def.key, def.file);
  // Each call clones an independent copy — its own skeleton + animation-group
  // instances — so two golfers never share a pose.
  const inst = container.instantiateModelsToScene(undefined, false, { doNotInstantiate: true });
  const root = inst.rootNodes[0] as TransformNode;

  const anims = new Map<string, AnimationGroup>();
  inst.animationGroups.forEach((ag) => {
    ag.stop();
    anims.set(ag.name, ag);
  });

  const bones = new Map<string, TransformNode>();
  inst.skeletons.forEach((sk) =>
    sk.bones.forEach((b) => {
      const tn = b.getTransformNode();
      if (tn) bones.set(b.name, tn as TransformNode);
    })
  );

  // Normalize scale + origin independent of the pack's per-character export:
  // scale so the model stands TARGET_HEIGHT tall, then rest feet on y=0 and
  // center on X/Z so placeAt() positions it like the procedural golfer.
  root.computeWorldMatrix(true);
  let bounds = root.getHierarchyBoundingVectors(true);
  const rawHeight = bounds.max.y - bounds.min.y || 1;
  const s = TARGET_HEIGHT / rawHeight;
  root.scaling = new Vector3(s, s, s);
  root.computeWorldMatrix(true);
  bounds = root.getHierarchyBoundingVectors(true);
  root.position.x -= (bounds.min.x + bounds.max.x) / 2;
  root.position.y -= bounds.min.y;
  root.position.z -= (bounds.min.z + bounds.max.z) / 2;
  root.computeWorldMatrix(true);

  return { root, anims, bones };
}
