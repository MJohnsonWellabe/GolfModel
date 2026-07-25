/**
 * The placeable asset library — one source of truth for what a designer can put
 * on a hole, and what each thing becomes in the hole's JSON.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Hole Builder could edit four things: the tee, the pin, aiTargets and
 * elevation points. Everything else on a hole — trees, water, bunkers, rocks,
 * buildings, gardens, props, landforms — had to be typed into a generator
 * script by hand, which is why the tool was, in practice, a viewer.
 *
 * The blocker was never the canvas. It was that nothing knew WHAT could be
 * placed: the asset keys live in `slice3d/natureModels.ts` (a rendering module
 * that drags Babylon in with it), the hitbox profiles in `systems/treeHitbox`,
 * the prop models in a directory, and the hazard kinds in a union type. This
 * module is the catalog that joins them, and it is deliberately Babylon-free so
 * the authoring tools can import it without pulling the engine into their
 * bundle (`tests/bundle.test.ts` enforces that).
 *
 * IT MUST NOT ROT
 * ---------------
 * A library listing a model that no longer ships is worse than no library: the
 * designer places it, the course looks right in plan view, and the hole renders
 * with a hole in it. `tests/assetLibrary.test.ts` walks the actual model
 * directories and fails when the catalog and the disk disagree in either
 * direction.
 */

/** What placing an asset produces in the hole JSON. */
export type PlacementKind =
  /** `hazards[]` entry with a generated polygon — physics + render. */
  | 'hazard'
  /** `hazards[]` entry of type 'trees' — a stand the ball collides with. */
  | 'trees'
  /** `hazards[]` entry of type 'rock' — a boulder the ball caroms off. */
  | 'rock'
  /** `props[]` entry — decorative model, no physics. */
  | 'prop'
  /** `landforms[]` entry — a major rock mass, render-only. */
  | 'landform'
  /** `gardens[]` entry — a decorative flower bed. */
  | 'garden'
  /** `elevation[]` control point — shapes the terrain. */
  | 'elevation'
  /** `aiTargets[]` — a layup waypoint. */
  | 'aiTarget';

export interface AssetDef {
  /** Stable id, unique across the library. */
  id: string;
  /** What the designer sees. */
  label: string;
  /** Category the library groups it under. */
  group: string;
  kind: PlacementKind;
  /** Model key under assets/models/<dir>/, for the kinds that name one. */
  key?: string;
  /** Where the model lives, when `key` is set. */
  dir?: 'nature' | 'props';
  /** Default footprint radius in world px, for the kinds that generate one. */
  radius?: number;
  /** One line on what it does to play — the difference between a library and a
   *  bin of filenames. */
  note?: string;
}

/** Model keys, mirrored from `slice3d/natureModels.ts`. Duplicated rather than
 *  imported because that module imports Babylon; the test keeps the two in
 *  step with the files on disk, which is the thing that actually matters. */
const BROADLEAF = ['tree_oak', 'tree_birch', 'tree_birch_b', 'tree_birch_c', 'tree_maple', 'tree_aspen', 'tree_poplar'];
const CONIFER = ['tree_spruce', 'tree_pine_k1', 'tree_pine_k3', 'tree_pine_q1', 'tree_pine_q2', 'tree_fir_a', 'tree_fir_b', 'tree_fir_c'];
const GENERIC_TREE = ['tree_a', 'tree_b', 'tree_c', 'tree_d'];
const SPECIALITY_TREE = ['tree_sakura', 'tree_palm', 'tree_palm_b', 'tree_broken', 'tree_fallen'];
const GRANITE_ROCK = ['rock_granite_a', 'rock_granite_b', 'rock_granite_c'];
const DESERT_ROCK = ['rock_desert_a', 'rock_desert_b', 'rock_desert_c', 'rock_desert_d', 'rock_desert_e', 'rock_desert_f', 'rock_desert_g', 'rock_desert_h'];
const STONE = ['stone_a', 'stone_b', 'stone_c', 'stone_d', 'stone_e', 'stone_f'];
const LANDFORM = ['canyon_red_a', 'canyon_red_b', 'rocks_red_cluster', 'dunes_sandhill', 'mesa_a', 'mesa_b', 'mesa_c'];
const BUSH = ['bush_a', 'bush_b', 'bush_c', 'bush_leafy', 'bush_bloom', 'bush_berry', 'bush_juniper', 'bush_currant', 'bush_raspberry', 'bush_forest_a', 'bush_forest_b', 'bush_wolfberry', 'bush_kenney_a', 'bush_kenney_b', 'bush_kenney_c'];
const PROPS = ['bench', 'bridge', 'bridge_stone', 'castle', 'clubhouse', 'fence', 'lighthouse', 'logcabin', 'rowboat'];

