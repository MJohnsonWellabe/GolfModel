import { CourseData } from '../types';

/**
 * Resolved per-course art direction: palette, sky, and light direction.
 * Courses override entries via an optional `theme` block in their JSON
 * (colors as "#rrggbb" strings); anything omitted falls back to the
 * Augusta-inspired default so older course files keep working.
 */
export interface CourseTheme {
  skyTop: number;
  skyBottom: number;
  /** Screen position of the sun in the shot view. */
  sunX: number;
  sunY: number;
  /**
   * World-space direction shadows fall TOWARD, radians. One light source
   * per course — every shadow (trees, buildings, flag, golfer) uses it.
   */
  shadowAngle: number;
  fairway: number;
  fairwayDark: number;
  rough: number;
  roughDark: number;
  fringe: number;
  green: number;
  greenLight: number;
  sand: number;
  sandDark: number;
  water: number;
  waterDeep: number;
  /** Opt in to real planar reflections on this course's ponds (Babylon
   *  MirrorTexture — tree/sky mirror). Off by default: courses without it keep
   *  the cheap RTT-free water (depth tint + specular sheen), mobile-safe. */
  waterReflect?: boolean;
  /** Reflection blend strength 0..1 for waterReflect ponds (default 0.62). */
  waterReflectStrength?: number;
  treeCanopy: number;
  treeCanopyLight: number;
  treeTrunk: number;
  /** Atmospheric haze tint + strength (0..1) near the horizon. */
  haze: number;
  hazeStrength: number;
  /** Horizon scenery: layered mountain ridges, a sea horizon with dunes, or
   *  'none' (no backdrop scenery — a dense treeline + open sky is the scenery). */
  backdrop: 'peaks' | 'sea' | 'none';
  /** Fraction of trees that bloom pink (azaleas/cherries). */
  blossomChance: number;
  /** Ground-scatter density multiplier (grass tufts/bushes/flowers); 1 = default. */
  tuftDensity: number;
  /** Rough grass-tuft height multiplier (fairway tufts stay low regardless). */
  roughTuftHeight: number;
  /** 0..1 sand sculpting: crossing rake ripples + bunker depth darkening. */
  sandSculpt: number;
  /**
   * Optional woods species mix — prop keys from slice3d/natureModels.ts
   * (e.g. conifers on Timberline, broadleaf on Wildwood). Omitted = the
   * original generic TREE_KEYS. Art-only: species never affects physics.
   */
  treeKeys?: readonly string[];
  /** Rare species mixed into ~15% of woods trees (e.g. birch among pines). */
  accentTreeKeys?: readonly string[];
  /** Extra rough-only ground scatter (ferns, stumps, logs, berry bushes). */
  scatterKeys?: readonly string[];
  /** Backdrop-woods grid step override (default 60–74); lower = denser wall. */
  backdropTreeStep?: number;
  /** Bush prop mix for the rough (defaults to the classic bush_a/bush_b). */
  bushKeys?: readonly string[];
  /** Ground grass-tuft mesh mix (defaults to GRASS_KEYS). Lets a course pull in
   *  the denser meadow-pack tufts for a lusher look without changing others. */
  grassKeys?: readonly string[];
  /** Flower mesh mix (defaults to FLOWER_KEYS). More variety = more bloom
   *  shapes; with lushGrass they also render multi-colored. */
  flowerKeys?: readonly string[];
  /** Course-wide default colorway ("#rrggbb") for hand-placed garden beds.
   *  A bed without its own `colors` inherits this, so a course with a floral
   *  identity (Wildwood's azalea pink/white) states it ONCE and every bed
   *  follows — the generic rainbow only appears where a course sets nothing
   *  (visual audit: 7 of Wildwood's beds had drifted off-palette). A bed may
   *  still override per-hole with its own `colors`. */
  gardenColors?: readonly string[];
  /** PHOTO-textured heather / links-fescue card mix planted as the dense
   *  `tallGrass` fields (links courses). Unlike grassKeys these keep their own
   *  image texture (natureModels heather path) so the fescue/heather reads real,
   *  incl. the purple heather bloom. */
  heatherKeys?: readonly string[];
  /** Native plants scattered ON exposed sand (Pinehurst-style wiregrass/bush
   *  clumps in the waste). Opt-in — undefined leaves the sand bare. */
  sandPlantKeys?: readonly string[];
  /** Waste-plant scatter grid pitch (px). Smaller = denser. Default 82. */
  sandPlantStep?: number;
  /** Fraction of waste-plant grid cells kept (0..1). Higher = denser. Default 0.5. */
  sandPlantKeep?: number;
  /** Sea backdrop dune line. Defaults on; set false for an open-ocean horizon
   *  of nothing but flat water and sky (Sable Bay). */
  seaDunes?: boolean;
  /** Line the hole-side lip of every scoring (non-waste/beach/wall) bunker
   *  with a thin band of fescue (heatherKeys, or grassKeys if unset) — a
   *  links/Pinehurst trademark: the bunker reads carved into rough, not a
   *  clean sand disc dropped onto turf. Cosmetic only. */
  bunkerLipFescue?: boolean;
  /** Lush grass: lit + two-sided grass material (self-shading, not flat) with
   *  per-tuft color variation and a taller rough cap. Undefined = flat unlit. */
  lushGrass?: boolean;
  /** Multiplier on the baked-texture edge wobble (organic fairway/rough/bunker
   *  boundaries). Default 1 = the historical subtle ripple; higher = wavier. */
  edgeWobble?: number;
  /** Multiplier on the fairway/rough mow-stripe contrast in the ground bake.
   *  Default 1 = the historical swing. Higher = bolder bands (the reference
   *  broadcast look); the green stays subtle regardless. Real-photo courses
   *  read very muted stripes without this because the turf grain damps them. */
  stripeStrength?: number;
  /** Fairway mow pattern. Unset = the historical single-direction diagonal
   *  stripe. `'checker'` = a hard-edged two-tone checkerboard (rows AND
   *  columns) aligned to the tee→pin axis; the 3D fairway grass carpet follows
   *  the same pattern so the two tones read as distinct cells, not undulation. */
  mowPattern?: 'checker';
  /** Checkerboard cell width in world units (mowPattern='checker'). Default 30
   *  — small enough that 2–3 cells span a fairway. Ignored otherwise. */
  mowTile?: number;
  /** Greens: paint straight two-tone MOWING COLUMNS (bands running in the
   *  direction of play, alternating `greenLight`/`green`) instead of the default
   *  subtle single-tone undulation — the "little design like the fairways" look.
   *  The green-complex patch and the ground bake sample the same columns so they
   *  never seam. */
  greenColumns?: boolean;
  /** Green mowing-column band width in world units (greenColumns). Default 14 —
   *  tight enough that several columns span a green. */
  greenMowTile?: number;
  /** Mesh clouds (cloud_a..c) instead of the painted billboard puffs. */
  cloudKeys?: readonly string[];
  /**
   * Cloud rendering style for the course sky. 'wispy' paints soft, feathered,
   * semi-transparent cumulus + cirrus billboards (reference-style, see-through)
   * and ignores cloudKeys. Unset falls back to mesh clouds when cloudKeys is
   * set, else the painted puff billboards. Art-only.
   */
  cloudStyle?: 'puffy' | 'wispy';
  /**
   * Real turf grain: a texture path (assets/textures/*.jpg) sampled by the
   * ground bake instead of coded procedural noise. Undefined = the original
   * coded grain(). Always paired with fairwayGrainTile/roughGrainTile.
   */
  turfGrainKey?: string;
  /** Real bump map path replacing the coded sine-wave turf normal. */
  turfNormalKey?: string;
  /** World-unit tile size for turfGrainKey on fairway (tight = short grass). */
  fairwayGrainTile?: number;
  /** World-unit tile size for turfGrainKey on rough (loose = long grass). */
  roughGrainTile?: number;
  /** Per-texel rough grain source, distinct from turfGrainKey (fairway's
   *  photo) — a genuinely different real photo, not a retint. Falls back to
   *  turfGrainKey for rough when unset. */
  roughGrainKey?: string;
  /** Real sand-ripple grain (assets/textures/*.jpg) sampled by the ground
   *  bake for bunker texels instead of the coded rake sines. */
  sandGrainKey?: string;
  /** World-unit tile size for sandGrainKey (one wind-ripple field repeat). */
  sandGrainTile?: number;
  /** Scatter a few stone props just outside each bunker's lip. */
  bunkerStones?: boolean;
  /** Warm band low on the sky dome (sunlit horizon glow). Unset = the
   *  historical 4-stop gradient, byte-identical. */
  horizonTint?: number;
  /**
   * Links tall grass (marram/fescue). When set, the rough grows sparse, tall
   * wind-grass tufts up to `cap` world units (well above the knee-high default),
   * and — with `waste` — fescue also sprouts through any `waste:true` bunker.
   * `density` scales how many tufts (0..1-ish of the base grid). Art only.
   */
  tallGrass?: { cap: number; density: number; waste?: boolean };
}

