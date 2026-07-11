import '@babylonjs/loaders/glTF';
import {
  Color3,
  LoadAssetContainerAsync,
  Mesh,
  Scene,
  StandardMaterial,
  VertexBuffer,
  VertexData
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
export const EXTRA_BUSH_KEYS = ['bush_juniper', 'bush_c', 'bush_currant', 'bush_raspberry'] as const;
/** Stylized volumetric cloud meshes; courses opt in via theme.cloudKeys. */
export const CLOUD_KEYS = [
  'cloud_a',
  'cloud_b',
  'cloud_c',
  'cloud_d',
  'cloud_e',
  'cloud_f',
  'cloud_g',
  'cloud_h',
  'cloud_i'
] as const;
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
  /** Lush grass: build a LIT, two-sided grass material (self-shading, catches
   *  the sun) instead of the flat unlit one, and register a per-instance color
   *  buffer on the grass prototypes so tufts can be tinted individually. */
  grassLit?: boolean;
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
  // Bushes and ferns are crossed/low-poly cards too. On a lush course give them
  // the same LIT, two-sided treatment grass and flowers get (twoSidedLighting +
  // emissive floor) so they self-shade and catch the sun as rounded 3D volumes
  // instead of reading as flat single-lit slabs. Non-lush courses keep the plain
  // flat material, so their look is unchanged. Trees keep foliageMat (their big
  // canopies already read as volumes and drive baked shadows).
  const bushMat = palette.grassLit ? litGrass(scene, 'natBushLit', palette.foliage) : foliageMat;
  const bushLightMat = palette.grassLit ? litGrass(scene, 'natBushLLit', palette.foliageLight) : foliageLightMat;
  const fernMat = palette.grassLit ? litGrass(scene, 'natFernLit', palette.foliage) : foliageMat;
  // Flower stems/leaves stay green while the petals take the per-instance hue:
  // each flower prototype is split by height (see splitFlowerByHeight) into a
  // green stem part (this material) and a tintable petal part (flowerMat).
  const stemMat = palette.grassLit ? litGrass(scene, 'natStem', 0x4c8f3a) : flat(scene, 'natStem', 0x4c8f3a);
  // Grass tufts and flowers are crossed flat cards — plain lit shading turns the
  // back-facing half black, so by default render them unlit in flat palette
  // colors. When grassLit, grass instead uses a LIT, two-sided material
  // (twoSidedLighting lights the back cards too, so they don't go black) with a
  // green emissive floor — the tufts self-shade and catch the sun for depth
  // rather than reading as one flat silhouette.
  const grassMat = palette.grassLit ? litGrass(scene, 'natGrass', palette.grass) : unlit(scene, 'natGrass', palette.grass);
  // Lush flowers: a light, two-sided lit material so each bloom's per-instance
  // color shows as a true hue (the color buffer multiplies this near-white base)
  // — otherwise flowers are one flat unlit pink.
  const flowerMat = palette.grassLit ? litGrass(scene, 'natFlower', 0xf2ebe6) : unlit(scene, 'natFlower', 0xe8a8c8);
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
    if (key.startsWith('fern')) return fernMat;
    // Berry-type bushes (blackberry/currant/raspberry) read lighter, like the
    // fruit rows they are; the plain shrubs stay deep foliage green.
    if (key.startsWith('bush_berry') || key.startsWith('bush_c') || key.startsWith('bush_currant') || key.startsWith('bush_raspberry'))
      return bushLightMat;
    if (key.startsWith('bush')) return bushMat;
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

  // Same hardening as the golfer character load (golfer3d.ts): a stalled
  // fetch (never settles) is treated as a failure via a timeout, and one
  // failure gets a single retry before the prop is given up on. Without
  // this, a single flaky or hung fetch permanently dropped that prop for
  // the whole session with only a console.warn no player would ever see.
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`load timed out after ${ms}ms`)), ms))
    ]);
  const loadContainer = (key: string) => withTimeout(LoadAssetContainerAsync(`models/nature/${key}.glb`, scene), 15000);

  const out = new Map<string, NatureProto>();
  await Promise.all(
    keys.map(async (key) => {
      let container;
      try {
        container = await loadContainer(key).catch(() => loadContainer(key));
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
      const isFlower = key.startsWith('flower');
      for (const group of byMat.values()) {
        const merged = Mesh.MergeMeshes(group, true, true, undefined, false, false);
        if (!merged) continue;
        merged.refreshBoundingInfo();
        const bb = merged.getBoundingInfo().boundingBox;
        minY = Math.min(minY, bb.minimum.y);
        maxY = Math.max(maxY, bb.maximum.y);
        // Flowers split into a green stem (lower ~40%) + tintable petals (upper)
        // so a per-instance hue colors only the bloom, not the whole plant.
        const pieces = isFlower ? splitFlowerByHeight(merged, scene, stemMat, 0.42) : [merged];
        pieces.forEach((p, i) => {
          p.name = `natProto-${key}-${p.material?.name ?? 'm'}${isFlower ? `-${i}` : ''}`;
          p.isPickable = false;
          // Park below ground (kept enabled — Babylon only draws an instanced
          // mesh's instances while its source mesh is enabled).
          p.position.y = -9000;
          parts.push(p);
        });
      }
      if (parts.length) out.set(key, { parts, height: maxY - minY || 1 });
    })
  );
  // Per-instance color variation needs a 'color' instanced buffer on each
  // prototype mesh before any instance is created (course3d sets each instance's
  // .instancedBuffers.color). Register once here when lush — grass/flowers get
  // varied hues, bushes a subtle green variance so scatter stops reading flat.
  // For split flowers only the PETAL part (material === flowerMat) is tintable;
  // the green stem part keeps stemMat and is left untinted.
  if (palette.grassLit) {
    for (const [key, proto] of out) {
      if (!(key.startsWith('grass') || key.startsWith('flower') || key.startsWith('bush'))) continue;
      for (const part of proto.parts) {
        if (key.startsWith('flower') && part.material?.name !== flowerMat.name) continue;
        part.registerInstancedBuffer('color', 4);
        (part as Mesh & { tintable?: boolean }).tintable = true;
      }
    }
  }
  return out;
}

