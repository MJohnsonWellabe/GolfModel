/**
 * CLOUD BILLBOARD ALPHAS, from a CC0 pack — white, not smoke.
 *
 * Why this script exists at all, in order:
 *
 *  1. Stage 6 gave every course a painted sky measured off a Poly Haven HDRI.
 *     The DOME ramps were a success and are untouched by any of this — the
 *     owner: "I'm liking the color changes on the sky so they look unique."
 *  2. The CLOUDS came out of the same photographs, cut out of the equirect and
 *     posterised. That failed on every source we tried, and it failed
 *     differently each time: a smooth ellipse with a lens in the middle (Sable
 *     Bay's soap bubbles), a torn scrap with rectangular blocks in it
 *     (Wildwood), a grey smear (Timberline). "The clouds look bad."
 *  3. So: real cloud art. `fx_cloudalphas` (WickedInsignia, OpenGameArt, CC0)
 *     is ten 2048² cloud alphas with genuine soft silhouettes — the detail a
 *     posterise can never produce. The owner picked them on sight.
 *  4. But they are VFX plumes: grey-brown RGB, meant to be smoke. "Just make
 *     the clouds whiter instead of grey smoke."
 *
 * So this keeps ONLY THE ALPHA and throws the photograph's colour away. What
 * ships is a white silhouette; `course3d.ts` tints it per course at build time
 * (lit toward that course's own `sunTint`, shaded toward its own sky and haze),
 * which is how the clouds stay unique per course without a photograph anywhere
 * in them.
 *
 * These are therefore SHARED by every course — five files total, not five per
 * style — because the colour is applied at runtime and the silhouette is not
 * course-specific.
 *
 *   node scripts/convert-clouds.mjs
 *
 * The 28MB source zip is never committed; it caches in
 * node_modules/.cache/golf-clouds/ and re-downloads on demand.
 * See docs/technical/ASSET_ATTRIBUTION.md.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'textures', 'sky');
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'golf-clouds');
const ZIP_URL = 'https://opengameart.org/sites/default/files/fx_cloudalphas.zip';
/** Alpha steps per sheet — see the note where it is used. */
const LEVELS = 16;

/**
 * Which source cloud becomes which billboard, chosen by measurement rather than
 * by eye: mean alpha (how solid) and bbox fill (how compact). Cumulus wants
 * dense and compact, cirrus wants thin and wide.
 *
 *   src  the FX_CloudAlphaNN index
 *   w/h  output size — cumulus matches the 512x320 billboard, cirrus 512x96
 *   gain alpha multiplier before the gamma; a thin source needs filling in
 *   gamma <1 thickens the falloff, >1 thins it
 */
const SHEETS = [
  // meanA 180, fill 62% — the most cloud-like of the ten by a clear margin.
  { out: 'cloud_cumulus1', src: 3, w: 512, h: 320, gain: 1.15, gamma: 0.9 },
  // meanA 153, fill 44% — a broader, more broken mass.
  { out: 'cloud_cumulus2', src: 6, w: 512, h: 320, gain: 1.25, gamma: 0.82 },
  // meanA 97, fill 40% — the airiest of the three, needs the most filling in.
  { out: 'cloud_cumulus3', src: 9, w: 512, h: 320, gain: 1.2, gamma: 0.85 },
  // The two thinnest sources, squeezed into the wide cirrus strip.
  { out: 'cloud_cirrus1', src: 7, w: 512, h: 96, gain: 1.7, gamma: 0.72 },
  { out: 'cloud_cirrus2', src: 2, w: 512, h: 96, gain: 1.5, gamma: 0.78 }
];

async function source() {
  await fsp.mkdir(CACHE, { recursive: true });
  const zip = path.join(CACHE, 'fx_cloudalphas.zip');
  if (!fs.existsSync(path.join(CACHE, 'FX_CloudAlpha01.png'))) {
    if (!fs.existsSync(zip)) {
      console.log(`  fetching ${ZIP_URL}`);
      const res = await fetch(ZIP_URL);
      if (!res.ok) throw new Error(`${res.status} fetching the cloud pack`);
      await fsp.writeFile(zip, Buffer.from(await res.arrayBuffer()));
    }
    const { execFileSync } = await import('node:child_process');
    execFileSync('unzip', ['-o', '-q', zip, '-d', CACHE]);
  }
}

