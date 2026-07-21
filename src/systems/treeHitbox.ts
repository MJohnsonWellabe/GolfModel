import { hash2 } from './treeField';

/**
 * Per-ASSET tree collision geometry (owner: "every tree asset needs its own
 * hitbox style and size … match the height and width at the trunk and canopy
 * separately for each asset … keep the hit boxes slim and defined to match the
 * shape of the asset"). Babylon-independent DATA so the headless physics/sim and
 * the live game agree — the renderer picks a species per trunk from the theme's
 * key set (course3d.plantTree), and PhysicsEngine reproduces the SAME pick
 * (pickSpeciesKey) to size that trunk's hitbox.
 *
 * All multipliers are relative to the authored canopy radius `r` (the same value
 * that drives the drawn canopy + baked shadow), and the tree's height is derived
 * the way course3d sizes the mesh (`r * heightMul`). Radii are deliberately
 * skewed a touch UNDER the drawn canopy so a ball that visually misses never
 * "phantom" collides — better a graze slips through than a clear miss stops.
 */
export interface TreeHitbox {
  /** Tree height = r * heightMul (matches course3d's mesh sizing). */
  heightMul: number;
  /** Canopy hitbox radius = r * canopyRadMul (≲ the drawn canopy). */
  canopyRadMul: number;
  /** Canopy starts at height * canopyBottomFrac; below is bare trunk. */
  canopyBottomFrac: number;
  /** Trunk radius = r * trunkRadMul (slim). */
  trunkRadMul: number;
  /** Canopy tapers to a point up top (conifer cone) vs a rounded broadleaf ball. */
  cone: boolean;
}

// Build a profile from the MEASURED model (scripts headlessly loaded each GLB
// and measured, per species: total height / canopy radius = `aspect`, and where
// the foliage starts as a fraction of height = `canopyBottomFrac`). The rendered
// canopy WIDTH is `r * heightMul / aspect` — so the hitbox canopy radius is that,
// skewed ×0.9 UNDER the drawn canopy (and capped at r) so a graze at the very
// edge slips through rather than phantom-stopping. Trunk is a thin pole.
const SKEW = 0.9;
function prof(heightMul: number, aspect: number, canopyBottomFrac: number, cone: boolean): TreeHitbox {
  const canopyRadMul = Math.min(1, (heightMul / aspect) * SKEW);
  return { heightMul, canopyRadMul, canopyBottomFrac, trunkRadMul: Math.max(0.05, canopyRadMul * 0.18), cone };
}

/** Default species mix for themes without an explicit treeKeys — the quality
 *  forest-pack broadleafs. Single source of truth shared by the renderer
 *  (course3d) and the collision species pick, so both resolve identically. */
export const DEFAULT_TREE_MIX = ['tree_oak', 'tree_maple', 'tree_birch', 'tree_aspen'] as const;

/** Per-asset geometry, MEASURED from each model's GLB (aspect = height/canopy
 *  radius, and where the foliage begins). Keyed by the exact asset key so every
 *  species carries its own silhouette (owner: "every tree asset needs its own
 *  hitbox style and size … match the height and width at the trunk and canopy
 *  separately for each asset"). Every natureModels tree key has an entry
 *  (asserted by tests/unit/treeHitbox.test.ts). heightMul mirrors course3d's
 *  mesh sizing (broadleaf 2.0, conifer 2.6, sakura 1.9); `cone` = conifers,
 *  whose canopy tapers to a point. */
export const TREE_HITBOX: Record<string, TreeHitbox> = {
  // generic low-poly broadleafs (retired from placement but kept for safety)
  tree_a: prof(2.0, 2.47, 0.44, false),
  tree_b: prof(2.0, 2.34, 0.45, false),
  tree_c: prof(2.0, 2.35, 0.27, false),
  tree_d: prof(2.0, 4.94, 0.18, false),
  // forest-pack broadleafs
  tree_oak: prof(2.0, 1.89, 0.25, false),
  tree_birch: prof(2.0, 3.91, 0.25, false),
  tree_birch_b: prof(2.0, 2.7, 0.1, false),
  tree_birch_c: prof(2.0, 4.12, 0.44, false),
  tree_maple: prof(2.0, 3.38, 0.3, false),
  tree_aspen: prof(2.0, 4.34, 0.23, false),
  tree_poplar: prof(2.0, 6.77, 0.18, false),
  // cherry blossom — wide, low-slung canopy
  tree_sakura: prof(1.9, 1.55, 0.1, false),
  // conifers — narrow tapering cones starting low on a thin trunk
  tree_fir_a: prof(2.6, 4.72, 0.33, true),
  tree_fir_b: prof(2.6, 5.05, 0.46, true),
  tree_fir_c: prof(2.6, 3.97, 0.18, true),
  tree_spruce: prof(2.6, 4.22, 0.18, true),
  tree_pine_k1: prof(2.6, 4.57, 0.33, true),
  // bare-trunk pine ("bare trunk to the top") — canopy only near the crown
  tree_pine_k3: prof(2.6, 4.91, 0.46, true),
  // palms (isPalm path owns their real trunk+frond geometry)
  tree_palm: prof(2.0, 4.41, 0.58, false),
  tree_palm_b: prof(2.0, 4.26, 0.6, false)
};

// Fallback for any trunk with no species pick (a landform tree, an unknown key):
// a generic mid-size broadleaf.
export const DEFAULT_HITBOX = prof(2.0, 3.0, 0.3, false);

/** The hitbox profile for an asset key (broadleaf fallback for anything not in
 *  the table — a landform tree with no species pick, say). */
export function resolveTreeHitbox(key: string | undefined): TreeHitbox {
  return (key && TREE_HITBOX[key]) || DEFAULT_HITBOX;
}

/** The concrete trunk species key a trunk at (x,y) renders as — a byte-for-byte
 *  mirror of course3d.plantTree's pick, so the hitbox matches the drawn tree.
 *  `accent` forces the accent set (deliberate specimens); otherwise a per-trunk
 *  hash rolls the accent chance. Returns '' when no keys are available. */
export function pickSpeciesKey(
  x: number,
  y: number,
  trees: readonly string[],
  accents: readonly string[],
  accentChance: number | undefined,
  accent: boolean | undefined
): string {
  const roll = accentChance ?? 0.15;
  const set = accents.length && (accent || hash2(x * 1.7, y * 0.9) < roll) ? accents : trees;
  if (!set.length) return '';
  return set[Math.floor(hash2(x, y) * set.length) % set.length];
}