/**
 * Title-case a model key: `tree_birch_b` → "Birch B".
 *
 * The family prefix is dropped because the group heading already says it — but
 * only when something descriptive survives. `stone_a` and `tree_a` would
 * otherwise become a bare "A", and a library of chips reading A, B, C, D is a
 * list of filenames again.
 */
function labelFor(key: string): string {
  const title = (s: string): string =>
    s
      .split('_')
      .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
      .join(' ');
  const stripped = key.replace(/^(tree|rock|bush|stone|mesa|canyon|dunes|rocks)_/, '');
  return /^[a-z]$|^[a-z]?\d+$/i.test(stripped) ? title(key) : title(stripped);
}

function trees(keys: string[], group: string, note: string): AssetDef[] {
  return keys.map((key) => ({
    id: `trees:${key}`,
    label: labelFor(key),
    group,
    kind: 'trees' as const,
    key,
    dir: 'nature' as const,
    radius: 26,
    note
  }));
}

function rocks(keys: string[], group: string, note: string): AssetDef[] {
  return keys.map((key) => ({
    id: `rock:${key}`,
    label: labelFor(key),
    group,
    kind: 'rock' as const,
    key,
    dir: 'nature' as const,
    radius: 16,
    note
  }));
}

/**
 * The catalog. Ordered as a designer works: the shapes that decide how the hole
 * PLAYS first, then the things that decide how it reads.
 */
export const ASSET_LIBRARY: AssetDef[] = [
  // --- Terrain that changes the shot ---------------------------------------
  {
    id: 'hazard:water',
    label: 'Water',
    group: 'Hazards',
    kind: 'hazard',
    radius: 70,
    note: 'One-stroke penalty. Drops on the line the ball crossed.'
  },
  {
    id: 'hazard:bunker',
    label: 'Bunker',
    group: 'Hazards',
    kind: 'hazard',
    radius: 40,
    note: 'Sand: the ball plugs where it lands and never runs out.'
  },
  {
    id: 'hazard:ob',
    label: 'Out of bounds',
    group: 'Hazards',
    kind: 'hazard',
    radius: 80,
    note: 'One stroke, dropped back in bounds. The look of the ground is unchanged.'
  },
  {
    id: 'hazard:building',
    label: 'Building footprint',
    group: 'Hazards',
    kind: 'hazard',
    radius: 34,
    note: 'A solid the ball stops against.'
  },
  {
    id: 'elevation:dome',
    label: 'Mound',
    group: 'Terrain shaping',
    kind: 'elevation',
    radius: 90,
    note: 'A rounded rise. Height is in ~1.25 ft units, not yards.'
  },
  {
    id: 'elevation:hollow',
    label: 'Hollow',
    group: 'Terrain shaping',
    kind: 'elevation',
    radius: 90,
    note: 'A dome with negative height — a punchbowl or a swale.'
  },
  {
    id: 'elevation:plateau',
    label: 'Plateau',
    group: 'Terrain shaping',
    kind: 'elevation',
    radius: 110,
    note: 'A flat shelf with shoulders — a raised tee or an elevated green site.'
  },
  {
    id: 'aiTarget:layup',
    label: 'Layup target',
    group: 'Terrain shaping',
    kind: 'aiTarget',
    note: 'Where the AI aims when the pin is out of reach. Place these on the route you intend.'
  },

  // --- Trees: stands the ball collides with ---------------------------------
  ...trees(CONIFER, 'Trees · conifer', 'A stand of conifers. Narrow trunks, tall canopy — the ball stops and drops.'),
  ...trees(BROADLEAF, 'Trees · broadleaf', 'A broadleaf stand. Wider canopy, lower branches than a conifer.'),
  ...trees(GENERIC_TREE, 'Trees · generic', 'The original low-poly trees. Cheap and neutral.'),
  ...trees(SPECIALITY_TREE, 'Trees · speciality', 'Character trees — coastal palms, a sakura, deadfall.'),

  // --- Rock: the ball caroms off -------------------------------------------
  ...rocks(GRANITE_ROCK, 'Rock · granite', 'A boulder the ball bounces off at a true angle. Alpine grey.'),
  ...rocks(DESERT_ROCK, 'Rock · desert', 'A boulder the ball bounces off at a true angle. Red-rock.'),
  ...rocks(STONE, 'Rock · stones', 'Smaller stone. Still a solid carom, not scatter.'),

  // --- Render-only mass and dressing ---------------------------------------
  ...LANDFORM.map((key) => ({
    id: `landform:${key}`,
    label: labelFor(key),
    group: 'Landforms',
    kind: 'landform' as const,
    key,
    dir: 'nature' as const,
    note: 'A framing mass — canyon wall, mesa, dune. Render-only: no physics footprint.'
  })),
  ...PROPS.map((key) => ({
    id: `prop:${key}`,
    label: labelFor(key),
    group: 'Props',
    kind: 'prop' as const,
    key,
    dir: 'props' as const,
    note: 'Decorative model. Render-only — set its length to size it.'
  })),
  ...BUSH.map((key) => ({
    id: `garden:${key}`,
    label: labelFor(key),
    group: 'Gardens & shrubs',
    kind: 'garden' as const,
    key,
    dir: 'nature' as const,
    radius: 30,
    note: 'A decorative bed. No collision.'
  }))
];

