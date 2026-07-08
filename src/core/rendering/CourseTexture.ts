import { PhysicsEngine } from '../../systems/PhysicsEngine';
import { pointInPolygon } from '../../utils/Geometry';
import { HoleData, Surface } from '../types';
import { CourseTheme, shade } from './Theme';

/** World-px padding baked around the hole so the horizon never shows seams. */
export const TEXTURE_PAD = 220;

export interface TreeBlob {
  x: number;
  y: number;
  r: number;
  /** 0 = round oak, 1 = tall poplar, 2 = wide double-crown, 3 = blossom. */
  kind: number;
  /** Per-tree canopy tint multiplier. */
  tint: number;
}

/** Half-size (world px) of the square tee pad baked around each tee marker. */
export const TEE_HALF = 42;

/**
 * True when (x,y) lies on the hole's tee pad — a square patch aligned to the
 * tee→pin axis, centred just behind the tee marker so the ball rests at its
 * front edge. Shared by the texture bake (paints the pad) and the 3D ground
 * scatter (keeps tall grass off it) so both agree on the shape.
 */
export function inTeePad(hole: HoleData, x: number, y: number): boolean {
  const axis = Math.atan2(hole.pin.y - hole.tee.y, hole.pin.x - hole.tee.x);
  const ax = Math.cos(axis);
  const ay = Math.sin(axis);
  const cx = hole.tee.x - ax * TEE_HALF * 0.55;
  const cy = hole.tee.y - ay * TEE_HALF * 0.55;
  const along = (x - cx) * ax + (y - cy) * ay;
  const perp = -(x - cx) * ay + (y - cy) * ax;
  return Math.abs(along) <= TEE_HALF && Math.abs(perp) <= TEE_HALF;
}

