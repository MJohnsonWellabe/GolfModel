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
  hazeStrength: 0.5
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
  for (const key of Object.keys(t) as Array<keyof CourseTheme>) {
    if (!(key in spec)) continue;
    const v = spec[key];
    if (key === 'sunX' || key === 'sunY' || key === 'shadowAngle' || key === 'hazeStrength') {
      if (typeof v === 'number') t[key] = v;
    } else {
      t[key] = parseColor(v, t[key]);
    }
  }
  return t;
}
