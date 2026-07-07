import Phaser from 'phaser';
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
 * Bake the hole into a grass texture: per-texel surface classification with
 * real grain, mow stripes along the hole axis, darkened surface edges, and
 * sun-consistent baked shadows for trees and buildings. One texture powers
 * both the perspective ground mesh and the overhead view.
 *
 * Returns the texture key (cached — repeat calls for the same hole are free).
 */
export function bakeCourseTexture(
  scene: Phaser.Scene,
  courseName: string,
  hole: HoleData,
  theme: CourseTheme,
  engine: PhysicsEngine
): string {
  const key = `course-${courseName}-${hole.number}`;
  if (scene.textures.exists(key)) return key;

  const pad = TEXTURE_PAD;
  const w = hole.world.width + pad * 2;
  const h = hole.world.height + pad * 2;

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

  // Per-surface palettes as [r,g,b]
  const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const palette: Array<[number, number, number]> = [
    rgb(theme.rough),
    rgb(theme.fairway),
    rgb(theme.green),
    rgb(theme.fringe),
    rgb(theme.sand),
    rgb(theme.water),
    rgb(shade(theme.rough, 0.8)) // under trees
  ];
  // Noise strength per surface (water calm, sand soft, grass grainy)
  const noiseAmp = [26, 18, 10, 14, 12, 8, 30];

  // Mow stripes run along the tee->pin axis
  const axis = Math.atan2(hole.pin.y - hole.tee.y, hole.pin.x - hole.tee.x);
  const ax = Math.cos(axis);
  const ay = Math.sin(axis);
  const STRIPE = 42;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const data = img.data;

  for (let py = 0; py < h; py++) {
    const wy = py - pad;
    for (let px = 0; px < w; px++) {
      const wx = px - pad;
      // Jittered class lookup = organic (dithered) surface edges
      const jx = wx + (texelHash(px + 7, py) - 0.5) * 3;
      const jy = wy + (texelHash(px, py + 7) - 0.5) * 3;
      const cls = classAt(jx, jy);
      const [r, g, b] = palette[cls];

      let light = 1 + (grain(px, py) - 0.5) * (noiseAmp[cls] / 128);
      // Stripes on mown surfaces (fairway, green, fringe)
      if (cls === 1 || cls === 2 || cls === 3) {
        const along = wx * ax + wy * ay;
        light *= 1 + Math.sin((along / STRIPE) * Math.PI) * 0.04;
      }
      // Edge darkening where the surface changes just ahead
      if (classAt(wx + 3, wy) !== cls || classAt(wx, wy + 3) !== cls) light *= 0.86;
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
    ctx.ellipse(t.x + pad + lean * t.r * 0.75, t.y + pad + 2, t.r * 1.15, t.r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(10, 24, 12, 0.28)';
  for (const hz of hole.hazards) {
    if (hz.type !== 'building') continue;
    ctx.beginPath();
    hz.polygon.forEach(([x, y], i) => {
      const sx = x + pad + lean * 12;
      const sy = y + pad + 6;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.fill();
  }

  const tex = scene.textures.addCanvas(key, canvas);
  tex?.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return key;
}
