// Build the tiling bunker-sand ripple texture from the purchased Unity
// terrain pack's "Desert_stones" painting — its background between the rock
// clusters is clean, stylized wind-rippled sand (the pack ships no plain sand
// map). The ground bake only reads this image's per-texel luminance detail
// re-centered on its mean (grassTexture.ts), so the tile is prepared as
// detail, not as a picture:
//
//  1. Gentle high-pass: subtract a WIDE blur, re-center on mid-grey. A wide
//     blur radius only removes the window's very-low-frequency light gradient
//     (the thing that made naive tiling read as an obvious kaleidoscope) while
//     LEAVING the soft mid-scale wind ripples intact — those are the "small
//     ripples, color variation" the art bible asks for. The old pass used a
//     tight blur + 3.5x gain, which subtracted the ripples too and amplified
//     only the finest micro-noise, so the sand read as flat grey fabric weave
//     rather than soft dunes. A wide blur + modest gain keeps it calm and sandy.
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

// A clean rock-free patch of the painting's upper-left sand, chosen by eye for
// its soft flowing wind ripples and even tone (no stone anywhere in frame).
const CROP = { left: 30, top: 300, width: 150, height: 150 };
const SIZE = 512;
/** Border crossfade width for the torus blend, in output pixels. */
const MARGIN = 64;
/** Pre-blur radius: erases the source painting's fine paint-dither micro-grid
 *  BEFORE the high-pass, so that grid isn't the thing amplified. Without it the
 *  high-pass boosts the tiny grid (a hard weave) and leaves the soft ripples
 *  faint — the sand ends up reading as grey fabric. */
const PRE_BLUR = 3;
/** High-pass blur radius: WIDE — wider than a ripple (~200px in the upscaled
 *  tile) — so only the broad light gradient is subtracted and the soft ripples
 *  survive at near-full contrast (a tight blur would subtract them too). */
const HP_BLUR = 150;
/** High-pass gain: modest, for a subtle calm grain (not a harsh weave). */
const HP_GAIN = 1.4;

// removeAlpha: the source PNG decodes as RGBA. Without dropping the (constant,
// opaque) alpha channel the high-pass below would drive it to mid-grey (128 =
// half-transparent) and the 3-channel torus blend would mis-index the RGBA
// bytes — which is exactly what flattened the old tile into grey fabric.
const base = sharp(SRC).extract(CROP).resize(SIZE, SIZE, { fit: 'fill' }).removeAlpha().blur(PRE_BLUR);
const sharpPx = await base.clone().raw().toBuffer();
const blurPx = await base.clone().blur(HP_BLUR).raw().toBuffer();

// 1. Gentle high-pass around mid-grey: keep the soft ripples, drop the gradient.
const hp = Buffer.alloc(sharpPx.length);
for (let i = 0; i < sharpPx.length; i++) {
  hp[i] = Math.max(0, Math.min(255, 128 + (sharpPx[i] - blurPx[i]) * HP_GAIN));
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