/** Deterministic 0..1 jitter shared by the texture bake and the tree billboards. */
export function blobHash(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** The tree positions for a hole — one source for billboards AND baked shadows. */
export function collectTreeBlobs(hole: HoleData, blossomChance = 0): TreeBlob[] {
  const blobs: TreeBlob[] = [];
  for (const hz of hole.hazards) {
    if (hz.type !== 'trees') continue;
    const xs = hz.polygon.map((p) => p[0]);
    const ys = hz.polygon.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    for (let yy = minY; yy < maxY; yy += 52) {
      for (let xx = minX; xx < maxX; xx += 52) {
        const jx = xx + (blobHash(xx, yy) - 0.5) * 36;
        const jy = yy + (blobHash(yy, xx) - 0.5) * 36;
        if (!pointInPolygon(jx, jy, hz.polygon)) continue;
        const k = blobHash(xx + 31, yy + 17);
        blobs.push({
          x: jx,
          y: jy,
          r: 15 + blobHash(xx + 7, yy + 3) * 12,
          kind: k < blossomChance ? 3 : Math.floor((k - blossomChance) / (1 - blossomChance) * 3),
          tint: 0.82 + blobHash(xx + 3, yy + 11) * 0.32
        });
      }
    }
  }
  return blobs;
}

/** Fast integer hash → 0..1 (cheap enough for millions of texels). */
function texelHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

/** Two-octave value noise on the integer lattice (no interpolation — grain). */
function grain(x: number, y: number): number {
  return texelHash(x, y) * 0.65 + texelHash(x >> 2, y >> 2) * 0.35;
}

const SURFACE_ID: Record<Surface, number> = {
  rough: 0,
  fairway: 1,
  green: 2,
  fringe: 3,
  sand: 4,
  water: 5,
  trees: 6,
  tee: 1
};

/**
 * Render the hole into a grass canvas: per-texel surface classification with
 * real grain, mow stripes along the hole axis, darkened surface edges, and
 * sun-consistent baked shadows for trees and buildings. Engine-agnostic —
 * the Babylon course renderer uploads it as a terrain albedo (course3d.ts).
 */
export function renderCourseCanvas(
  hole: HoleData,
  theme: CourseTheme,
  engine: PhysicsEngine,
  scale = 1
): HTMLCanvasElement {
  const pad = TEXTURE_PAD;
  const w = Math.round((hole.world.width + pad * 2) * scale);
  const h = Math.round((hole.world.height + pad * 2) * scale);

  // Coarse classification grid (2 world px per cell) — the expensive pass
  const step = 2;
  const gw = Math.ceil(w / step);
  const gh = Math.ceil(h / step);
  const grid = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      grid[gy * gw + gx] =
        SURFACE_ID[engine.surfaceAt(gx * step - pad, gy * step - pad)];
    }
  }
  const classAt = (x: number, y: number): number => {
    const gx = Math.max(0, Math.min(gw - 1, ((x + pad) / step) | 0));
    const gy = Math.max(0, Math.min(gh - 1, ((y + pad) / step) | 0));
    return grid[gy * gw + gx];
  };

  // Per-surface base color as [r,g,b]. Green uses the BRIGHT tone as its base
  // so putting surfaces clearly read as the lightest, shortest grass.
  const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  // Index 7 = tee box: a mown pad, lighter than rough (close to fairway but a
  // touch brighter) so it clearly reads as the lightest cut off the fairway.
  const palette: Array<[number, number, number]> = [
    rgb(theme.rough),
    rgb(theme.fairway),
    rgb(theme.greenLight),
    rgb(theme.fringe),
    rgb(theme.sand),
    rgb(theme.water),
    rgb(shade(theme.rough, 0.8)), // under trees
    rgb(shade(theme.fairway, 1.1)) // tee box — light, short, clean
  ];
  // Mow-band alternate tone per surface — the stripe lerps base↔alt for a real
  // two-tone mow pattern (the dark/light theme fields were previously unused).
  // null = no stripes (sand/water/trees).
  const stripeAlt: Array<[number, number, number] | null> = [
    rgb(theme.roughDark), // 0 rough  — broad, faint banding
    rgb(theme.fairwayDark), // 1 fairway — clear mow stripes
    rgb(theme.green), // 2 green   — bright base ↔ mid green
    rgb(shade(theme.fringe, 0.88)), // 3 fringe
    null,
    null,
    null,
    rgb(theme.fairway) // 7 tee — light base ↔ fairway for tight cross-stripes
  ];
  const stripeLen = [92, 42, 34, 42, 0, 0, 0, 26]; // rough broad; green/tee tightest
  const stripeAmt = [0.16, 0.34, 0.3, 0.28, 0, 0, 0, 0.24]; // base↔alt blend strength
  // Noise strength per surface — rough much grainier (long grass), green/tee smooth.
  const noiseAmp = [36, 18, 7, 13, 12, 8, 30, 8];

  // Mow stripes: greens/fringe run along the tee->pin axis; the FAIRWAY is
  // mown on a diagonal (45° to the axis) for the classic striped look.
  const axis = Math.atan2(hole.pin.y - hole.tee.y, hole.pin.x - hole.tee.x);
  const ax = Math.cos(axis);
  const ay = Math.sin(axis);
  const dax = Math.cos(axis + Math.PI / 4);
  const day = Math.sin(axis + Math.PI / 4);
  // Tee-pad centre (see inTeePad) precomputed so the hot texel loop stays cheap.
  const tcx = hole.tee.x - ax * TEE_HALF * 0.55;
  const tcy = hole.tee.y - ay * TEE_HALF * 0.55;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const data = img.data;

  for (let py = 0; py < h; py++) {
    const wy = py / scale - pad;
    for (let px = 0; px < w; px++) {
      const wx = px / scale - pad;
      // Displace the class lookup by a SMOOTH low-frequency wobble (organic,
      // gently curved surface edges — soft-rounded fairways rather than hard
      // rectangles) plus a little white-noise grain to keep the boundary from
      // reading as a clean sine. Texture-only: gameplay polygons stay crisp.
      const wobX =
        Math.sin(wx * 0.019 + wy * 0.011) * 5 +
        Math.sin(wy * 0.034 - wx * 0.014) * 3 +
        (texelHash(px + 7, py) - 0.5) * 3;
      const wobY =
        Math.sin(wy * 0.018 - wx * 0.010) * 5 +
        Math.sin(wx * 0.032 + wy * 0.015) * 3 +
        (texelHash(px, py + 7) - 0.5) * 3;
      const jx = wx + wobX;
      const jy = wy + wobY;
      let cls = classAt(jx, jy);
      // Tee pad overrides ground surfaces only (never sand/water/trees/green),
      // tested on crisp (un-jittered) coords for a sharp square edge.
      if (cls === 0 || cls === 1) {
        const along = (wx - tcx) * ax + (wy - tcy) * ay;
        const perp = -(wx - tcx) * ay + (wy - tcy) * ax;
        if (Math.abs(along) <= TEE_HALF && Math.abs(perp) <= TEE_HALF) cls = 7;
      }
      let [r, g, b] = palette[cls];

      // Two-tone mow bands: lerp base→alt across the stripe (real color shift).
      const alt = stripeAlt[cls];
      if (alt) {
        // Fairway (cls 1) stripes diagonally; greens/fringe along the axis.
        const along = cls === 1 ? wx * dax + wy * day : wx * ax + wy * ay;
        const t = ((Math.sin((along / stripeLen[cls]) * Math.PI) + 1) / 2) * stripeAmt[cls];
        r += (alt[0] - r) * t;
        g += (alt[1] - g) * t;
        b += (alt[2] - b) * t;
      }

      let light = 1 + (grain(px, py) - 0.5) * (noiseAmp[cls] / 128);
      // Edge darkening where the surface changes just ahead (crisper boundaries)
      if (classAt(wx + 3, wy) !== cls || classAt(wx, wy + 3) !== cls) light *= 0.82;
      // Water: subtle horizontal banding reads as ripples
      if (cls === 5) light *= 1 + Math.sin(wy * 0.18) * 0.045;

      const i = (py * w + px) * 4;
      data[i] = Math.min(255, r * light);
      data[i + 1] = Math.min(255, g * light);
      data[i + 2] = Math.min(255, b * light);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Baked ground shadows (sun-consistent): trees, then buildings
  const lean = theme.sunX > 360 ? -1 : 1;
  ctx.fillStyle = 'rgba(10, 24, 12, 0.30)';
  for (const t of collectTreeBlobs(hole)) {
    ctx.beginPath();
    ctx.ellipse(
      (t.x + pad + lean * t.r * 0.75) * scale,
      (t.y + pad + 2) * scale,
      t.r * 1.15 * scale,
      t.r * 0.5 * scale,
      0, 0, Math.PI * 2
    );
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(10, 24, 12, 0.28)';
  for (const hz of hole.hazards) {
    if (hz.type !== 'building') continue;
    ctx.beginPath();
    hz.polygon.forEach(([x, y], i) => {
      const sx = (x + pad + lean * 12) * scale;
      const sy = (y + pad + 6) * scale;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.fill();
  }

  return canvas;
}
