import '@babylonjs/loaders/glTF';
import {
  Color3,
  LoadAssetContainerAsync,
  Mesh,
  Scene,
  StandardMaterial
} from '@babylonjs/core';

/**
 * Loader for the nature prop packs (FBX → glb offline; see
 * asset-packs/fantastic-nature-pack and asset-packs/forest-nature-fbx, the
 * latter converted by scripts/convert-nature.mjs). Each prop is a static
 * low-poly mesh that
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
/** Named species from the forest pack (asset-packs/forest-nature-fbx),
 *  converted by scripts/convert-nature.mjs. Courses opt into a mix via the
 *  theme's treeKeys/accentTreeKeys/scatterKeys — see course3d.buildCourse. */
export const BROADLEAF_KEYS = [
  'tree_oak',
  'tree_birch',
  'tree_birch_b',
  'tree_maple',
  'tree_aspen',
  'tree_poplar'
] as const;
export const CONIFER_KEYS = ['tree_spruce', 'tree_spruce_tall', 'tree_pine'] as const;
/** Forest-floor props for rough-only ground scatter (visual, never physics). */
export const DEADWOOD_KEYS = ['stump_a', 'log_a'] as const;
export const FERN_KEYS = ['fern_a'] as const;
export const BERRY_KEYS = ['bush_berry'] as const;
export const STONE_KEYS = ['stone_a', 'stone_b', 'stone_c'] as const;
export const BUSH_KEYS = ['bush_a', 'bush_b'] as const;
/** Forest-pack bushes courses can opt into via theme.bushKeys. */
export const EXTRA_BUSH_KEYS = ['bush_juniper', 'bush_c'] as const;
/** Stylized volumetric cloud meshes; courses opt in via theme.cloudKeys. */
export const CLOUD_KEYS = ['cloud_a', 'cloud_b', 'cloud_c'] as const;
/** grass_c–f = the purchased Grass F tuft pack (asset-packs/grass-f): crossed
 *  unlit cards that read as soft tufts. The Fantastic Nature grass_a/b clumps
 *  are chunky slabs at turf scale, so ground scatter no longer uses them. */
export const GRASS_KEYS = ['grass_c', 'grass_d', 'grass_e', 'grass_f'] as const;
export const FLOWER_KEYS = ['flower_a'] as const;
const ALL_KEYS = [
  ...TREE_KEYS,
  ...BROADLEAF_KEYS,
  ...CONIFER_KEYS,
  ...DEADWOOD_KEYS,
  ...FERN_KEYS,
  ...BERRY_KEYS,
  ...STONE_KEYS,
  ...BUSH_KEYS,
  ...EXTRA_BUSH_KEYS,
  ...CLOUD_KEYS,
  ...GRASS_KEYS,
  ...FLOWER_KEYS
];

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

/**
 * Load + recolor props once per scene; instances share the prototypes.
 * `keys` limits the download to what the course's theme actually places
 * (default: every known prop) — the first call per scene wins the cache, so
 * both call sites in buildCourse must pass the same set. Loading is
 * per-key fault-tolerant: a failed glb logs a warning and is skipped; the
 * returned promise NEVER rejects, so one flaky fetch can't blank the course.
 */
export function loadNaturePrototypes(
  scene: Scene,
  palette: NaturePalette,
  keys: readonly string[] = ALL_KEYS
): Promise<Map<string, NatureProto>> {
  let p = cache.get(scene);
  if (!p) {
    p = build(scene, palette, keys);
    cache.set(scene, p);
  }
  return p;
}

