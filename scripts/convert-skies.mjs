// Turn CC0 sky HDRIs into this game's FLAT-PAINTED per-course skies.
//
//   node scripts/convert-skies.mjs            # every style
//   node scripts/convert-skies.mjs sea_haze   # one style (fast iteration)
//
// Run BY HAND, like every other scripts/convert-*.mjs. CI never runs it: the
// sources are 17MB apiece and the outputs are tiny and committed.
//
// ---------------------------------------------------------------- why at all
// Owner report: "I want courses to have their own unique skies and clouds."
// Before this, every one of the eleven course themes drew the SAME 8x256
// four-stop gradient on the Ø9000 dome and the SAME canvas-painted cumulus/
// cirrus puffs — one sky shape, eleven colour tuples, with Timberline East and
// West byte-identical. The owner chose STYLISED, built from CC0 sources.
//
// So this script does not ship a photograph. It reads a real sky, MEASURES
// three things out of it, and repaints them as flat bands in the game's own
// shading language:
//
//   1. the horizon ramp   — the colour of clear sky at every elevation angle,
//   2. the cloud field    — where the cloud actually is, as a hard-edged
//                           two/three-tone silhouette,
//   3. the solar aureole  — the colour temperature of the light around the sun,
//                           which becomes the course's sun-disc tint.
//
// The provenance and licence of every source is recorded in
// docs/technical/ASSET_ATTRIBUTION.md (all CC0, Poly Haven).
//
// -------------------------------------------------------------- the outputs
// Per style, three small PNGs in assets/textures/sky/:
//
//   <style>_ramp.png      8x256  — the dome ramp. Same texel budget as the
//                                  DynamicTexture gradient it replaces (8KB of
//                                  VRAM), so the dome costs exactly what it did.
//   <style>_cumulus.png   512x320 — the low cloud billboard.
//   <style>_cirrus.png    512x96  — the high streak billboard.
//
// Those are the EXACT dimensions of the three DynamicTextures in course3d.ts's
// wispy branch, deliberately: a style swaps in like-for-like and the per-hole
// GPU cost of the sky does not move. The reported-slow courses are fill-rate
// bound on sky pixels (docs/technical/PERFORMANCE_AND_QUALITY_GATES.md) and the
// whole scene budget is 37-146MB, so growing the sky was never an option.
//
// ------------------------------------------------------ tried and rejected
// * A full skybox (six 2048² faces, ~100MB). Ruled out by the budget above
//   before a line was written.
// * A 512-wide EQUIRECT strip on the dome instead of an 8-wide ramp, so the
//   sky varies with azimuth (warm on the sun's side, cool opposite). It is
//   only +504KB and the fill rate is identical — but the dome's u origin has
//   no defined relationship to the hole's tee→pin axis or to the sun
//   billboard's world position, so the warm side would land wherever it landed
//   and could easily sit opposite the sun. That needs somebody looking at it
//   on all 24 holes; it is the obvious follow-up, not something to guess at.
// * Runtime per-course TINTING of one shared strip. StandardMaterial's
//   emissive path is ADDITIVE (`emissiveColor = vEmissiveColor + texture *
//   level`, default.fragment.js:265) — there is no multiply slot to tint
//   through, and `linkEmissiveWithDiffuse` re-adds the untinted emissive at
//   line 296 anyway. Since each style's ramp is ~1KB on disk, giving every
//   style its own correctly-coloured ramp is cheaper AND truer to its source
//   than tinting a shared one. (`emissiveTexture.level` remains available as a
//   free scalar brightness knob if a course ever needs one.)
//
// ------------------------------------------------------------- the sampling
// Equirectangular layout: row 0 is the zenith (+90° elevation), row H/2 the
// horizon (0°), row H-1 the nadir. Only the upper hemisphere is read.
//
// Clear-sky ramp: for each elevation row, take the 35th PERCENTILE pixel by
// luminance around the full 360° ring rather than the mean. The mean is
// dragged up by cloud and by the sun; the low percentile is the sky BETWEEN
// the clouds, which is what the dome should be — the clouds are painted
// separately onto billboards and would otherwise be counted twice.
//
// Cloud extraction: cloud is measured as min(R,G,B). Blue sky has a low red
// channel and white/grey cloud has all three high, so the min channel
// separates them far more cleanly than luminance (which also lights up on
// bright blue) or saturation (which breaks down in haze).
//
// Both ramp and cloud are then POSTERISED — quantised to a handful of flat
// steps with hard edges — which is the whole point: the result reads as
// screen-printed bands in the game's flat-shaded look, carrying a real sky's
// structure without being a photo.

import sharp from 'sharp';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'assets', 'textures', 'sky');
// Raw 8K sources are 17MB each and must never enter the repo. node_modules is
// already gitignored, and .cache is the conventional home for exactly this.
const CACHE = path.join(root, 'node_modules', '.cache', 'golf-skies');