/** Augusta in April: lush, bright, warm. */
export const DEFAULT_THEME: CourseTheme = {
  skyTop: 0x4d9fd8,
  skyBottom: 0xc4e6f2,
  sunX: 560,
  sunY: 120,
  shadowAngle: Math.PI * 0.75, // sun high right — shadows fall down-left
  fairway: 0x4caf50,
  fairwayDark: 0x429a47,
  rough: 0x2e6b34,
  roughDark: 0x26582c,
  fringe: 0x66c76a,
  green: 0x7ede82,
  greenLight: 0x8fe993,
  sand: 0xe8d9a0,
  sandDark: 0xcdb87e,
  water: 0x3d7ab5,
  waterDeep: 0x2b5c8e,
  treeCanopy: 0x1e4c26,
  treeCanopyLight: 0x2b6b34,
  treeTrunk: 0x5a4632,
  haze: 0xdcecf4,
  hazeStrength: 0.5,
  backdrop: 'peaks',
  blossomChance: 0.22,
  // --- Unified premium rendering system --------------------------------------
  // Promoted from Timberline so EVERY course gets the polished look (lush grass,
  // real turf/sand grain, sculpted bunkers, two-tone striped greens, wispy sky,
  // flowers). Courses still override palette / species / backdrop / density for
  // their own identity; these are just the shared system defaults. The bake stays
  // bounded via the adaptive scale (course3d.ts), so grain-everywhere no longer
  // reintroduces the laggy hole build.
  tuftDensity: 1.2, // moderate — Timberline overrides for its forest floor. Kept
  // lean by default: ground scatter is the main steady-state instance load, and
  // an overgrown default made every course's frame pacing (and the rAF swing
  // meter) suffer on playtest devices.
  roughTuftHeight: 1.1,
  sandSculpt: 0.7,
  lushGrass: true,
  edgeWobble: 1.6,
  stripeStrength: 1.15,
  cloudStyle: 'wispy',
  bunkerStones: true,
  // The fairway mowing DIAMONDS and the greens' two-tone COLUMNS are universal
  // design language, not a per-course signature (playtest: every course should
  // have "the fairway pattern").
  mowPattern: 'checker',
  mowTile: 30,
  greenColumns: true,
  greenMowTile: 14,
  turfGrainKey: 'textures/turf_grain.jpg',
  roughGrainKey: 'textures/turf_grain_rough.jpg',
  turfNormalKey: 'textures/turf_normal.jpg',
  fairwayGrainTile: 6,
  roughGrainTile: 14,
  sandGrainKey: 'textures/sand_ripple.jpg',
  sandGrainTile: 18,
  // Genuinely-3D props by default: the Kenney blooms/bushes have real volume;
  // the meadow-pack cards (flower_a/b/c, bush_a/b) read as flat "2D blocks" at
  // gameplay distance and are no longer defaults (grass tufts stay cards but
  // only ever SHORT, where they read as ground texture).
  flowerKeys: ['flower_f', 'flower_g', 'flower_h'],
  // Rounded 3D shrubs only: bush_kenney_a (Bush_Common) + bush_kenney_c (a
  // flowering shrub). The old bush_kenney_b was a spiky agave-like plant that
  // read badly in the rough (playtest) and was dropped as a default.
  bushKeys: ['bush_kenney_a', 'bush_kenney_c'],
  // grass_i (SM_Grass_Shorts) is a DENSE ~1200-tri clump that reads as a solid
  // "block"/hay-bale — especially tinted to a golden links rough — so it was
  // dropped (playtest: "the golden asset is just a block, remove it"). grass_g/h
  // are wispy blade cards that stay ground texture.
  grassKeys: ['grass_g', 'grass_h']
};

