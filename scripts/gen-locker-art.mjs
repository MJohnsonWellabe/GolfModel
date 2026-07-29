/**
 * Build the Locker Room backdrop.
 *
 * Owner: "the lockerrom button once you go into that menu needs a graphic of
 * one of the historic golf locker rooms."
 *
 * Photographs of the real ones — Augusta's champions locker room, the R&A
 * clubhouse — are all copyrighted, so this is the nearest honest thing: a CC0
 * wood-plank photo as the actual grain, with the room PAINTED over it in the
 * game's own flat-shaded language (owner chose "photo base, painted over").
 * That is the same recipe the sky pipeline uses, and it means the backdrop sits
 * beside the rest of the UI instead of fighting it.
 *
 * SOURCE (recorded in docs/technical/ASSET_ATTRIBUTION.md):
 *   ambientCG "Planks023A", CC0 1.0 — https://ambientcg.com/view?id=Planks023A
 *   Downloaded as Planks023A_1K-JPG.zip; only `_Color.jpg` is used.
 *
 * Run by hand like every other convert / gen script; CI never runs it:
 *   node scripts/gen-locker-art.mjs <path-to-Planks023A_1K-JPG_Color.jpg>
 *
 * Output: assets/marketing/img/locker-room.png, 1600x900, palette-quantized —
 * the same shape, size cap and folder every other menu backdrop uses
 * (scripts/optimize-marketing.mjs enforces MAX_W = 1600).
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const W = 1600;
const H = 900;
const OUT = resolve('assets/marketing/img/locker-room.png');

/** Deterministic jitter so a re-run produces the identical file. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The room, as flat vector shapes over the wood.
 *
 * A bay of tall lockers behind a bench, lit warm from above. Everything is
 * drawn in bands rather than gradients — the game shades in flat steps, and a
 * photoreal falloff here would read as a different art style bolted on.
 */
function roomSvg() {
  const r = rng(20260729);
  const bays = 9;
  const bayW = W / bays;
  const doorTop = H * 0.06;
  const doorBot = H * 0.62;
  let doors = '';
  for (let i = 0; i < bays; i++) {
    const x = i * bayW;
    // Each door takes a slightly different plank tone so the bay reads as
    // joinery rather than a repeated stamp.
    const tone = 0.82 + r() * 0.22;
    const shade = (c, f) => Math.round(Math.min(255, c * f * tone));
    const face = `rgb(${shade(96, 1)},${shade(60, 1)},${shade(33, 1)})`;
    const lip = `rgb(${shade(126, 1)},${shade(83, 1)},${shade(47, 1)})`;
    const dark = `rgb(${shade(54, 1)},${shade(32, 1)},${shade(17, 1)})`;
    const inset = 10;
    doors +=
      `<rect x="${x + 4}" y="${doorTop}" width="${bayW - 8}" height="${doorBot - doorTop}" fill="${face}"/>` +
      `<rect x="${x + 4}" y="${doorTop}" width="${bayW - 8}" height="6" fill="${lip}"/>` +
      `<rect x="${x + bayW - 10}" y="${doorTop}" width="6" height="${doorBot - doorTop}" fill="${dark}"/>` +
      // Recessed panel
      `<rect x="${x + inset + 6}" y="${doorTop + 34}" width="${bayW - 2 * inset - 12}" height="${doorBot - doorTop - 150}" fill="none" stroke="${dark}" stroke-width="3"/>` +
      // Louvre vents near the top — three flat slots, no gradient
      [0, 1, 2]
        .map(
          (k) =>
            `<rect x="${x + inset + 18}" y="${doorTop + 12 + k * 7}" width="${bayW - 2 * inset - 36}" height="3" fill="${dark}" opacity="0.75"/>`
        )
        .join('') +
      // Brass nameplate + handle: the two details that say "champions locker"
      `<rect x="${x + bayW / 2 - 34}" y="${doorBot - 96}" width="68" height="20" rx="3" fill="#c9a24a"/>` +
      `<rect x="${x + bayW / 2 - 34}" y="${doorBot - 96}" width="68" height="6" rx="3" fill="#e4c374"/>` +
      `<rect x="${x + bayW / 2 - 20}" y="${doorBot - 62}" width="40" height="7" rx="3" fill="#b9942f"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <!-- Wall above the lockers, and the deep shadow they sit in -->
    <rect x="0" y="0" width="${W}" height="${H}" fill="#2a1b10"/>
    <rect x="0" y="0" width="${W}" height="${doorTop}" fill="#1d130b"/>
    ${doors}
    <!-- Bench rail and seat, in front -->
    <rect x="0" y="${doorBot}" width="${W}" height="14" fill="#3d2716"/>
    <rect x="0" y="${doorBot + 46}" width="${W}" height="34" fill="#7a5330"/>
    <rect x="0" y="${doorBot + 46}" width="${W}" height="8" fill="#9a6c40"/>
    <rect x="0" y="${doorBot + 80}" width="${W}" height="${H - doorBot - 80}" fill="#241710"/>
    <!-- Warm light from above, in flat bands rather than a gradient -->
    <rect x="0" y="0" width="${W}" height="${H * 0.2}" fill="#ffcf7a" opacity="0.14"/>
    <rect x="0" y="${H * 0.2}" width="${W}" height="${H * 0.18}" fill="#ffcf7a" opacity="0.07"/>
    <!-- Corner falloff so the panel of UI floating over it stays readable -->
    <radialGradient id="v" cx="50%" cy="42%" r="72%">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.62"/>
    </radialGradient>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#v)"/>
  </svg>`;
}

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/gen-locker-art.mjs <Planks023A_1K-JPG_Color.jpg>');
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });

// The wood is the GRAIN, not the picture: tiled, darkened and desaturated so it
// reads as timber under lamplight, then the room is painted on top of it.
const grain = await sharp(src)
  .resize(400, 400, { fit: 'cover' })
  .modulate({ brightness: 0.62, saturation: 0.7 })
  .toBuffer();

const tiles = [];
for (let y = 0; y < H; y += 400) {
  for (let x = 0; x < W; x += 400) tiles.push({ input: grain, left: x, top: y });
}

await sharp({ create: { width: W, height: H, channels: 3, background: { r: 40, g: 26, b: 15 } } })
  .composite([
    ...tiles,
    // `overlay` keeps the plank grain visible THROUGH the flat shapes — the
    // point of starting from a photo at all.
    { input: Buffer.from(roomSvg()), blend: 'overlay' },
    // ...and a second, softer pass in normal blend so the shapes actually read
    // as objects rather than as a texture filter.
    { input: Buffer.from(roomSvg()), blend: 'over', opacity: 0.72 }
  ])
  // POSTERISE. The game shades in flat steps; a 24-level quantize is what keeps
  // this in the same language as the course art rather than looking like a
  // photograph someone pasted behind the menu.
  .png({ palette: true, colours: 96, dither: 0.4 })
  .toFile(OUT);

const meta = await sharp(OUT).metadata();
console.log(`locker-room.png ${meta.width}x${meta.height} ${(meta.size / 1024).toFixed(0)} KB`);
