import '@babylonjs/loaders/glTF';
import {
  Color3,
  LoadAssetContainerAsync,
  Mesh,
  Scene,
  StandardMaterial
} from '@babylonjs/core';

/**
 * Loader for the purchased "Fantastic Nature" prop pack (FBX → glb offline; see
 * asset-packs/fantastic-nature-pack). Each prop is a static low-poly mesh that
 * ships with material *slots* but no textures, so we recolor by slot name into
 * flat stylized materials tuned to the course theme — consistent with the
 * game's cel-shaded look. buildCourse() spawns lightweight instances of these
 * at the same tree-blob positions the baked course texture drops shadows for.
 *
 * Props with several material slots (e.g. a tree's trunk + foliage) are kept as
 * separate single-material prototype meshes rather than merged into one
 * multi-material mesh — instancing single-material meshes is both simpler and
 * avoids a multi-material-instance rendering path some GPUs handle poorly.
 */

const c3 = (hex: number): Color3 =>
  new Color3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

/** Prop files under assets/models/nature (relative — GitHub Pages subpath). */
export const TREE_KEYS = ['tree_a', 'tree_b', 'tree_c', 'tree_d'] as const;
export const STONE_KEYS = ['stone_a', 'stone_b', 'stone_c'] as const;
export const BUSH_KEYS = ['bush_a', 'bush_b'] as const;
export const GRASS_KEYS = ['grass_a', 'grass_b'] as const;
export const FLOWER_KEYS = ['flower_a'] as const;
const ALL_KEYS = [...TREE_KEYS, ...STONE_KEYS, ...BUSH_KEYS, ...GRASS_KEYS, ...FLOWER_KEYS];

export interface NaturePalette {
  bark: number;
  foliage: number;
  foliageLight: number;
  grass: number;
  stone: number;
}

export interface NatureProto {
  /** One prototype mesh per material slot; instance them all together. */
  parts: Mesh[];
  /** Native world-unit height, for scaling to a target size. */
  height: number;
}

const cache = new WeakMap<Scene, Promise<Map<string, NatureProto>>>();

/** Load + recolor every prop once per scene; instances share the prototypes. */
export function loadNaturePrototypes(scene: Scene, palette: NaturePalette): Promise<Map<string, NatureProto>> {
  let p = cache.get(scene);
  if (!p) {
    p = build(scene, palette);
    cache.set(scene, p);
  }
  return p;
}

async function build(scene: Scene, palette: NaturePalette): Promise<Map<string, NatureProto>> {
  const barkMat = flat(scene, 'natBark', palette.bark);
  const foliageMat = flat(scene, 'natFoliage', palette.foliage);
  const foliageLightMat = flat(scene, 'natFoliageL', palette.foliageLight);
  const grassMat = flat(scene, 'natGrass', palette.grass);
  const stoneMat = flat(scene, 'natStone', palette.stone);

  const pickMat = (slot: string): StandardMaterial => {
    const n = slot.toLowerCase();
    if (n.includes('wood')) return barkMat;
    if (n.includes('grass')) return grassMat;
    if (n.includes('stone')) return stoneMat;
    if (n.includes('plant')) return foliageMat;
    return foliageLightMat;
  };

  const out = new Map<string, NatureProto>();
  await Promise.all(
    ALL_KEYS.map(async (key) => {
      const container = await LoadAssetContainerAsync(`models/nature/${key}.glb`, scene);
      container.addAllToScene();
      const raw = container.meshes.filter((mm): mm is Mesh => mm instanceof Mesh && mm.getTotalVertices() > 0);
      if (!raw.length) return;

      // Group by recolored material, then merge each group into ONE clean
      // single-material prototype. MergeMeshes bakes each source's full world
      // matrix (the glTF __root__ unit/handedness transform included) into the
      // vertices, so the result's LOCAL geometry is its true world geometry —
      // exactly what instances need, since an instance uses only the source's
      // vertex data plus its own transform. Keeping one mesh per material
      // avoids the multi-material instancing path.
      const byMat = new Map<string, Mesh[]>();
      raw.forEach((mm) => {
        const mat = pickMat(mm.material?.name ?? '');
        mm.material = mat;
        const g = byMat.get(mat.name);
        if (g) g.push(mm);
        else byMat.set(mat.name, [mm]);
      });

      const parts: Mesh[] = [];
      let minY = Infinity;
      let maxY = -Infinity;
      for (const group of byMat.values()) {
        const merged = Mesh.MergeMeshes(group, true, true, undefined, false, false);
        if (!merged) continue;
        merged.name = `natProto-${key}-${merged.material?.name ?? 'm'}`;
        merged.isPickable = false;
        merged.refreshBoundingInfo();
        const bb = merged.getBoundingInfo().boundingBox;
        minY = Math.min(minY, bb.minimum.y);
        maxY = Math.max(maxY, bb.maximum.y);
        // Park below ground (kept enabled — Babylon only draws an instanced
        // mesh's instances while its source mesh is enabled).
        merged.position.y = -9000;
        parts.push(merged);
      }
      if (parts.length) out.set(key, { parts, height: maxY - minY || 1 });
    })
  );
  return out;
}

function flat(scene: Scene, name: string, color: number): StandardMaterial {
  const mt = new StandardMaterial(name, scene);
  mt.diffuseColor = c3(color);
  mt.specularColor = new Color3(0.02, 0.02, 0.02);
  // Baking the glTF handedness-flip transform into the vertices inverts
  // triangle winding, so render both sides rather than culling the (now
  // back-facing) front faces — cheap and fine for these stylized props.
  mt.backFaceCulling = false;
  return mt;
}

/** Deterministic hash in [0,1) so prop placement is stable across reloads. */
export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