async function build(scene: Scene, palette: NaturePalette, keys: readonly string[]): Promise<Map<string, NatureProto>> {
  const barkMat = flat(scene, 'natBark', palette.bark);
  const foliageMat = flat(scene, 'natFoliage', palette.foliage);
  const foliageLightMat = flat(scene, 'natFoliageL', palette.foliageLight);
  // Grass tufts and flowers are crossed flat cards — lit shading turns the
  // back-facing half black, so render them unlit in flat palette colors.
  const grassMat = unlit(scene, 'natGrass', palette.grass);
  const flowerMat = unlit(scene, 'natFlower', 0xe8a8c8);
  const stoneMat = flat(scene, 'natStone', palette.stone);
  // Clouds: flat near-white and self-lit so they read soft against any sky.
  const cloudMat = flat(scene, 'natCloud', 0xf2f7fb);
  cloudMat.emissiveColor = c3(0xdfe7ee);

  const pickMat = (slot: string, key: string, meshName: string): StandardMaterial => {
    // Card-style props pick by prop key first (their slots are generic)
    if (key.startsWith('grass')) return grassMat;
    if (key.startsWith('flower')) return flowerMat;
    // Forest-pack floor props ship one generic "MainMaterial" slot for the
    // whole mesh, so the prop key decides: deadwood is bark, plants foliage.
    if (key.startsWith('stump') || key.startsWith('log')) return barkMat;
    if (key.startsWith('fern')) return foliageMat;
    if (key.startsWith('bush_berry') || key.startsWith('bush_c')) return foliageLightMat;
    if (key.startsWith('bush_juniper')) return foliageMat;
    if (key.startsWith('cloud')) return cloudMat;
    // Conifer glbs ship trunk + foliage as two NODES sharing one needles
    // material; the SM_-prefixed node is the trunk (verified via bounds).
    // Keyed to conifers only — the old pack's single nodes are all SM_ENV_*.
    if ((CONIFER_KEYS as readonly string[]).includes(key))
      return meshName.startsWith('SM_') ? barkMat : foliageMat;
    const n = slot.toLowerCase();
    if (n.includes('wood')) return barkMat;
    if (n.includes('grass')) return grassMat;
    if (n.includes('stone')) return stoneMat;
    if (n.includes('plant')) return foliageMat;
    // Forest-pack tree slots: foliage is "*_Leavse_New" / "Leaves_For_*"
    // (conifers are a single all-needles slot); trunks are "MainMaterial",
    // "Tree" (birch) or "AspenTexture".
    if (n.includes('leav') || n.includes('leaf') || n.includes('needle')) return foliageMat;
    if (n.includes('main') || n.includes('tree') || n.includes('trunk') || n.includes('bark') || n.includes('texture'))
      return barkMat;
    return foliageLightMat;
  };

  const out = new Map<string, NatureProto>();
  await Promise.all(
    keys.map(async (key) => {
      let container;
      try {
        container = await LoadAssetContainerAsync(`models/nature/${key}.glb`, scene);
      } catch (err) {
        // Fault-tolerant by design: a flaky fetch loses ONE prop, never the
        // whole forest (a rejected Promise.all used to blank every prop).
        console.warn(`[nature] failed to load "${key}" — skipping`, err);
        return;
      }
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
        const mat = pickMat(mm.material?.name ?? '', key, mm.name);
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

function unlit(scene: Scene, name: string, color: number): StandardMaterial {
  const mt = new StandardMaterial(name, scene);
  mt.diffuseColor = new Color3(0, 0, 0);
  mt.specularColor = new Color3(0, 0, 0);
  mt.emissiveColor = c3(color);
  mt.disableLighting = true;
  mt.backFaceCulling = false;
  return mt;
}

function flat(scene: Scene, name: string, color: number): StandardMaterial {
  const mt = new StandardMaterial(name, scene);
  mt.diffuseColor = c3(color);
  mt.specularColor = new Color3(0.02, 0.02, 0.02);
  // Self-lit lift: flipped-winding normals + hemisphere shading can drive
  // these flat props nearly black (they read as dark litter on the turf), so
  // keep a fraction of the base hue emissive — stylized, never fully dark.
  mt.emissiveColor = c3(color).scale(0.22);
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