/** Multiply a color's RGB by `f` (>1 lightens toward white, <1 darkens). */
export function shade(color: number, f: number): number {
  const ch = (c: number): number =>
    f <= 1 ? Math.round(c * f) : Math.min(255, Math.round(c + (255 - c) * (f - 1)));
  return (ch((color >> 16) & 0xff) << 16) | (ch((color >> 8) & 0xff) << 8) | ch(color & 0xff);
}

function parseColor(v: unknown, fallback: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) {
    return parseInt(v.slice(1), 16);
  }
  return fallback;
}

/** Merge a course's optional theme block over the default palette. */
export function resolveTheme(course: CourseData | null): CourseTheme {
  const spec = (course as { theme?: Record<string, unknown> } | null)?.theme;
  if (!spec) return DEFAULT_THEME;
  const t: CourseTheme = { ...DEFAULT_THEME };
  // Only the always-present scalar fields take part in the generic merge; the
  // optional array/number fields are read explicitly below.
  type ScalarKey = Exclude<
    keyof CourseTheme,
    | 'treeKeys'
    | 'accentTreeKeys'
    | 'scatterKeys'
    | 'backdropTreeStep'
    | 'bushKeys'
    | 'grassKeys'
    | 'flowerKeys'
    | 'gardenColors'
    | 'heatherKeys'
    | 'sandPlantKeys'
    | 'sandPlantStep'
    | 'sandPlantKeep'
    | 'seaDunes'
    | 'lushGrass'
    | 'edgeWobble'
    | 'stripeStrength'
    | 'mowPattern'
    | 'mowTile'
    | 'greenColumns'
    | 'greenMowTile'
    | 'cloudKeys'
    | 'cloudStyle'
    | 'turfGrainKey'
    | 'turfNormalKey'
    | 'fairwayGrainTile'
    | 'roughGrainTile'
    | 'roughGrainKey'
    | 'sandGrainKey'
    | 'sandGrainTile'
    | 'bunkerStones'
    | 'bunkerLipFescue'
    | 'horizonTint'
    | 'waterReflect'
    | 'waterReflectStrength'
    | 'tallGrass'
  >;
  for (const key of Object.keys(t) as ScalarKey[]) {
    if (!(key in spec)) continue;
    const v = spec[key];
    if (
      key === 'sunX' ||
      key === 'sunY' ||
      key === 'shadowAngle' ||
      key === 'hazeStrength' ||
      key === 'blossomChance' ||
      key === 'tuftDensity' ||
      key === 'roughTuftHeight' ||
      key === 'sandSculpt'
    ) {
      if (typeof v === 'number') t[key] = v;
    } else if (key === 'backdrop') {
      if (v === 'peaks' || v === 'sea' || v === 'none') t.backdrop = v;
    } else {
      t[key] = parseColor(v, t[key]);
    }
  }
  // Optional fields are absent from DEFAULT_THEME, so the merge loop above
  // never sees them — read them from the spec explicitly.
  const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string') ? v : undefined;
  // treeKeys is special: an explicitly authored EMPTY array means "this course
  // has NO trees" (a treeless links), distinct from omitting the key (which
  // inherits the generic species). Preserve the empty array so course3d can
  // skip both the rough scatter trees and the backdrop woods.
  t.treeKeys =
    Array.isArray(spec.treeKeys) && (spec.treeKeys as unknown[]).every((s) => typeof s === 'string')
      ? (spec.treeKeys as string[])
      : undefined;
  t.accentTreeKeys = strings(spec.accentTreeKeys);
  t.scatterKeys = strings(spec.scatterKeys);
  // bush/grass/flower keys are defaulted (unified system), so fall back to the
  // default mix when a course omits them instead of wiping to undefined.
  t.bushKeys = strings(spec.bushKeys) ?? DEFAULT_THEME.bushKeys;
  t.grassKeys = strings(spec.grassKeys) ?? DEFAULT_THEME.grassKeys;
  t.flowerKeys = strings(spec.flowerKeys) ?? DEFAULT_THEME.flowerKeys;
  t.gardenColors = strings(spec.gardenColors);
  t.heatherKeys = strings(spec.heatherKeys);
  t.sandPlantKeys = strings(spec.sandPlantKeys);
  if (typeof spec.sandPlantStep === 'number') t.sandPlantStep = spec.sandPlantStep;
  if (typeof spec.sandPlantKeep === 'number') t.sandPlantKeep = spec.sandPlantKeep;
  if (spec.seaDunes === false) t.seaDunes = false;
  t.cloudKeys = strings(spec.cloudKeys);
  if (spec.cloudStyle === 'wispy' || spec.cloudStyle === 'puffy') t.cloudStyle = spec.cloudStyle;
  if (typeof spec.lushGrass === 'boolean') t.lushGrass = spec.lushGrass;
  if (typeof spec.edgeWobble === 'number') t.edgeWobble = spec.edgeWobble;
  if (typeof spec.stripeStrength === 'number') t.stripeStrength = spec.stripeStrength;
  if (spec.mowPattern === 'checker') t.mowPattern = 'checker';
  if (typeof spec.mowTile === 'number') t.mowTile = spec.mowTile;
  if (typeof spec.greenColumns === 'boolean') t.greenColumns = spec.greenColumns;
  if (typeof spec.greenMowTile === 'number') t.greenMowTile = spec.greenMowTile;
  if (typeof spec.backdropTreeStep === 'number') t.backdropTreeStep = spec.backdropTreeStep;
  if (typeof spec.turfGrainKey === 'string') t.turfGrainKey = spec.turfGrainKey;
  if (typeof spec.turfNormalKey === 'string') t.turfNormalKey = spec.turfNormalKey;
  if (typeof spec.fairwayGrainTile === 'number') t.fairwayGrainTile = spec.fairwayGrainTile;
  if (typeof spec.roughGrainTile === 'number') t.roughGrainTile = spec.roughGrainTile;
  if (typeof spec.roughGrainKey === 'string') t.roughGrainKey = spec.roughGrainKey;
  if (typeof spec.sandGrainKey === 'string') t.sandGrainKey = spec.sandGrainKey;
  if (typeof spec.sandGrainTile === 'number') t.sandGrainTile = spec.sandGrainTile;
  if (typeof spec.bunkerStones === 'boolean') t.bunkerStones = spec.bunkerStones;
  if (typeof spec.bunkerLipFescue === 'boolean') t.bunkerLipFescue = spec.bunkerLipFescue;
  // Default the sunlit horizon band to a warm-tinted lift of this course's own
  // horizon color, so it reads right under any sky (peaks/sea/none) instead of a
  // fixed cream that only suits the parkland default.
  t.horizonTint =
    spec.horizonTint !== undefined ? parseColor(spec.horizonTint, 0xe8ddc4) : shade(t.skyBottom, 1.04);
  if (spec.waterReflect === true) t.waterReflect = true;
  if (typeof spec.waterReflectStrength === 'number') t.waterReflectStrength = spec.waterReflectStrength;
  const tg = spec.tallGrass as { cap?: unknown; density?: unknown; waste?: unknown } | undefined;
  if (tg && typeof tg.cap === 'number' && typeof tg.density === 'number') {
    t.tallGrass = { cap: tg.cap, density: tg.density, waste: tg.waste === true };
  }
  return t;
}
