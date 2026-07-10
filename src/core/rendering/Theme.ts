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
  treeCanopy: number;
  treeCanopyLight: number;
  treeTrunk: number;
  /** Atmospheric haze tint + strength (0..1) near the horizon. */
  haze: number;
  hazeStrength: number;
  /** Horizon scenery: layered mountain ridges or a sea horizon with dunes. */
  backdrop: 'peaks' | 'sea';
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
  /** Mesh clouds (cloud_a..c) instead of the painted billboard puffs. */
  cloudKeys?: readonly string[];
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
  tuftDensity: 1,
  roughTuftHeight: 1,
  sandSculpt: 0
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
    | 'lushGrass'
    | 'edgeWobble'
    | 'stripeStrength'
    | 'mowPattern'
    | 'mowTile'
    | 'cloudKeys'
    | 'turfGrainKey'
    | 'turfNormalKey'
    | 'fairwayGrainTile'
    | 'roughGrainTile'
    | 'roughGrainKey'
    | 'sandGrainKey'
    | 'sandGrainTile'
    | 'bunkerStones'
    | 'horizonTint'
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
      if (v === 'peaks' || v === 'sea') t.backdrop = v;
    } else {
      t[key] = parseColor(v, t[key]);
    }
  }
  // Optional fields are absent from DEFAULT_THEME, so the merge loop above
  // never sees them — read them from the spec explicitly.
  const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string') ? v : undefined;
  t.treeKeys = strings(spec.treeKeys);
  t.accentTreeKeys = strings(spec.accentTreeKeys);
  t.scatterKeys = strings(spec.scatterKeys);
  t.bushKeys = strings(spec.bushKeys);
  t.grassKeys = strings(spec.grassKeys);
  t.flowerKeys = strings(spec.flowerKeys);
  t.cloudKeys = strings(spec.cloudKeys);
  if (spec.lushGrass === true) t.lushGrass = true;
  if (typeof spec.edgeWobble === 'number') t.edgeWobble = spec.edgeWobble;
  if (typeof spec.stripeStrength === 'number') t.stripeStrength = spec.stripeStrength;
  if (spec.mowPattern === 'checker') t.mowPattern = 'checker';
  if (typeof spec.mowTile === 'number') t.mowTile = spec.mowTile;
  if (typeof spec.backdropTreeStep === 'number') t.backdropTreeStep = spec.backdropTreeStep;
  if (typeof spec.turfGrainKey === 'string') t.turfGrainKey = spec.turfGrainKey;
  if (typeof spec.turfNormalKey === 'string') t.turfNormalKey = spec.turfNormalKey;
  if (typeof spec.fairwayGrainTile === 'number') t.fairwayGrainTile = spec.fairwayGrainTile;
  if (typeof spec.roughGrainTile === 'number') t.roughGrainTile = spec.roughGrainTile;
  if (typeof spec.roughGrainKey === 'string') t.roughGrainKey = spec.roughGrainKey;
  if (typeof spec.sandGrainKey === 'string') t.sandGrainKey = spec.sandGrainKey;
  if (typeof spec.sandGrainTile === 'number') t.sandGrainTile = spec.sandGrainTile;
  if (spec.bunkerStones === true) t.bunkerStones = true;
  if (spec.horizonTint !== undefined) t.horizonTint = parseColor(spec.horizonTint, 0xe8ddc4);
  return t;
}
