import { PhysicsEngine } from '../../systems/PhysicsEngine';
import { blobHash, collectTreeBlobs, TreeBlob } from '../../systems/treeField';
import { HoleData, Surface } from '../types';
import { sampleGrassGrain } from './grassTexture';
import { CourseTheme, shade } from './Theme';

// Tree blobs now live in a rendering-independent module so the physics engine
// can share them for per-trunk collision. Re-exported here so existing
// importers (course3d) keep their import path.
export { blobHash, collectTreeBlobs };
export type { TreeBlob };

/** World-px padding baked around the hole so the horizon never shows seams. */
export const TEXTURE_PAD = 220;

/** Half-size (world px) of the mown apron baked under the built tee platform. */
export const TEE_HALF = 26;

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
  // Per-surface base color. Green uses the BRIGHT tone so putting surfaces read
  // as the lightest, shortest grass. Index 3 (fringe) uses the theme's own
  // fringe hue — a value BETWEEN fairway and green — so the collar separates
  // both in color and in a grayscale readability test. Index 7 is the tee pad:
  // distinctly lighter than fairway so it reads as a clean mown box.
  const palette: Array<[number, number, number]> = [
    rgb(theme.rough),
    rgb(theme.fairway),
    rgb(theme.greenLight),
    rgb(theme.fringe),
    rgb(theme.sand),
    rgb(theme.water),
    rgb(shade(theme.rough, 0.8)), // under trees
    rgb(shade(theme.fairway, 1.22)) // tee box — clearly lighter than fairway
  ];
  // Mow bands as a SIGNED brightness swing (alternating light+dark stripes), not
  // a one-way tint — so they survive mipmap/anisotropic averaging at gameplay
  // distance where the old ~6% lerp washed out. `stripeWidth` is one band's
  // world width (wider = survives distance); `stripeContrast` is the ± swing.
  // 0 = no stripes (fringe collar / sand / water / trees / tee).
  const stripeWidth = [120, 74, 48, 0, 0, 0, 0, 0];
  const stripeContrast = [0.055, 0.2, 0.13, 0, 0, 0, 0, 0];
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

  // Sand sculpting (theme.sandSculpt > 0): bunker centres precomputed for the
  // radial depth shading inside the hot texel loop.
  const sculpt = theme.sandSculpt;
  const bunkers = hole.hazards
    .filter((z) => z.type === 'bunker')
    .map((z) => {
      const bcx = z.polygon.reduce((a, p) => a + p[0], 0) / z.polygon.length;
      const bcy = z.polygon.reduce((a, p) => a + p[1], 0) / z.polygon.length;
      const maxR = Math.max(...z.polygon.map((p) => Math.hypot(p[0] - bcx, p[1] - bcy)));
      return { cx: bcx, cy: bcy, maxR };
    });

  // Edge-wobble amplitude multiplier (default 1 → historical subtle ripple).
  const ew = theme.edgeWobble ?? 1;
  const realGrain = Boolean(theme.turfGrainKey);
  const fairwayTile = theme.fairwayGrainTile ?? 6;
  const roughTile = theme.roughGrainTile ?? 14;
  // Rough gets its own real photo when authored (genuinely different image,
  // not a retint) — falls back to the fairway key so a course that only
  // sets turfGrainKey still gets a real (if shared) grain on rough too.
  const roughKey = theme.roughGrainKey ?? theme.turfGrainKey;

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
      // theme.edgeWobble scales the amplitude (default 1); a course that reads
      // too rectangular can crank it for wavier, more organic boundaries.
      const wobX =
        (Math.sin(wx * 0.019 + wy * 0.011) * 5 +
          Math.sin(wy * 0.034 - wx * 0.014) * 3 +
          (texelHash(px + 7, py) - 0.5) * 3) *
        ew;
      const wobY =
        (Math.sin(wy * 0.018 - wx * 0.010) * 5 +
          Math.sin(wx * 0.032 + wy * 0.015) * 3 +
          (texelHash(px, py + 7) - 0.5) * 3) *
        ew;
      const jx = wx + wobX;
      const jy = wy + wobY;
      let cls = classAt(jx, jy);
      // Tee pad overrides ground surfaces only (never sand/water/trees/green),
      // tested on crisp (un-jittered) coords for a sharp square edge. Keep the
      // inset distance so we can draw a darker collar around the pad.
      let teeInset = -1;
      if (cls === 0 || cls === 1) {
        const along = (wx - tcx) * ax + (wy - tcy) * ay;
        const perp = -(wx - tcx) * ay + (wy - tcy) * ax;
        if (Math.abs(along) <= TEE_HALF && Math.abs(perp) <= TEE_HALF) {
          cls = 7;
          teeInset = TEE_HALF - Math.max(Math.abs(along), Math.abs(perp));
        }
      }
      const [r, g, b] = palette[cls];

      // Real-asset turf grain (theme.turfGrainKey/roughGrainKey) replaces the
      // coded noise on fairway/rough only, tiled tighter on fairway (short
      // grass) than rough (long grass) — same downstream math either way.
      // Falls back to the procedural grain() until the image has decoded
      // (or if unset).
      let grainVal: number | null = null;
      if (cls === 1 && realGrain) {
        grainVal = sampleGrassGrain(theme.turfGrainKey!, wx, wy, fairwayTile);
      } else if (cls === 0 && roughKey) {
        grainVal = sampleGrassGrain(roughKey, wx, wy, roughTile);
      }
      // Real-photo grain gets its own, much stronger amplitude than the coded
      // fallback's noiseAmp/128 (±14%/±7% max) — that scale was tuned for the
      // procedural grain()'s narrow, capped [0,0.5) output, and even at full
      // strength barely survives the bake's mip/anisotropic blur at gameplay
      // distance. A real photo's re-centered per-texel detail (grassTexture.ts)
      // needs a much wider swing to actually read on screen. Coded fallback
      // (every other course) is untouched — this only applies when grainVal
      // is non-null, i.e. only when a real texture decoded.
      const realAmp = cls === 1 ? 0.85 : 1.25;
      let light =
        grainVal !== null
          ? 1 + (grainVal - 0.5) * realAmp
          : 1 + (grain(px, py) - 0.5) * (noiseAmp[cls] / 128);
      // Mow bands: a signed light↔dark brightness swing. Fairway (cls 1) runs on
      // the diagonal; rough/green run along the tee→pin axis. A real photo
      // texture already carries grain/pattern, so damp the coded stripes to
      // let it read instead of fighting it.
      const sw = stripeWidth[cls];
      if (sw > 0) {
        const along = cls === 1 ? wx * dax + wy * day : wx * ax + wy * ay;
        const contrast = grainVal !== null ? stripeContrast[cls] * 0.4 : stripeContrast[cls];
        light *= 1 + Math.sin((along / sw) * Math.PI) * contrast;
      }
      // Tee collar: a darker mown border framing the square pad.
      if (cls === 7 && teeInset >= 0 && teeInset < 7) light *= 0.72;
      // Edge darkening where the surface changes just ahead (crisper boundaries)
      if (classAt(wx + 3, wy) !== cls || classAt(wx, wy + 3) !== cls) light *= 0.82;
      // Water: subtle horizontal banding reads as ripples
      if (cls === 5) light *= 1 + Math.sin(wy * 0.18) * 0.045;
      // Sand: raked ripple lines (art bible: "small ripples, color variation")
      if (cls === 4) {
        light *= 1 + Math.sin((wx * 0.74 + wy * 0.52) * 1.15) * 0.065;
        if (sculpt > 0) {
          // Crossing rake set + radial darkening toward the bunker centre —
          // the flat painted disc reads as a raked, dished hollow.
          light *= 1 + Math.sin((wx * 0.61 - wy * 0.83) * 1.35) * 0.05 * sculpt;
          let d = 1;
          for (const bk of bunkers) d = Math.min(d, Math.hypot(wx - bk.cx, wy - bk.cy) / bk.maxR);
          light *= 1 - 0.12 * sculpt * Math.max(0, 1 - d);
        }
      }

      const i = (py * w + px) * 4;
      data[i] = Math.min(255, r * light);
      data[i + 1] = Math.min(255, g * light);
      data[i + 2] = Math.min(255, b * light);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Baked contact AO: a soft dark seam around dug features (bunkers, ponds)
  // grounds them in the turf instead of reading as painted patches.
  ctx.save();
  ctx.filter = 'blur(5px)';
  ctx.strokeStyle = 'rgba(8, 22, 10, 0.34)';
  ctx.lineWidth = 8 * scale;
  for (const hz of hole.hazards) {
    if (hz.type !== 'bunker' && hz.type !== 'water') continue;
    ctx.beginPath();
    hz.polygon.forEach(([x, y], i) => {
      const sx = (x + pad) * scale;
      const sy = (y + pad) * scale;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();

  // Baked ground shadows (sun-consistent): trees, then buildings
  bakeGroundShadows(ctx, hole, theme, pad, scale);

  return canvas;
}

function bakeGroundShadows(
  ctx: CanvasRenderingContext2D,
  hole: HoleData,
  theme: CourseTheme,
  pad: number,
  scale: number
): void {
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
}

/**
 * High-resolution albedo patch for the raised green-complex mesh: green top,
 * fringe collar skirt, axis mow stripes and fine grain — baked at several
 * times the terrain texture's density so putting close-ups stay crisp.
 * The canvas covers the green ellipse + fringe + a small apron, axis-aligned
 * to the world (the mesh UVs map world position → patch position linearly).
 */
export function renderGreenPatch(
  hole: HoleData,
  theme: CourseTheme,
  engine: PhysicsEngine,
  margin: number,
  scale = 6
): { canvas: HTMLCanvasElement; x0: number; y0: number; w: number; h: number } {
  const g = hole.green;
  const reach = Math.max(g.rx, g.ry) + margin + 10;
  const x0 = g.cx - reach;
  const y0 = g.cy - reach;
  const wWorld = reach * 2;
  const w = Math.round(wWorld * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = w;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, w);
  const data = img.data;

  const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const cols: Record<string, [number, number, number]> = {
    green: rgb(theme.greenLight),
    fringe: rgb(theme.fringe),
    sand: rgb(theme.sand),
    fairway: rgb(theme.fairway),
    rough: rgb(theme.rough),
    tee: rgb(theme.fairway),
    water: rgb(theme.water),
    trees: rgb(shade(theme.rough, 0.8))
  };
  const axis = Math.atan2(hole.pin.y - hole.tee.y, hole.pin.x - hole.tee.x);
  const ax = Math.cos(axis);
  const ay = Math.sin(axis);
  // Greenside sand painted by this high-res patch must match the main bake's
  // sculpting or a shading seam appears at the green-mesh skirt.
  const sculpt = theme.sandSculpt;
  const bunkers = hole.hazards
    .filter((z) => z.type === 'bunker')
    .map((z) => {
      const bcx = z.polygon.reduce((a, p) => a + p[0], 0) / z.polygon.length;
      const bcy = z.polygon.reduce((a, p) => a + p[1], 0) / z.polygon.length;
      const maxR = Math.max(...z.polygon.map((p) => Math.hypot(p[0] - bcx, p[1] - bcy)));
      return { cx: bcx, cy: bcy, maxR };
    });

  for (let py = 0; py < w; py++) {
    const wy = y0 + py / scale;
    for (let px = 0; px < w; px++) {
      const wx = x0 + px / scale;
      const surf = engine.surfaceAt(wx, wy);
      const [r, gr, b] = cols[surf] ?? cols.rough;
      let light = 1 + (grain(px, py) - 0.5) * (surf === 'green' ? 0.085 : surf === 'fringe' ? 0.11 : 0.14);
      if (surf === 'green') {
        // Tight, subtle mow stripes along the play axis
        const along = wx * ax + wy * ay;
        light *= 1 + Math.sin((along / 30) * Math.PI) * 0.075;
      }
      if (surf === 'sand' && sculpt > 0) {
        light *= 1 + Math.sin((wx * 0.74 + wy * 0.52) * 1.15) * 0.065;
        light *= 1 + Math.sin((wx * 0.61 - wy * 0.83) * 1.35) * 0.05 * sculpt;
        let d = 1;
        for (const bk of bunkers) d = Math.min(d, Math.hypot(wx - bk.cx, wy - bk.cy) / bk.maxR);
        light *= 1 - 0.12 * sculpt * Math.max(0, 1 - d);
      }
      // Crisp darker rim right at the green/fringe boundary anchors the collar
      if (surf === 'fringe' && engine.surfaceAt(wx + 1.2, wy) !== 'fringe') light *= 0.88;
      const i = (py * w + px) * 4;
      data[i] = Math.min(255, r * light);
      data[i + 1] = Math.min(255, gr * light);
      data[i + 2] = Math.min(255, b * light);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, x0, y0, w: wWorld, h: wWorld };
}