/** Poly Haven's tonemapped-JPG CDN path for an HDRI id. */
const srcUrl = (id) =>
  `https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/${id}.jpg`;

// ---------------------------------------------------------------- the styles
//
// One style per course identity (the owner named these): storm light over Red
// Hollow, sea haze at Sable Bay, a greyer blown coast at Port Johnson, alpine
// clarity at Timberline — with East and West on genuinely DIFFERENT source
// skies, since "byte-identical" was half the complaint — golden hour on Wild
// Prairie, autumn overcast at Maple Vale, bright parkland at Wildwood.
//
// Knobs, all per style because a clear desert sunset and a flat overcast want
// different treatment and one global setting flatters neither:
//   bands      how many flat steps the dome ramp is cut into. Higher = smoother
//              but less obviously painted. 13-16 reads as deliberate banding
//              across the ~40° of dome a shot camera sees.
//   sat        saturation multiplier on the ramp. Tonemapped HDRIs are
//              desaturated relative to how a sky FEELS; >1 pushes back toward
//              the game's saturated palette.
//   lift       gamma-ish brightness on the ramp (<1 darkens). Storm and
//              overcast skies use it to keep the dome from washing the course.
//   cumEl      [low, high] elevation band, degrees, SEARCHED for the cumulus.
//              Low, fat clouds sit near the horizon. This is where to look, not
//              what to crop: findCloud() frames the largest cloud it finds in
//              the band, so the band can be generous.
//   cirEl      the same search band for the cirrus streak — high and thin.
//   cloudTiers alpha steps for the posterised silhouette (ascending). Three
//              steps = core, body, feathered rim. Fewer/lower = wispier.
//   cover      how much of the source's cloud makes the cut: the percentile of
//              the cloudiness field taken as "this is cloud". 0.55 keeps the
//              densest 45%; an overcast sky wants a much lower number or the
//              whole sheet fills in solid.
const STYLES = [
  {
    id: 'storm_canyon',
    // The fog colour of the course that uses this sky (its theme.haze). The
    // bottom bands ramp into it so the dome and the EXP2 fog meet without a
    // seam — see HAZE_BANDS.
    //
    // READ IT FROM THE JSON THE GAME ACTUALLY LOADS. Under `courseRebuilds`
    // (which production runs) Sable Bay, Timberline East and Port Johnson come
    // from src/data/courses/V2/*.json, not the v1 file of the same name — and
    // the two disagree. All three were first authored from the v1 haze and shipped
    // a pale band above the horizon; Port Johnson's was +24/+28/+30 off.
    // `tests/unit/skyAssets.test.ts` now resolves every course through the real
    // roster and fails if a ramp's bottom row is not its course's haze.
    haze: '#f0d9c0',
    src: 'table_mountain_1_puresky',
    note: 'Red Hollow — storm light over the canyon: deep bruised blue with torn, stacked cloud and a hot sunset horizon. (wasteland_clouds_puresky was the first pick on its name alone and measured as a plain clear blue desert sky — no storm in it.)',
    bands: 15, sat: 1.14, lift: 0.94,
    cumEl: [4, 44], cirEl: [40, 76],
    cloudTiers: [0.34, 0.66, 0.94], cover: 0.62
  },
  {
    id: 'sea_haze',
    // The fog colour of the course that uses this sky (its theme.haze). The
    // bottom bands ramp into it so the dome and the EXP2 fog meet without a
    // seam — see HAZE_BANDS.
    haze: '#e6ecec',
    src: 'kloofendal_misty_morning_puresky',
    // Captured in-game and it was a WHITE SHEET — the misty source is already
    // near the top of the range, so a 1.05 lift pushed the mid bands
    // (#f0f0f8) brighter than the zenith and the dome read as an overexposed
    // void rather than sea haze. Pulled down and saturated instead: haze that
    // is unmistakably pale BLUE is the look; haze that is white is a missing
    // texture.
    note: 'Sable Bay — sea haze: the ramp barely changes hue, it just goes pale and keeps going.',
    bands: 14, sat: 1.35, lift: 0.84,
    cumEl: [4, 40], cirEl: [38, 72],
    cloudTiers: [0.24, 0.46, 0.68], cover: 0.34
  },
  {
    id: 'links_coast',
    // The fog colour of the course that uses this sky (its theme.haze). The
    // bottom bands ramp into it so the dome and the EXP2 fog meet without a
    // seam — see HAZE_BANDS.
    haze: '#c7ced2',
    src: 'aristea_wreck_puresky',
    note: 'Port Johnson — a blown grey coastal midday. Deliberately the least blue sky on the roster: the links theme is already grey-blue (#7d8fa0) and the wreck source measures almost neutral, which is exactly the weather this course is about.',
    bands: 14, sat: 1.3, lift: 1.02,
    cumEl: [4, 42], cirEl: [40, 74],
    cloudTiers: [0.3, 0.6, 0.9], cover: 0.5
  },
  {
    id: 'alpine_clear',
    // The fog colour of the course that uses this sky (its theme.haze). The
    // bottom bands ramp into it so the dome and the EXP2 fog meet without a
    // seam — see HAZE_BANDS.
    haze: '#cfe0e6',
    src: 'drakensberg_solitary_mountain_puresky',
    note: 'Timberline East — alpine clarity: deep zenith, very little cloud.',
    bands: 16, sat: 1.16, lift: 1.0,
    cumEl: [5, 44], cirEl: [42, 78],
    cloudTiers: [0.22, 0.46, 0.7], cover: 0.6
  },
  {
    id: 'alpine_broken',
    // The fog colour of the course that uses this sky (its theme.haze). The
    // bottom bands ramp into it so the dome and the EXP2 fog meet without a
    // seam — see HAZE_BANDS.
    haze: '#cfe0e6',
    src: 'rocky_ridge_puresky',
    note: 'Timberline West — the same mountains, a different hour: high cirrus fans over a warmer, paler dome. East and West MUST NOT MATCH, which is half of what the owner reported; rustig_koppie_puresky was rejected precisely because it measured almost identically to Drakensberg.',
    // Lifted and saturated after the first in-game capture: at 1.10/1.03 the
    // measured zenith came out #6878a0, a grey-violet that read as dusk rather
    // than as a bright broken-cloud day, and under the West pine canopy the
    // whole hole went muddy — the dullest course on the roster. It has to stay
    // DISTINCT from East's deep blue, so the answer is a paler, warmer dome
    // rather than a bluer one.
    bands: 15, sat: 1.22, lift: 1.16,
    cumEl: [4, 44], cirEl: [42, 76],
    cloudTiers: [0.3, 0.62, 0.92], cover: 0.5
  },
  {
    id: 'prairie_gold',
    // The fog colour of the course that uses this sky (its theme.haze). The
    // bottom bands ramp into it so the dome and the EXP2 fog meet without a
    // seam — see HAZE_BANDS.
    haze: '#f0e2b6',
    src: 'qwantani_sunset_puresky',
    note: 'Wild Prairie — golden hour: the horizon band does the work, gold under blue.',
    bands: 15, sat: 1.2, lift: 1.02,
    cumEl: [3, 38], cirEl: [36, 70],
    cloudTiers: [0.3, 0.6, 0.88], cover: 0.5
  },
  {
    id: 'autumn_overcast',
    // The fog colour of the course that uses this sky (its theme.haze). The
    // bottom bands ramp into it so the dome and the EXP2 fog meet without a
    // seam — see HAZE_BANDS.
    haze: '#e4ddce',
    src: 'overcast_soil_puresky',
    note: 'Maple Vale — autumn overcast: a low grey lid, almost no ramp, clouds that join up.',
    bands: 13, sat: 0.96, lift: 0.97,
    cumEl: [4, 40], cirEl: [38, 72],
    cloudTiers: [0.36, 0.62, 0.86], cover: 0.42
  },
  {
    id: 'parkland_bright',
    // The fog colour of the course that uses this sky (its theme.haze). The
    // bottom bands ramp into it so the dome and the EXP2 fog meet without a
    // seam — see HAZE_BANDS.
    haze: '#dfece8',
    src: 'kloofendal_48d_partly_cloudy_puresky',
    note: 'Wildwood — bright parkland noon: strong blue with the best-formed cumulus on the roster, the friendliest sky here. (farm_field_puresky and sunflowers_puresky were both tried and dropped: their tonemaps are hazy enough that the measured zenith came out neutral grey, the opposite of Wildwood.)',
    bands: 14, sat: 1.18, lift: 1.05,
    cumEl: [4, 42], cirEl: [40, 74],
    cloudTiers: [0.28, 0.56, 0.85], cover: 0.52
  }
];