export const ASSET_GROUPS: string[] = [...new Set(ASSET_LIBRARY.map((a) => a.group))];

export function assetById(id: string): AssetDef | undefined {
  return ASSET_LIBRARY.find((a) => a.id === id);
}

/** Every model file the library references, as `<dir>/<key>`. The catalog test
 *  checks these against the files that actually ship. */
export function referencedModels(): Array<{ dir: string; key: string }> {
  const out: Array<{ dir: string; key: string }> = [];
  for (const a of ASSET_LIBRARY) if (a.key && a.dir) out.push({ dir: a.dir, key: a.key });
  return out;
}

/** A regular polygon footprint — how a placed hazard/tree/rock becomes geometry
 *  the game already understands. Twelve sides reads as round at plan scale and
 *  keeps the JSON small. */
export function footprint(x: number, y: number, r: number, sides = 12): number[][] {
  const poly: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    poly.push([Math.round((x + Math.cos(a) * r) * 10) / 10, Math.round((y + Math.sin(a) * r) * 10) / 10]);
  }
  return poly;
}

/**
 * Turn a library entry dropped at a world point into the JSON it becomes.
 *
 * Returns the hole field to append to and the value to append, so the caller
 * does one generic mutation rather than a switch per asset kind — which is what
 * keeps adding a new asset a data change rather than a code change.
 */
/**
 * Props that stand up.
 *
 * The renderer has two paths: UPRIGHT keeps the model's own Y-up orientation
 * and rests its base on the ground; the other measures the extents and lays the
 * longest axis flat, which is right for a bridge span and catastrophic for a
 * bench. Everything the catalog can place is classified here rather than left
 * to a default, because getting it wrong is silent — the prop simply appears
 * upside down.
 */
const UPRIGHT_PROPS = new Set(['bench', 'fence', 'lighthouse', 'boat', 'flagpole', 'signpost', 'cart', 'shed', 'hut', 'tower', 'windmill', 'gazebo']);

export function placementFor(
  asset: AssetDef,
  x: number,
  y: number
): { field: string; value: unknown } | null {
  const rx = Math.round(x * 10) / 10;
  const ry = Math.round(y * 10) / 10;
  const r = asset.radius ?? 30;
  switch (asset.kind) {
    case 'hazard':
      return { field: 'hazards', value: { type: asset.id.split(':')[1], polygon: footprint(rx, ry, r) } };
    case 'trees':
      return { field: 'hazards', value: { type: 'trees', polygon: footprint(rx, ry, r), treeKeys: [asset.key] } };
    case 'rock':
      // A rock hazard is defined by its centre and radius; the polygon is a
      // generated octagon so generic hazard consumers never see undefined.
      return { field: 'hazards', value: { type: 'rock', cx: rx, cy: ry, r, polygon: footprint(rx, ry, r, 8) } };
    case 'prop':
      // UPRIGHT props keep their native Y-up orientation. Without the flag the
      // renderer takes the BRIDGE path, which measures the extents and lays the
      // longest axis flat — which is why a placed bench arrived on its face.
      return {
        field: 'props',
        value: { key: asset.key, x: rx, y: ry, rot: 0, len: asset.radius ?? 40, upright: UPRIGHT_PROPS.has(asset.key ?? '') }
      };
    case 'landform':
      return { field: 'landforms', value: { key: asset.key, x: rx, y: ry, h: 40 } };
    case 'garden':
      return { field: 'gardens', value: { cx: rx, cy: ry, rx: r, ry: r, flowerKeys: [asset.key] } };
    case 'elevation':
      return {
        field: 'elevation',
        value: {
          x: rx,
          y: ry,
          h: asset.id === 'elevation:hollow' ? -12 : 12,
          r,
          shape: asset.id === 'elevation:plateau' ? 'plateau' : 'dome'
        }
      };
    case 'aiTarget':
      return { field: 'aiTargets', value: { x: rx, y: ry } };
    default:
      return null;
  }
}
