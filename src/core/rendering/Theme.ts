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
  blossomChance: 0.22
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
    'treeKeys' | 'accentTreeKeys' | 'scatterKeys' | 'backdropTreeStep'
  >;
  for (const key of Object.keys(t) as ScalarKey[]) {
    if (!(key in spec)) continue;
    const v = spec[key];
    if (
      key === 'sunX' ||
      key === 'sunY' ||
      key === 'shadowAngle' ||
      key === 'hazeStrength' ||
      key === 'blossomChance'
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
  if (typeof spec.backdropTreeStep === 'number') t.backdropTreeStep = spec.backdropTreeStep;
  return t;
}