// ------------------------------------------------------------------ plumbing

async function source(style) {
  const file = path.join(CACHE, `${style.src}.jpg`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1024) return file;
  await fsp.mkdir(CACHE, { recursive: true });
  process.stdout.write(`  downloading ${style.src} … `);
  const res = await fetch(srcUrl(style.src));
  if (!res.ok) throw new Error(`${style.src}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(file, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)}MB`);
  return file;
}

/** Decode a region of the equirect to a raw RGB buffer of a given size.
 *  `blur` (sigma, in OUTPUT pixels) is applied after the resize — the cloud
 *  passes need it, or JPEG grain and single-pixel sky gaps survive the
 *  posterise as salt-and-pepper speckle around every silhouette. */
async function raw(file, { left, top, width, height }, outW, outH, blur = 0) {
  const img = sharp(file, { limitInputPixels: 400e6 });
  const region = width ? img.extract({ left, top, width, height }) : img;
  let pipe = region.resize(outW, outH, { fit: 'fill', kernel: 'lanczos3' });
  if (blur > 0) pipe = pipe.blur(blur);
  const { data, info } = await pipe.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Saturation + brightness push, then a 5-bit-per-channel snap so the flat
 *  bands land on a coarse painted palette rather than photographic values. */
function stylise([r, g, b], sat, lift) {
  const y = lum(r, g, b);
  const f = (c) => clamp255((y + (c - y) * sat) * lift);
  const snap = (c) => Math.min(255, Math.round(c / 8) * 8);
  return [snap(f(r)), snap(f(g)), snap(f(b))];
}

/** Percentile pixel of a row, by luminance. Returns [r,g,b]. */
function rowPercentile(data, w, y, p) {
  const px = [];
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    px.push([data[i], data[i + 1], data[i + 2]]);
  }
  px.sort((a, b) => lum(...a) - lum(...b));
  return px[Math.min(px.length - 1, Math.floor(p * px.length))];
}

