// Build the tiling bunker-sand ripple texture from the purchased Unity
// terrain pack's "Desert_stones" painting — its background between the rock
// clusters is clean, stylized wind-rippled sand (the pack ships no plain sand
// map). The ground bake only reads this image's per-texel luminance detail
// re-centered on its mean (grassTexture.ts), so the tile is prepared as
// detail, not as a picture:
//
//  1. High-pass: subtract a heavy blur, re-center on mid-grey. Kills the
//     window's large soft light gradient — the thing that made naive tiling
//     (and mirror mosaics) read as an obvious kaleidoscope on screen.
//  2. Torus blend: crossfade the border zone with a half-and-half circular
//     shift of the image so the wrap edges match exactly.
//
//   npm run convert:sand
//
// Output: assets/textures/sand_ripple.jpg (512px is plenty for a tiled grain
// read at gameplay distance), preloaded/sampled like the turf grains.

import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'asset-packs', 'unity-terrain-textures', 'Desert_stones.PNG');
const OUT = path.join(root, 'assets', 'textures', 'sand_ripple.jpg');

// The one clean vertical strip between the painting's rock clusters (verified
// by eye: everything outside this window has a stone in frame).
const CROP = { left: 600, top: 555, width: 160, height: 185 };
const SIZE = 512;
/** Border crossfade width for the torus blend, in output pixels. */
const MARGIN = 64;

const base = sharp(SRC).extract(CROP).resize(SIZE, SIZE, { fit: 'fill' });
const sharpPx = await base.clone().raw().toBuffer();
const blurPx = await base.clone().blur(24).raw().toBuffer();

// 1. High-pass around mid-grey, amplified back to a healthy detail range.
const hp = Buffer.alloc(sharpPx.length);
for (let i = 0; i < sharpPx.length; i++) {
  hp[i] = Math.max(0, Math.min(255, 128 + (sharpPx[i] - blurPx[i]) * 3.5));
}

// 2. Torus blend: near the borders, crossfade into a (W/2, H/2) circular
// shift of the image — the shifted copy is continuous across the wrap, so
// the tile's edges match exactly; its own seam cross lands in the interior
// where its blend weight is ~0.
const out = Buffer.alloc(hp.length);
const C = 3;
const at = (x, y, c) => hp[(y * SIZE + x) * C + c];
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const sx = (x + SIZE / 2) % SIZE;
    const sy = (y + SIZE / 2) % SIZE;
    const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
    const a = Math.min(1, edge / MARGIN);
    for (let c = 0; c < C; c++) {
      out[(y * SIZE + x) * C + c] = at(x, y, c) * a + at(sx, sy, c) * (1 - a);
    }
  }
}

await sharp(out, { raw: { width: SIZE, height: SIZE, channels: C } })
  .jpeg({ quality: 85 })
  .toFile(OUT);
console.log('sand_ripple.jpg');
