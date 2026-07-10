/**
 * Real-asset turf grain: the baked ground texture (CourseTexture.ts) samples
 * this instead of coded procedural noise, when a course's theme opts in
 * (turfGrainKey / roughGrainKey). The bake itself is synchronous (runs at
 * hole-build time), so each source image must be decoded into a plain pixel
 * array BEFORE that — preloadGrassGrain() is fired once per key at app boot
 * (main.ts), well before any round can start. If a hole builds before a key
 * resolves, the synchronous getter returns null and CourseTexture falls back
 * to the coded grain() noise for that one bake — never blocks, never throws.
 *
 * Keyed so fairway and rough can each read a genuinely different real photo
 * (not the same image reused/retinted) — see roughGrainKey in Theme.ts.
 */

interface GrainSampler {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const cache = new Map<string, GrainSampler>();
const inflight = new Map<string, Promise<void>>();

/** Decode a turf texture (assets/textures/*.jpg) into a sampleable pixel buffer. */
async function decode(key: string): Promise<GrainSampler> {
  const img = new Image();
  img.src = key;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data };
}

/** Fire-and-forget preload; call once per key at app boot. Never throws. */
export function preloadGrassGrain(key: string): void {
  if (cache.has(key) || inflight.has(key)) return;
  const p = decode(key)
    .then((s) => {
      cache.set(key, s);
    })
    .catch((err) => {
      console.warn(`[grassTexture] failed to preload turf grain "${key}", using procedural noise:`, err);
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
}

/**
 * Sample a preloaded turf grain at a tiled world coordinate, returning 0..1
 * luminance (same range/shape as CourseTexture's coded `grain()`). `tile` is
 * the world-unit size of one texture repeat. Returns null if `key` hasn't
 * decoded yet (or was never preloaded) — callers fall back to procedural
 * noise.
 */
export function sampleGrassGrain(key: string, wx: number, wy: number, tile: number): number | null {
  const sampler = cache.get(key);
  if (!sampler) return null;
  const { width, height, data } = sampler;
  const u = (((wx / tile) % 1) + 1) % 1;
  const v = (((wy / tile) % 1) + 1) % 1;
  const px = Math.min(width - 1, (u * width) | 0);
  const py = Math.min(height - 1, (v * height) | 0);
  const i = (py * width + px) * 4;
  // Luminance, normalized like the coded grain(): mean ~0.5 across the tile.
  return (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
}