// -------------------------------------------------------------------- ramp
//
// Elevation → ramp row. The dome ramp is NOT a linear map of elevation: it
// reproduces the stop layout the hand-authored gradient already used (zenith,
// mid, sky-bottom, horizon glow, haze at 0 / .55 / .80 / .88 / 1.0), because
// that layout is empirically tuned to where the Ø9000 sphere's texels actually
// land on screen. Feeding a linear 90°→0° map instead puts the entire horizon
// band below the dome's equator where the terrain hides it. So: keep the
// proven placement, replace the invented colours with measured ones.
const RAMP_STOPS = [
  [0.0, 90],
  [0.55, 35],
  [0.8, 10],
  [0.88, 6],
  // NOT 0°. A `*_puresky` HDRI still carries a smear of the original ground at
  // the very bottom rows, and sampling it painted an olive-brown band along
  // every horizon (measured: storm's horizon came out #a8a888). 2.5° is above
  // the smear and still unmistakably horizon.
  [1.0, 2.5]
];

function elevationAt(t) {
  for (let i = 1; i < RAMP_STOPS.length; i++) {
    const [t0, e0] = RAMP_STOPS[i - 1];
    const [t1, e1] = RAMP_STOPS[i];
    if (t <= t1) return e0 + ((e1 - e0) * (t - t0)) / (t1 - t0);
  }
  return 0;
}

/** How many of the lowest bands ramp into the course's fog colour. Three of
 *  13–16 is roughly the bottom 20% of the dome — the part the terrain does not
 *  cover and the fog owns. */
const HAZE_BANDS = 3;

/** '#rrggbb' → [r,g,b]. */
function hexRgb(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mixRgb(a, hex, k) {
  const b = hexRgb(hex);
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k));
}

async function buildRamp(file, style) {
  // 512 rows of upper hemisphere, 256 samples around each ring: enough to make
  // the percentile meaningful without decoding 8K.
  const { data, w } = await raw(file, {}, 256, 1024);
  const H = 256;
  const px = Buffer.alloc(H * 8 * 3);
  const bandColors = [];
  for (let b = 0; b < style.bands; b++) {
    // Average the measured colours across the band, then stylise ONCE — doing
    // it per-row and averaging afterwards drifts the hue.
    const y0 = Math.floor((b * H) / style.bands);
    const y1 = Math.floor(((b + 1) * H) / style.bands);
    let acc = [0, 0, 0];
    for (let y = y0; y < y1; y++) {
      // Upper hemisphere occupies rows 0..511 of the 1024-row decode.
      const el = elevationAt((y + 0.5) / H);
      const src = Math.min(511, Math.round(((90 - el) / 180) * 1024));
      // The percentile has to WALK. High in the sky the dark pixels around a
      // ring are the clear sky between the clouds, which is what the dome
      // wants (the clouds are painted separately and would be counted twice).
      // Down at the horizon the dark pixels are cloud UNDERSIDES and distant
      // land, and the clear sky is the bright haze band — a fixed low
      // percentile there produced ramps that got DARKER toward the horizon on
      // five of the eight sources, which is backwards for every real sky.
      const k = 1 - el / 90;
      const c = rowPercentile(data, w, src, 0.35 + 0.4 * k * k);
      acc = [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]];
    }
    const n = y1 - y0;
    let col = stylise([acc[0] / n, acc[1] / n, acc[2] / n], style.sat, style.lift);
    // THE HORIZON HAS TO MEET THE FOG.
    //
    // The hand-authored gradient this replaces ended its last stop on
    // `theme.haze` EXACTLY, and that was not decoration: the scene runs EXP2
    // fog at `scene.fogColor = theme.haze`, so every distant thing dissolves
    // into that colour. A dome that ends on some other colour draws a hard
    // line across the bottom of the sky where the two meet — which is the
    // "weird band at the horizon" defect this course set has already been
    // through once (course3d.ts groundFarC).
    //
    // The measured colours are right for the sky and wrong for the seam, so
    // the bottom HAZE_BANDS are ramped into the haze rather than replaced:
    // the sky keeps its own character all the way down and still arrives on
    // the fog colour at the last row.
    const fromBottom = style.bands - 1 - b;
    if (fromBottom < HAZE_BANDS) {
      const k = (HAZE_BANDS - fromBottom) / HAZE_BANDS;
      col = mixRgb(col, style.haze, k * k);
    }
    bandColors.push(col);
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < 8; x++) {
        const i = (y * 8 + x) * 3;
        px[i] = col[0];
        px[i + 1] = col[1];
        px[i + 2] = col[2];
      }
    }
  }
  await sharp(px, { raw: { width: 8, height: H, channels: 3 } })
    .png({ palette: true, dither: 0, compressionLevel: 9 })
    .toFile(path.join(OUT, `${style.id}_ramp.png`));
  return bandColors;
}