/** Trim to the alpha bounding box, so a cloud that sits in one corner of its
 *  2048² sheet fills the billboard instead of being a speck in the middle. */
async function contentBox(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width;
  let x1 = -1;
  let y0 = info.height;
  let y1 = -1;
  for (let p = 0, px = 0; p < data.length; p += 4, px++) {
    if (data[p + 3] <= 12) continue;
    const x = px % info.width;
    const y = (px / info.width) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return { left: 0, top: 0, width: info.width, height: info.height };
  // A few percent of margin so the resize never clips the feathered rim flat —
  // a cloud with a straight cut edge is the one thing worse than a grey one.
  const mx = Math.round((x1 - x0) * 0.04);
  const my = Math.round((y1 - y0) * 0.04);
  const left = Math.max(0, x0 - mx);
  const top = Math.max(0, y0 - my);
  return {
    left,
    top,
    width: Math.min(info.width - left, x1 - x0 + 1 + mx * 2),
    height: Math.min(info.height - top, y1 - y0 + 1 + my * 2)
  };
}

await fsp.mkdir(OUT, { recursive: true });
await source();

for (const s of SHEETS) {
  const file = path.join(CACHE, `FX_CloudAlpha${String(s.src).padStart(2, '0')}.png`);
  const box = await contentBox(file);
  // `fill`, not `inside`: the billboard is a fixed aspect and the cloud should
  // occupy it. A wide source squeezed into the cirrus strip is exactly the
  // stretched wisp that layer wants.
  const { data, info } = await sharp(file)
    .extract(box)
    .resize(s.w, s.h, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Normalise so the densest part of THIS cloud reaches full opacity — the ten
  // sources differ by 6x in mean alpha, and without this the airy ones read as
  // haze while the dense one reads as a rock.
  const alphas = new Uint8Array(info.width * info.height);
  for (let p = 0, i = 0; i < alphas.length; p += 4, i++) alphas[i] = data[p + 3];
  const sorted = Uint8Array.from(alphas).sort();
  const hi = Math.max(1, sorted[Math.floor(sorted.length * 0.995)]);

  // GREYSCALE, NOT RGBA. The source RGB is a grey-brown smoke plume and is
  // discarded entirely — that is the whole point of this script — so the only
  // information worth shipping is the silhouette. Writing it as one channel
  // rather than "white plus alpha" costs a quarter of the bytes for exactly the
  // same picture (228KB -> ~60KB across the five sheets), and `course3d` turns
  // luminance back into alpha in the same canvas pass that tints it, so the
  // runtime does no extra work either.
  const out = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < alphas.length; i++) {
    const a = Math.min(1, (alphas[i] / hi) * s.gain);
    // Quantised to LEVELS steps and written as a palette PNG. A photographic
    // alpha is high-entropy noise and compresses terribly — the five sheets
    // came to 236KB at full depth, which is a real per-hole download against a
    // scene budget of 37-146MB that is already tight on the slow courses.
    // 16 steps is 12KB each and is not the posterise that ruined the last
    // attempt: THAT one had 3 tiers and cut hard-edged terraces into the
    // silhouette. The falloff here is spread over dozens of pixels, so a step
    // lands every few pixels and the runtime tint ramp crosses them anyway.
    out[i] = Math.round(Math.round(Math.pow(a, s.gamma) * (LEVELS - 1)) / (LEVELS - 1) * 255);
  }
  const dst = path.join(OUT, `${s.out}.png`);
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } })
    .png({ compressionLevel: 9, palette: true, colours: LEVELS })
    .toFile(dst);
  const kb = fs.statSync(dst).size / 1024;
  console.log(`  ${s.out}.png  ${info.width}x${info.height}  from FX_CloudAlpha${String(s.src).padStart(2, '0')}  ${kb.toFixed(1)}KB`);
}