/**
 * Split a merged flower mesh into a green STEM part (lower triangles) and a
 * tintable PETAL part (upper triangles), by triangle-centroid height. The
 * petal part keeps the source (flower) material so a per-instance color tints
 * only the bloom; the stem part gets stemMat and stays green. Both parts share
 * the full vertex range, so scaling/height are unchanged. Returns [merged] if
 * the geometry can't be read (falls back to the old whole-plant behavior).
 */
function splitFlowerByHeight(src: Mesh, scene: Scene, stemMat: StandardMaterial, frac: number): Mesh[] {
  const pos = src.getVerticesData(VertexBuffer.PositionKind);
  const nor = src.getVerticesData(VertexBuffer.NormalKind);
  const idx = src.getIndices();
  const petalMat = src.material;
  if (!pos || !idx || !petalMat) return [src];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 1; i < pos.length; i += 3) {
    if (pos[i] < lo) lo = pos[i];
    if (pos[i] > hi) hi = pos[i];
  }
  const thr = lo + frac * (hi - lo);
  const stemIdx: number[] = [];
  const petalIdx: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
    (cy > thr ? petalIdx : stemIdx).push(a, b, c);
  }
  if (!stemIdx.length || !petalIdx.length) return [src]; // all one side — leave whole
  const make = (indices: number[], mat: StandardMaterial | typeof petalMat): Mesh => {
    const m = new Mesh('flowerPart', scene);
    const vd = new VertexData();
    vd.positions = pos;
    if (nor) vd.normals = nor;
    vd.indices = indices;
    vd.applyToMesh(m);
    m.material = mat;
    m.refreshBoundingInfo();
    return m;
  };
  const stem = make(stemIdx, stemMat);
  const petal = make(petalIdx, petalMat);
  src.dispose();
  return [stem, petal];
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

/** Lit, two-sided grass material: catches the sun and self-shades (unlike the
 *  flat unlit tuft), with a green emissive floor so shaded/back faces of the
 *  crossed cards stay green instead of going black. */
function litGrass(scene: Scene, name: string, color: number): StandardMaterial {
  const mt = new StandardMaterial(name, scene);
  mt.diffuseColor = c3(color);
  mt.specularColor = new Color3(0, 0, 0);
  mt.emissiveColor = c3(color).scale(0.32);
  mt.backFaceCulling = false;
  mt.twoSidedLighting = true;
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