// ------------------------------------------------------------------- clouds

/**
 * Find the single biggest CLOUD in an elevation band, and return the crop that
 * frames it.
 *
 * The first version of this just slid a window round the 360° ring and kept the
 * one with the most total cloud in it. That reliably picked the busiest patch
 * of sky — five small puffs — and five small puffs scaled onto a 500-unit
 * billboard read as speckle, not weather. What the billboard wants is what the
 * hand-painted texture it replaces was: ONE cloud, filling the frame.
 *
 * So: threshold the band into a cloud/not-cloud mask, label connected
 * components (wrapping at 0°/360°, since a cloud may straddle the seam), take
 * the largest by area, and frame ITS bounding box. Nothing here is a per-source
 * magic number, so swapping a source in the table above just works.
 */
async function findCloud(file, style, [elLo, elHi], outW, outH, rank = 0) {
  const meta = await sharp(file, { limitInputPixels: 400e6 }).metadata();
  const SW = meta.width;
  const SH = meta.height;
  const bandTop = Math.round(((90 - elHi) / 180) * SH);
  const bandH = Math.round(((elHi - elLo) / 180) * SH);

  const GW = 720;
  const GH = 96;
  const scan = await raw(file, { left: 0, top: bandTop, width: SW, height: bandH }, GW, GH, 2);
  const f = new Float64Array(GW * GH);
  for (let i = 0, p = 0; p < f.length; i += 3, p++) {
    f[p] = Math.min(scan.data[i], scan.data[i + 1], scan.data[i + 2]);
  }
  const thr = Float64Array.from(f).sort()[Math.floor(f.length * style.cover)];

  const label = new Int32Array(GW * GH).fill(-1);
  // EVERY component, not just the biggest. `rank` picks the Nth-largest, which
  // is how one HDRI yields several genuinely DIFFERENT cumulus silhouettes
  // instead of the same one on every billboard (owner: "sable bay is just the
  // same cloud on repeat").
  const boxes = [];
  const stack = [];
  for (let seed = 0; seed < f.length; seed++) {
    if (label[seed] >= 0 || f[seed] <= thr) continue;
    const id = seed;
    let area = 0;
    let x0 = 1e9;
    let x1 = -1e9;
    let y0 = 1e9;
    let y1 = -1e9;
    // Longitude is cyclic, so bbox width is tracked in the seed's frame: x is
    // recorded as an offset from the seed column, unwrapped to ±GW/2.
    const sx = seed % GW;
    stack.length = 0;
    stack.push(seed);
    label[seed] = id;
    while (stack.length) {
      const p = stack.pop();
      const px = p % GW;
      const py = (p - px) / GW;
      let dx = px - sx;
      if (dx > GW / 2) dx -= GW;
      if (dx < -GW / 2) dx += GW;
      area++;
      if (dx < x0) x0 = dx;
      if (dx > x1) x1 = dx;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      const nb = [
        ((px + 1) % GW) + py * GW,
        ((px - 1 + GW) % GW) + py * GW,
        py > 0 ? px + (py - 1) * GW : -1,
        py < GH - 1 ? px + (py + 1) * GW : -1
      ];
      for (const q of nb) {
        if (q < 0 || label[q] >= 0 || f[q] <= thr) continue;
        label[q] = id;
        stack.push(q);
      }
    }
    boxes.push({ area, cx: sx + (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  boxes.sort((a, b) => b.area - a.area);
  // COMPONENTS THAT FRAME THE SAME PATCH OF SKY ARE ONE CLOUD, whatever the
  // flood fill thinks. The crop is padded ~18% and then clamped inside the
  // image, so two neighbouring components can resolve to the identical
  // rectangle: prairie_gold's ranks 1 and 2 produced byte-identical PNGs, which
  // is the very repetition these variants exist to end. Keep the larger of any
  // near-coincident pair — the distinctness gate in tests/unit/skyAssets.test.ts
  // is what caught this and is what will catch the next source that does it.
  const apart = [];
  for (const b of boxes) {
    const near = apart.some(
      (k) => Math.abs(((k.cx - b.cx + GW * 1.5) % GW) - GW / 2) < GW / 12 && Math.abs(k.cy - b.cy) < GH / 3
    );
    if (!near) apart.push(b);
  }

  // A sky with genuinely no cloud (alpine clear) yields nothing worth framing —
  // fall back to the middle of the band rather than inventing one. A style with
  // FEWER distinct components than variants asked for reuses the ones it has,
  // panned along the band, so a thin sky still gets three different frames
  // rather than three copies of one.
  const fallback = { cx: ((rank + 1) * GW) / 4, cy: GH / 2, w: GW / 6, h: GH / 2 };
  // Ranks past the last well-separated component wrap around and PAN — a third
  // of the band per step, so even a sky with one real cloud yields three
  // different frames rather than three copies of one.
  const panned = rank >= apart.length;
  const box =
    apart[rank] ??
    (apart.length
      ? { ...apart[rank % apart.length], cx: apart[rank % apart.length].cx + (rank * GW) / 3 }
      : { ...fallback, cx: fallback.cx + (rank * GW) / 3 });

  // Frame it with ~18% breathing room, in degrees, then aspect-match. The
  // minimum stops a single wisp being magnified into a blurry cloud-shaped
  // smear; the maximum stops one enormous overcast component swallowing the
  // whole ring.
  const degPerCol = 360 / GW;
  const degPerRow = (elHi - elLo) / GH;
  const wantW = Math.min(150, Math.max(14, box.w * degPerCol * 1.18));
  const wantH = Math.min(elHi - elLo, Math.max(10, box.h * degPerRow * 1.35));
  const spanEl = Math.max(wantH, (wantW * outH) / outW);
  const spanLon = (spanEl * outW) / outH;

  const centreEl = elHi - (box.cy + 0.5) * degPerRow;
  const centreLon = (box.cx + 0.5) * degPerCol;
  const top = Math.round(((90 - (centreEl + spanEl / 2)) / 180) * SH);
  const height = Math.round((spanEl / 180) * SH);
  const width = Math.min(SW, Math.round((spanLon / 360) * SW));
  const left = Math.round((((centreLon - spanLon / 2) % 360) + 360) % 360 / 360 * SW);
  // sharp cannot extract across the seam, so a crop that would run off the
  // right edge has to come back inside the image. A REAL component is nudged
  // back (it stays next to the cloud it framed); a PANNED one wraps modulo the
  // legal travel instead.
  //
  // That distinction is the whole fix: the crop is ~3400 of 8192 columns wide,
  // so the travel is only 4779 and BOTH panned ranks clamped to it — which is
  // how prairie_gold and alpine_clear emitted byte-identical variants twice in
  // a row. A wrap keeps every rank on a different window of the same sky, and a
  // panned crop has no cloud to stay adjacent to anyway.
  const travel = Math.max(0, SW - width);
  const at = panned && travel > 0 ? ((left % travel) + travel) % travel : Math.max(0, Math.min(travel, left));
  return {
    left: at,
    top: Math.max(0, Math.min(Math.floor(SH / 2) - height, top)),
    width,
    height
  };
}

/** Cut one cloud billboard out of the source, posterised into flat tiers. */
async function buildCloud(file, style, name, band, outW, outH, opts) {
  const crop = await findCloud(file, style, band, outW, outH, opts.rank ?? 0);
  const { data } = await raw(file, crop, outW, outH, opts.blur ?? 3);

  // Cloudiness field, auto-levelled between its own 8th and 97th percentiles so
  // a hazy source and a hard-edged one both use the full alpha range.
  const field = new Float64Array(outW * outH);
  for (let i = 0, p = 0; i < data.length; i += 3, p++) {
    field[p] = Math.min(data[i], data[i + 1], data[i + 2]);
  }
  const sorted = Float64Array.from(field).sort();
  const lo = sorted[Math.floor(sorted.length * style.cover)];
  const hi = sorted[Math.floor(sorted.length * 0.97)];
  const span = Math.max(1, hi - lo);

  // Lit and shaded cloud colours, measured: the brightest decile of the cloud
  // is the sunlit top, the middle of the range is its shaded underside. That is
  // where a storm sky's grey and a golden-hour sky's peach actually come from.
  const litIdx = Math.floor(sorted.length * 0.985);
  const shdIdx = Math.floor(sorted.length * (style.cover + 0.12));
  let lit = [0, 0, 0];
  let shd = [0, 0, 0];
  let litN = 0;
  let shdN = 0;
  for (let i = 0, p = 0; i < data.length; i += 3, p++) {
    const v = field[p];
    if (v >= sorted[litIdx]) {
      lit = [lit[0] + data[i], lit[1] + data[i + 1], lit[2] + data[i + 2]];
      litN++;
    } else if (v >= sorted[shdIdx] && v < sorted[Math.floor(sorted.length * (style.cover + 0.3))]) {
      shd = [shd[0] + data[i], shd[1] + data[i + 1], shd[2] + data[i + 2]];
      shdN++;
    }
  }
  const litC = stylise(litN ? lit.map((c) => c / litN) : [255, 255, 255], style.sat * 0.85, 1.06);
  // The measured lit/shaded pair sits only a few percent apart in a tonemapped
  // JPG, which posterises into one flat white blob. Push the shaded tone down
  // (and slightly cooler) so the three steps actually read as steps.
  const shdC = stylise(shdN ? shd.map((c) => c / shdN) : [210, 214, 222], style.sat * 0.95, 0.82);
  const midC = litC.map((c, k) => Math.round((c + shdC[k]) / 2));

  // Elliptical falloff. Without it every billboard would be a rectangle of
  // cloud with four hard cut edges; with it the posterised silhouette is
  // bounded by an ellipse but SHAPED by the real cloud inside it.
  const cx = outW / 2;
  const cy = outH * (opts.cyFrac ?? 0.5);
  const rx = outW * (opts.rxFrac ?? 0.5);
  const ry = outH * (opts.ryFrac ?? 0.5);
  const tiers = style.cloudTiers;
  const alpha = new Float64Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = y * outW + x;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      // smoothstep(1 → 0.55) — a soft ring, so the vignette never draws its own
      // visible edge; the visible edge always belongs to a cloud tier.
      const vig = d >= 1 ? 0 : d <= 0.55 ? 1 : 1 - (d - 0.55) / 0.45;
      const v = ((field[p] - lo) / span) * (vig * vig) * (opts.gain ?? 1);
      // Posterise: pick the highest tier whose threshold this pixel clears.
      let a = 0;
      for (let t = 0; t < tiers.length; t++) if (v > (t + 1) / (tiers.length + 1)) a = tiers[t];
      alpha[p] = a;
    }
  }

  // Cel shading that follows the SILHOUETTE, not the frame. Shading by absolute
  // height painted two dead-straight horizontal seams across the whole sheet —
  // obviously a rectangle of paint, not a lit cloud. Instead measure how far
  // each pixel sits below the top of its own column of cloud: the first `crown`
  // rows are the sunlit crown, the next `body` the mid tone, the rest the
  // shaded underside. Every lump gets its own highlight, and the seams curve
  // with the shape.
  const crown = Math.max(3, Math.round(outH * 0.16));
  const body = Math.max(4, Math.round(outH * 0.24));
  const out = Buffer.alloc(outW * outH * 4);
  for (let x = 0; x < outW; x++) {
    let depth = -1;
    for (let y = 0; y < outH; y++) {
      const p = y * outW + x;
      const a = alpha[p];
      const o = p * 4;
      if (a === 0) {
        depth = -1;
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
        continue;
      }
      depth++;
      const col = depth < crown ? litC : depth < crown + body ? midC : shdC;
      out[o] = col[0];
      out[o + 1] = col[1];
      out[o + 2] = col[2];
      out[o + 3] = Math.round(a * 255);
    }
  }
  // FILL THE SHEET. Framing the cloud in the source still leaves it floating in
  // a mostly-empty rectangle — a real sky's clouds do not conveniently match a
  // 512x320 frame — and a small cloud in a big transparent sheet renders as a
  // small cloud on a big billboard, i.e. smaller weather than the hand-painted
  // puff this replaces. So measure what was actually painted and blow it up to
  // fill 94% of the sheet. NEAREST resampling only: anything smoother would
  // reintroduce the gradients the posterise exists to remove.
  let x0 = outW;
  let x1 = -1;
  let y0 = outH;
  let y1 = -1;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      if (out[(y * outW + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  let sheet = sharp(out, { raw: { width: outW, height: outH, channels: 4 } });
  if (x1 > x0 && y1 > y0) {
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const sx = (outW * 0.94) / bw;
    const sy = (outH * 0.94) / bh;
    // Anisotropy is allowed but capped at 1.35: some stretch reads as wind, a
    // lot reads as a smeared JPEG.
    const s = Math.min(sx, sy);
    const nw = Math.round(bw * Math.min(sx, s * 1.35));
    const nh = Math.round(bh * Math.min(sy, s * 1.35));
    const scaled = await sheet
      .extract({ left: x0, top: y0, width: bw, height: bh })
      .resize(nw, nh, { fit: 'fill', kernel: 'nearest' })
      .png()
      .toBuffer();
    sheet = sharp({
      create: { width: outW, height: outH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite([
      { input: scaled, left: Math.round((outW - nw) / 2), top: Math.round((outH - nh) / 2) }
    ]);
  }
  await sheet
    // dither:0 matters — libimagequant dithers by default, which sprays noise
    // straight back into the flat bands this whole script exists to produce.
    .png({ palette: true, dither: 0, compressionLevel: 9 })
    .toFile(path.join(OUT, `${style.id}_${name}.png`));
  return { lit: litC, shade: shdC };
}

// ------------------------------------------------------------------ the sun
//
// Not the sun disc itself (clipped to white in any tonemap) but the AUREOLE
// around it, 3-9° out, which is where a sky's colour temperature lives. This
// becomes the course's `sunTint` — the reason Red Hollow's sun is a bronze coin
// and Timberline's is white.
async function sunTint(file) {
  const { data, w, h } = await raw(file, {}, 512, 256);
  let bx = 0;
  let by = 0;
  let bv = -1;
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const v = lum(data[i], data[i + 1], data[i + 2]);
      if (v > bv) {
        bv = v;
        bx = x;
        by = y;
      }
    }
  }
  const r0 = (3 / 180) * h;
  const r1 = (9 / 180) * h;
  let acc = [0, 0, 0];
  let n = 0;
  for (let y = Math.max(0, by - r1); y < Math.min(h, by + r1); y++) {
    for (let x = bx - r1; x < bx + r1; x++) {
      const d = Math.hypot(x - bx, y - by);
      if (d < r0 || d > r1) continue;
      const xi = ((Math.round(x) % w) + w) % w; // the ring wraps at 0°/360°
      const i = (Math.round(y) * w + xi) * 3;
      acc = [acc[0] + data[i], acc[1] + data[i + 1], acc[2] + data[i + 2]];
      n++;
    }
  }
  if (!n) return [255, 252, 220];
  // Normalise to a bright coin: the sun billboard is emissive, so what matters
  // is the RATIO between channels, not the source's exposure.
  const m = Math.max(...acc) / n;
  return acc.map((c) => clamp255((c / n / m) * 255));
}

// ---------------------------------------------------------------------- main

/** How many distinct cumulus sheets each style ships. Mirrored in
 *  src/slice3d/course3d.ts (CUMULUS_VARIANTS) and gated in
 *  tests/unit/skyAssets.test.ts — all three must agree. */
export const CUMULUS_VARIANTS = 3;
/** Their filename stems, in the order course3d loads them. The first keeps the
 *  original un-numbered name so no existing reference breaks. */
export const CUMULUS_NAMES = Array.from({ length: CUMULUS_VARIANTS }, (_, i) =>
  i === 0 ? 'cumulus' : `cumulus${i + 1}`
);

const only = process.argv.slice(2);
await fsp.mkdir(OUT, { recursive: true });

for (const style of STYLES) {
  if (only.length && !only.includes(style.id)) continue;
  console.log(`\n${style.id}  (${style.src})`);
  console.log(`  ${style.note}`);
  const file = await source(style);
  const bands = await buildRamp(file, style);
  // THREE CUMULUS, NOT ONE. Every billboard shared a single sheet, so a sky
  // full of clouds was one cloud stamped six times (owner: "sable bay is just
  // the same cloud on repeat"). Each variant is cut from a DIFFERENT connected
  // cloud in the same HDRI, so they belong to the same weather while having
  // genuinely different silhouettes. The extra two cost ~2KB per style against
  // a 60KB budget currently running at 2-5KB.
  let cum = null;
  for (let v = 0; v < CUMULUS_VARIANTS; v++) {
    const c = await buildCloud(file, style, v === 0 ? 'cumulus' : `cumulus${v + 1}`, style.cumEl, 512, 320, {
      cyFrac: 0.52,
      rxFrac: 0.5,
      ryFrac: 0.52,
      gain: 1.05,
      rank: v
    });
    if (v === 0) cum = c;
  }
  await buildCloud(file, style, 'cirrus', style.cirEl, 512, 96, {
    cyFrac: 0.5,
    rxFrac: 0.5,
    ryFrac: 0.62,
    gain: 0.85
  });
  const sun = await sunTint(file);
  const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  console.log(`  ramp   zenith ${hex(bands[0])} → horizon ${hex(bands[bands.length - 1])} (${style.bands} bands)`);
  console.log(`  cloud  lit ${hex(cum.lit)}  shade ${hex(cum.shade)}`);
  console.log(`  sunTint ${hex(sun)}   <- paste into the course theme`);
  let total = 0;
  for (const n of ['ramp', 'cirrus', ...CUMULUS_NAMES]) {
    total += fs.statSync(path.join(OUT, `${style.id}_${n}.png`)).size;
  }
  console.log(`  ${(total / 1024).toFixed(1)}KB on disk`);
}
