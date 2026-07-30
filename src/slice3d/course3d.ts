import {
  AbstractMesh,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  FresnelParameters,
  HemisphericLight,
  InstancedMesh,
  Mesh,
  MeshBuilder,
  MirrorTexture,
  ParticleSystem,
  Plane,
  RenderTargetTexture,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexData
} from '../core/rendering/babylon';
import { PHYSICS } from '../config';
import { animTime, isFrozen } from '../core/debugFlags';
import { flag as featureFlag } from '../core/flags';
import {
  blobHash,
  bunkerFescueClusters,
  collectTreeBlobs,
  FESCUE_CLUSTER_JITTER,
  inTeePad,
  renderCourseCanvas,
  renderGreenPatch,
  TEXTURE_PAD,
  TreeBlob
} from '../core/rendering/CourseTexture';
import { loadModelInto } from '../core/rendering/gltf';
import { CHECKER_ROTATION, mowCheckerboard } from '../core/rendering/mowPattern';
import { CourseTheme, shade } from '../core/rendering/Theme';
import { greenBoundaryScale, pointInGreens, pointInPolygon, triangulatePolygonWithDepth } from '../utils/Geometry';
import { FRINGE_MARGIN, FRINGE_VISUAL, PhysicsEngine } from '../systems/PhysicsEngine';
import { DEFAULT_TREE_MIX } from '../systems/treeHitbox';
import { computeBoundary, DEFAULT_MARGIN, pointInBoundary } from '../systems/PlayableBoundary';
import { WALL_DEPTH } from '../systems/HeightField';
import { HoleData } from '../core/types';
import { AtmosphereKind, buildAtmosphere } from './atmosphere';
import { buildBreakDots } from './breakDots';
import { renderPacing } from './renderPacing';
import { renderQuality } from './qualityGovernor';
import { instanceHandle, NatureBatcher, PropHandle } from './natureBatch';
import {
  BUSH_KEYS,
  CONIFER_KEYS,
  FLOWER_KEYS,
  GRASS_KEYS,
  hash2,
  loadNaturePrototypes,
  NaturePalette,
  NatureProto,
  STONE_KEYS
} from './natureModels';

// DEFAULT_TREE_MIX (the quality forest-pack broadleafs used when a theme sets no
// treeKeys) is imported from systems/treeHitbox so the renderer and the collision
// species pick resolve the exact same default. Imported near the other systems
// imports at the top of the file.

/** 2D world (x, y) + height h → Babylon (y-up, world y becomes -z). */
export function w2b(x: number, y: number, h = 0): Vector3 {
  return new Vector3(x, h, -y);
}

const c3 = (hex: number): Color3 =>
  new Color3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

function mat(scene: Scene, name: string, diffuse: number, opts?: { emissive?: number; spec?: number }): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = c3(diffuse);
  m.specularColor = new Color3(opts?.spec ?? 0.03, opts?.spec ?? 0.03, opts?.spec ?? 0.03);
  if (opts?.emissive !== undefined) m.emissiveColor = c3(opts.emissive);
  return m;
}

/** Linear blend between two packed RGB colours. */
function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

/** `rgb(r,g,b)` for a packed colour — canvas fill strings. */
function rgbStr(hex: number): string {
  return `rgb(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255})`;
}

/** Smooth two-octave noise for cosmetic terrain undulation. */
function smoothNoise(x: number, y: number): number {
  return (
    Math.sin(x * 0.011 + Math.sin(y * 0.017) * 2) * 0.6 +
    Math.sin(y * 0.023 + Math.sin(x * 0.009) * 3) * 0.4
  );
}

/**
 * Fast integer hash -> 0..1, and the two-octave grain built on it — the same
 * pair `CourseTexture.ts` uses to paint the real ground's rough/fairway
 * grain. Not exported there (that module bakes a whole hole's classification
 * grid; this file's far-field tile below needs none of that setup), so
 * reproduced verbatim rather than threading a new export through for two
 * small pure functions.
 */
function texelHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
function grain(x: number, y: number): number {
  return texelHash(x, y) * 0.65 + texelHash(x >> 2, y >> 2) * 0.35;
}

/**
 * FAR-FIELD ROUGH TILE — for the groundSkirt/peakApron only, a small,
 * fixed-cost canvas built from the SAME grain + mown-direction-stripe recipe
 * that makes the real, close-up rough look like rough (owner, after a first
 * attempt that invented a cruder two-octave sine "blotch" instead of reusing
 * this: "why can you not just make that area look like the area around the
 * green and fairway does?"). Re-baking the real per-hole texture this far out
 * would cost either an enormous texture or the crispness of the actual
 * playing surface (`bakeScale`'s whole reason to exist) — but the RECIPE
 * costs nothing to reuse at a small, fixed size and tile.
 *
 * The contrast here is NOT a match to the real rough's numbers
 * (`noiseAmp[0]=36`, `stripeContrast[0]=0.055` in CourseTexture.ts) — a 1:1
 * match was tried and failed a live seam check: this ring sits square in the
 * scene's EXP2 fog falloff, which crushes contrast fast with distance (~95%
 * gone by ~4100 world units at the default haze), so real-ground parity
 * still read as a flat, textureless band well short of the backdrop. Each
 * caller boosts `noiseAmp`/`stripeContrast` past parity by the amount needed
 * to survive fog out to where ITS backdrop actually sits — see the skirt and
 * apron call sites below for the reasoning behind each multiplier.
 */
function makeFarFieldCanvas(
  size: number,
  tileWorld: number,
  noiseAmp: number,
  stripeWidth: number,
  stripeContrast: number
): HTMLCanvasElement {
  const texelWorld = tileWorld / size;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const px = (i / 4) % size;
    const py = Math.floor(i / 4 / size);
    let light = 1 + (grain(px, py) - 0.5) * (noiseAmp / 128);
    // Mown-direction banding, same shape as the real rough's stripe pass —
    // there's no tee->pin axis once you're off the hole, so a fixed diagonal
    // stands in; at this distance the direction read is what sells it, not
    // which way it runs.
    const alongWorld = (px + py) * texelWorld;
    const phase = Math.sin((alongWorld / stripeWidth) * Math.PI);
    const band = Math.tanh(phase * 2.4) / 0.9837;
    light *= 1 + band * stripeContrast;
    const v = Math.max(0, Math.min(255, 128 * light));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Procedural tiling normal map: fine turf grain that responds to the sun. */
function makeTurfNormalTexture(scene: Scene): DynamicTexture {
  const size = 128;
  const heightAtPx = (x: number, y: number): number =>
    Math.sin(x * 0.55 + Math.sin(y * 0.41) * 2.2) * 0.5 +
    Math.sin(y * 0.62 - Math.sin(x * 0.37) * 1.8) * 0.35 +
    Math.sin((x + y) * 0.23) * 0.15;
  const tex = new DynamicTexture('turfNormal', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = heightAtPx(x - 1, y) - heightAtPx(x + 1, y);
      const ny = heightAtPx(x, y - 1) - heightAtPx(x, y + 1);
      const len = Math.hypot(nx, ny, 2);
      const i = (y * size + x) * 4;
      img.data[i] = 128 + (nx / len) * 110;
      img.data[i + 1] = 128 + (ny / len) * 110;
      img.data[i + 2] = 128 + (2 / len) * 110;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Procedural tiling normal map for water wavelets (scrolled every frame). */
function makeWaterNormalTexture(scene: Scene): DynamicTexture {
  const size = 128;
  // Calm-pond wavelets: gentle, SEAM-LOCKED swells (integer cycles per tile so
  // the map wraps cleanly — the old field used non-tiling frequencies + a huge
  // ±2.6-rad phase whip on the vertical stripe, which read as a hard chevron/
  // zigzag herringbone, especially once the softer 0.62 reflection stopped
  // washing it out). Low amplitudes + a big flat-Z bias keep it glassy.
  const T = (Math.PI * 2) / size; // one full cycle spans the tile edge
  const heightAtPx = (x: number, y: number): number =>
    Math.sin(x * T * 2 + Math.sin(y * T * 2) * 0.6) * 0.6 +
    Math.sin(x * T * 3 + y * T * 2) * 0.35 +
    Math.sin((x - y) * T) * 0.25;
  const tex = new DynamicTexture('waterNormal', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = heightAtPx(x - 1, y) - heightAtPx(x + 1, y);
      const ny = heightAtPx(x, y - 1) - heightAtPx(x, y + 1);
      const len = Math.hypot(nx, ny, 2.4); // larger Z bias = flatter, softer ripples
      const i = (y * size + x) * 4;
      img.data[i] = 128 + (nx / len) * 60;
      img.data[i + 1] = 128 + (ny / len) * 60;
      img.data[i + 2] = 128 + (2.4 / len) * 60;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = 1.5; // bigger, slower-repeating wavelets (was 3)
  tex.vScale = 1.5;
  return tex;
}

export interface Course3D {
  sun: DirectionalLight;
  shadows: ShadowGenerator;
  /** The shared planar water reflection (waterReflect themes with a pond),
   *  frozen while the swing meter is live so its RTT can't hitch the bar. */
  waterMirror: MirrorTexture | null;
  /** Flagstick meshes — hidden while putting, like the pulled pin in EG. */
  pin: Mesh[];
  /** Translucent contour grid over the green, shown only while putting. */
  puttGrid: Mesh;
  /**
   * Cosmetic ground height (world units) at a world point — the raised green
   * plateau and tee platform. Physics stays flat; ball/golfer/aim visuals add
   * this so they sit on the built surfaces. Stage B replaces the flat interior
   * with a real heightfield behind this same seam.
   */
  groundHeightAt: (x: number, y: number) => number;
  /** Re-point the putt grid + break dots down the golfer→hole line for a putt
   *  from (ballX, ballY): one lattice axis runs at the cup, the other is the
   *  90° horizontal — how you read break. Call when a putt is addressed. */
  orientPuttAids: (ballX: number, ballY: number) => void;
  /** Resolves once every tree/bush/flower/grass instance for this hole has
   *  actually been planted (the chunked scatter drain has fully run) — wait
   *  on this before starting camera work that shows off the whole hole (the
   *  intro flyover), so nothing pops into view mid-sweep. */
  natureReady: Promise<void>;
  /** Resolves once the ground material's shader is compiled and the course can
   *  actually paint. Wait on this before lifting the loading veil / starting the
   *  flyover so the sky clearColor never shows through as a "blue screen" while
   *  the heavy ground shader compiles on the first frame. */
  groundReady: Promise<void>;
  /** Fade any tree canopy standing between the camera and the golfer so the
   *  character never disappears behind foliage the camera happens to be
   *  looking through (playtest: "trees near the camera block your view of
   *  your character"). Cheap to call every frame — the candidate list is
   *  pre-filtered to canopies near the golfer, and the fade itself only
   *  recomputes on a throttle while lerping every call for a smooth blend. */
  updateTreeOcclusion: (camPos: Vector3, golferPos: Vector3) => void;
  /** Re-capture ONE fresh frame of the parked-camera RTTs (water reflection +
   *  shadow map) then hold again — call when the aim/camera changes DURING the
   *  armed-idle freeze window (drag-to-aim) so the frozen reflection/shadows
   *  still track the new camera pose without paying the per-frame RTT cost. A
   *  no-op unless the pacing is currently frozen (parked at address / meter
   *  live), so ordinary flight/flyover frames are untouched. */
  refreshParkedRTTs: () => void;
  /** Force ONE fresh shadow-map capture, whatever the current freeze state.
   *  Call after anything that ADDS or moves a shadow caster while the map is
   *  frozen — the scatter drain finishing its planting is the case that
   *  matters, because the trees it merges register as casters mid-flyover and
   *  a map frozen before them would leave the whole hole's trees shadowless. */
  invalidateShadows: () => void;
  /** Drag-to-aim RTT pacing: `true` while a drag is reframing the camera every
   *  pointermove (run the parked RTTs at the live every-other-frame cadence
   *  instead of a forced fresh capture per move — the per-move captures were
   *  re-rendering mirror+shadows at input frequency); `false` at drag end
   *  (one fresh capture, then hold frozen). No-op when pacing isn't frozen. */
  aimDragRTTs: (dragging: boolean) => void;
  /** LIVE QUALITY SHEDDING. Drop what this hole is spending WITHOUT rebuilding
   *  it — the scene is already standing, and a tier change that only takes
   *  effect on the next hole is no help to a player stuck on this one. Cuts,
   *  in order of how much they buy: the water mirror (a whole second render
   *  pass), the shadow map's size and refresh cadence, and decorative scatter.
   *  One-way within a hole: the next build starts from the new tier. */
  shedQuality: (q: { shadowSize: number; staticShadows: boolean; waterReflectScale: number; scatterScale: number }) => void;
  /** Canopy occlusion candidates (world x,y + canopy radius). Exposed read-only
   *  for the Playwright fade guard — asserts trees register (a course with zero
   *  candidates can never fade, the Sable Bay palm regression). */
  occlusionCandidates: () => Array<{ x: number; y: number; r: number; parts: number }>;
}

/**
 * Frames between shadow-map regenerations while a drag-to-aim is live.
 *
 * Babylon's `refreshRate` is literally "render every Nth frame", so this is a
 * number of frames rather than one of the REFRESHRATE_ constants. Eight is
 * ~130 ms at 60 fps — below the threshold at which a slowly rotating figure's
 * shadow reads as lagging, and a quarter of the cost of the every-other-frame
 * cadence the mirror needs.
 */
const DRAG_SHADOW_FRAMES = 8;

/** Visual raise of the green plateau and the tee platform top (world units). */
const GREEN_RAISE = 0.55;
const TEE_TOP = 1.15;

/** Irregular-green "radius factor" — <=1 inside, grows outward; rotation-aware.
 *  Divides by the shared boundary wobble so the raised plateau (greenLift) follows
 *  the SAME undulating edge the physics surface test and the albedo bake use. */
function ellipseFactor(x: number, y: number, g: HoleData['green'], margin = 0): number {
  let px = x - g.cx;
  let py = y - g.cy;
  if (g.rot) {
    const c = Math.cos(-g.rot);
    const s = Math.sin(-g.rot);
    const rx0 = px * c - py * s;
    py = px * s + py * c;
    px = rx0;
  }
  const dx = px / (g.rx + margin);
  const dy = py / (g.ry + margin);
  const w = greenBoundaryScale(Math.atan2(py, px), g);
  return Math.sqrt(dx * dx + dy * dy) / w;
}

/** Green plateau lift profile shared by the plateau mesh and groundHeightAt.
 *  A lobed green (hole.green2) lifts the UNION: whichever lobe the point is
 *  deepest inside wins, so the two plateaus merge into one raised surface. */
function greenLift(x: number, y: number, hole: HoleData): number {
  let f = ellipseFactor(x, y, hole.green);
  let ref = hole.green;
  if (hole.green2) {
    const f2 = ellipseFactor(x, y, hole.green2);
    if (f2 < f) {
      f = f2;
      ref = hole.green2;
    }
  }
  if (f <= 1) return GREEN_RAISE;
  // Approximate world distance beyond the green edge, smooth over the fringe
  const beyond = (f - 1) * Math.min(ref.rx, ref.ry);
  const s = Math.min(1, beyond / FRINGE_VISUAL);
  const t = 1 - s * s * (3 - 2 * s); // smoothstep down
  return GREEN_RAISE * t;
}

/** Tee platform placement shared by the platform meshes and groundHeightAt. */
function teePlatform(hole: HoleData): { cx: number; cy: number; ax: number; ay: number; w: number; d: number } {
  const w = (hole.teeBox?.w ?? 26) * 0.68;
  const d = (hole.teeBox?.d ?? 18) * 0.68;
  const axis = Math.atan2(hole.pin.y - hole.tee.y, hole.pin.x - hole.tee.x);
  const ax = Math.cos(axis);
  const ay = Math.sin(axis);
  // Ball rests near the front edge of the pad
  return { cx: hole.tee.x - ax * d * 0.22, cy: hole.tee.y - ay * d * 0.22, ax, ay, w, d };
}

function onTeePlatform(x: number, y: number, hole: HoleData): boolean {
  const p = teePlatform(hole);
  const along = (x - p.cx) * p.ax + (y - p.cy) * p.ay;
  const perp = -(x - p.cx) * p.ay + (y - p.cy) * p.ax;
  return Math.abs(along) <= p.d / 2 && Math.abs(perp) <= p.w / 2;
}

/**
 * Build the full 3D hole: lit textured terrain (cosmetic elevation confined
 * to the rough so the flat 2D physics always matches the visible ground),
 * pond water, sky dome + sun + clouds, distant mountain ridge, instanced
 * low-poly trees, and the pin flag.
 */
/**
 * How many distinct cumulus sheets a painted sky ships, and therefore how many
 * `<style>_cumulus*.png` files must exist. Mirrored in
 * `scripts/convert-skies.mjs` (CUMULUS_VARIANTS) and gated in
 * `tests/unit/skyAssets.test.ts` — all three have to agree, and the test is
 * what notices when they do not.
 */
const CUMULUS_VARIANTS = 3;

export function buildCourse(
  scene: Scene,
  hole: HoleData,
  theme: CourseTheme,
  engine: PhysicsEngine
): Course3D {
  const pad = TEXTURE_PAD;
  const w = hole.world.width;
  const h = hole.world.height;
  // What this device has proved it can afford. Read ONCE per build so a tier
  // change mid-hole cannot leave one scene half-budgeted; the governor's next
  // effect lands on the next hole. See src/core/rendering/quality.ts.
  const quality = renderQuality();
  /**
   * THE COLOUR THE GROUND CARRIES OUT TO THE HORIZON — the course's own turf,
   * slightly darkened.
   *
   * Every plane in the far field resolves to this: the void floor, the peak
   * apron, the ground bake's own edge fade, and the walls that seal the gaps
   * between the backdrop hills. They used to be three different colours in three
   * different exposures, so the horizon was a stack of bands (owner: "a weird
   * yellow vale behind the playable area ... why can't you just continue the
   * actual course colors out to the horizon?"). One colour, and EXP2 fog carries
   * the whole far field into the haze over distance, which is what fog is for.
   */
  const groundFarC = theme.apronTint ?? shade(theme.rough, 0.9);
  /**
   * THE SKY DOME'S RADIUS — and therefore the hard limit on how far away any
   * backdrop is allowed to be.
   *
   * The dome is a real BACKSIDE sphere with `infiniteDistance: false`, so it is
   * depth-tested like any other mesh: anything further from the world centre
   * than this simply loses to it and the sky paints over it. It was 4500, and
   * the backdrops do not fit inside 4500. Measured, with the pin-relative
   * offsets the backdrop code actually uses:
   *
   *   - Wild Prairie h3's outer right-hand dune rows land at 4662-4970, so they
   *     were painted over from the right edge inward — the owner's "weird sky
   *     taking over the background sand hills on the right side";
   *   - Red Hollow h3's `rangeBackstop` sits at 4482, where the dome clips a
   *     16000-wide wall down to a visible half-window of ~1329 units. Under
   *     2700 of 16000 ever drew, and everything outside that window was raw
   *     sky — "sky bleeding through everywhere";
   *   - the massif CURTAIN layer (dy -1400..-1500, wMul 4.2) reaches ~4490, so
   *     its stretched wings ran through the dome surface.
   *
   * 6000 clears the furthest of them with room to spare, and costs nothing: the
   * dome is one unlit sphere covering the same screen pixels whatever its
   * radius, the camera's maxZ is 12000, and `applyFog = false` means its
   * shading does not depend on distance either.
   */
  const DOME_R = 6000;
  /** How far past the ground mesh's edge the far-field relief (groundSkirt)
   *  and the matching outer fescue scatter both reach — shared so the relief
   *  and what's planted on it agree on where the course stops and the haze
   *  begins. See `makeFarFieldCanvas` for why this ring's texture no longer
   *  matches the real rough's contrast 1:1. */
  const FAR_FIELD_REACH = 3200;
  /** World units per tile for the far-field ground canvas (`makeFarFieldCanvas`
   *  call sites) — shared so the groundSkirt ring and the peakApron plane
   *  behind it tile at the same physical frequency and meet without a step. */
  const FAR_TILE_WORLD = 350;
  /** Multiply any decorative-scatter GRID PITCH by this to reach the tier's
   *  density. Counts go as 1/step², so a 0.45x density is a 1.49x pitch.
   *  Trees, hazards and every collision hitbox are outside this — only the
   *  grass/heather/bloom cards thin, and only below tier 1. */
  const scatterPitch = 1 / Math.sqrt(quality.scatterScale);

  // ----------------------------------------------------------- lights & fog
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.62;
  hemi.groundColor = c3(theme.hemiGround ?? shade(theme.rough, 0.9));
  const sunFromRight = theme.sunX > 360;
  const sun = new DirectionalLight(
    'sun',
    new Vector3(sunFromRight ? -0.45 : 0.45, -1, -0.35).normalize(),
    scene
  );
  sun.intensity = 0.78;
  sun.position = w2b(hole.tee.x, hole.tee.y - 400, 600);
  // The 5th argument is `useRedTextureType`: a single-channel colour
  // attachment instead of RGBA16F. PCF reads the hardware depth-stencil
  // texture, not this attachment, so nothing changes visually — but the map
  // drops from 12 MiB to ~6 at tier 0 (8 MiB RGBA16F colour → 2 MiB R16F,
  // plus the unavoidable 4 MiB DEPTH32F), on every course, at every tier.
  // Found while inventorying the owner's Pixel 8 graphics-memory crash.
  const shadows = new ShadowGenerator(quality.shadowSize, sun, undefined, undefined, true);
  shadows.usePercentageCloserFiltering = true;
  shadows.darkness = 0.35;

  scene.clearColor = Color4.FromColor3(c3(theme.skyBottom), 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  // hazeStrength scales atmospheric depth around the long-standing default
  // density (0.5 -> exactly the historical 0.00042).
  scene.fogDensity = 0.00042 * (theme.hazeStrength / 0.5);
  scene.fogColor = c3(theme.haze);

  // ---------------------------------------------------------------- terrain
  const ground = MeshBuilder.CreateGround(
    'ground',
    { width: w + pad * 2, height: h + pad * 2, subdivisions: 140, updatable: true },
    scene
  );
  ground.position = new Vector3(w / 2, 0, -h / 2);
  // BOUNDED WORLD: the playable boundary governs where DETAIL (scatter/rocks)
  // is generated and where the off-course penalty applies — but the ground MESH
  // keeps the authored terrain everywhere (inside AND outside the boundary), so
  // authored cliffs, canyon walls and rim rocks stay correctly grounded (no
  // sinking, no floating) and read as the world's natural edge. Everything past
  // the rendered terrain is masked by the fogged void-floor plane + haze (built
  // below), so the compact world resolves as deliberate desert nothingness
  // rather than a blue map edge. (An earlier pass dropped the mesh into a trench
  // here; that sank the rim rocks and exposed the sky dome — removed.)
  const boundary = hole.boundary;
  /**
   * How far a world point lies OUTSIDE the padded ground rectangle, in world
   * units — 0 anywhere the real ground mesh covers.
   *
   * Chebyshev, not Euclidean, because that is the shape the far-field skirt
   * grows in: concentric rectangles expanding uniformly from this rectangle's
   * edge. The two have to agree or the scatter planted on the skirt sits at a
   * different height than the skirt itself.
   */
  const outsideBy = (wx: number, wy: number): number =>
    Math.max(0, -pad - wx, wx - (w + pad), -pad - wy, wy - (h + pad));
  /**
   * The far field's rolling relief at a world point: 0 over the real ground,
   * ramping in past its edge.
   *
   * THE ONE SOURCE OF TRUTH for the skirt's shape. The skirt mesh and every
   * fescue card planted out there read their height through this, so they
   * cannot disagree — a card grounded on a flat assumption floats or sinks the
   * moment the ground rolls.
   *
   * `engine.groundAt` is unaffected, so PHYSICS never sees any of it: this is
   * all outside the world rectangle, where no ball can finish (owner: "don't
   * introduce major playability issues").
   */
  const farLift = (wx: number, wy: number): number => {
    const e = outsideBy(wx, wy);
    if (e <= 0) return 0;
    // A sea course must not raise land past its shoreline — that ramp reads as
    // a false shore behind an island green.
    if (theme.backdrop === 'sea') return 0;
    const t = Math.min(1, e / 900);
    const ramp = t * t * (3 - 2 * t);
    return ramp * (7 + smoothNoise(wx * 0.6, wy * 0.6) * 4.5 + smoothNoise(wx * 0.17, wy * 0.17) * 9);
  };
  const heightAt = (wx: number, wy: number): number => {
    const terrain = engine.groundAt(wx, wy);
    // Bounded world: authored terrain out to the mesh edge, plus the far-field
    // roll beyond it. `farLift` is 0 over the whole padded ground, so every
    // ground-mesh vertex is exactly what it always was; it only has an effect
    // for points on the skirt (and for the scatter planted there).
    if (boundary) return terrain + farLift(wx, wy);
    // Playable interior: the authored heightfield (the SAME terrain physics
    // rolls on — engine.groundAt), plus scenery mounds that ramp up smoothly
    // beyond the world edge only.
    const dx = Math.max(-30 - wx, wx - (w + 30), 0);
    const dy = Math.max(-30 - wy, wy - (h + 30), 0);
    const out = Math.hypot(dx, dy);
    if (out <= 0) return terrain;
    // A sea-backdrop course must NOT raise a scenery mound beyond the world edge:
    // that ramp reads as a false shore ("a little green like it's land" behind an
    // island green). Keep the out-of-bounds ground flat so the extended ocean +
    // backdrop sea are all that shows on the horizon.
    if (theme.backdrop === 'sea') return terrain;
    const t = Math.min(1, out / 140);
    return terrain + t * (6 + smoothNoise(wx * 0.6, wy * 0.6) * 2.5 + smoothNoise(wx, wy) * 2.2);
  };
  let minMeshY = Infinity;
  ground.updateMeshPositions((positions) => {
    for (let i = 0; i < positions.length; i += 3) {
      const wx = positions[i] + w / 2;
      const wy = -(positions[i + 2] - h / 2) ;
      const y = heightAt(wx, wy);
      positions[i + 1] = y;
      if (y < minMeshY) minMeshY = y;
    }
  }, true);
  ground.receiveShadows = true;

  // BOUNDED WORLD: a large fogged "void floor" masks everything beyond the
  // rendered terrain so the compact world never exposes a blue sky-dome edge or
  // a rectangular map cutoff (playtest: "blue dead space in the background").
  // It reuses the sea-plane trick (applyFog = true) so its far reaches dissolve
  // into the course's own haze — desert/prairie holes read as hazy nothingness
  // past the authored cliffs and corridor. Placed just below the lowest terrain
  // so it never occludes an in-view canyon/blowout, and skipped on sea courses
  // (their ocean plane already owns the horizon).
  // ONE PLANE IN THE FAR FIELD, NOT TWO.
  //
  // A peaks course builds its own apron below, and this void floor is BIGGER
  // (16000 square against 16000x9000) — so it showed past the apron as a strip
  // of a different colour and a different fog depth between the treeline and the
  // hills. That strip is what survived every attempt to recolour it, and hiding
  // this mesh is what finally made the horizon read right (owner: "the picture
  // before that one looked good" — the frame with this hidden). The apron is
  // grown to this one's footprint below and does the whole job.
  if (boundary && theme.backdrop !== 'sea' && theme.backdrop !== 'peaks') {
    const voidFloor = MeshBuilder.CreateGround(
      'voidFloor',
      { width: 16000, height: 16000, subdivisions: 1 },
      scene
    );
    const floorY = (Number.isFinite(minMeshY) ? minMeshY : 0) - 5;
    voidFloor.position = new Vector3(w / 2, floorY, -h / 2);
    const vMat = new StandardMaterial('voidFloorMat', scene);
    // THE FAR-GROUND COLOUR, exposed to render as itself.
    //
    // This was `theme.haze` at a full diffuse plus a 0.55 emissive — 1.85x on an
    // up-facing plane, so a pale haze saturated every channel and painted a
    // near-white strip. And it is BIGGER than the peak apron (16000 square
    // against 16000x9000), so it showed past it as a band of a different colour
    // between the treeline and the hills. Isolating it by hiding meshes one at a
    // time is what finally identified it: hide the apron and the band stayed;
    // hide this and the ground ran clean to the mountains.
    //
    // 0.58 x 1.298 + 0.25 = 1.003, so it renders exactly `groundFarC` and fog
    // takes it to the haze from there.
    vMat.diffuseColor = c3(shade(groundFarC, 0.58));
    vMat.emissiveColor = c3(shade(groundFarC, 0.25));
    vMat.specularColor = new Color3(0, 0, 0);
    voidFloor.material = vMat;
    voidFloor.applyFog = true;
    voidFloor.receiveShadows = false;
    voidFloor.isPickable = false;
    voidFloor.freezeWorldMatrix();
  }

  // Adaptive bake resolution: the ground albedo bake is synchronous, so its
  // cost scales with the padded world area × scale². Capping the texel budget
  // keeps the per-hole build (the between-holes freeze) bounded even for a big
  // world — a wide links hole or a long par 5 — and, crucially, lets the
  // polished per-texel turf grain run on EVERY course without every hole
  // stalling like Timberline used to. Small holes still bake near the historical
  // scale 2; large ones ease down toward ~1.3. Near-field crispness is
  // unaffected: the green wears its own scale-6 patch and the ground carries
  // tiling detail + normal maps at gameplay-camera distance.
  //
  // THE BIGGEST ALLOCATION IN THE GAME. Measured across all eight courses this
  // bake lands on the budget every single time — ~2000² texels, 20.4 MB on the
  // GPU with mips, 2-4x the next largest texture in the scene. And a build pays
  // for it THREE times over: the source canvas (16 MB), the DynamicTexture's own
  // backing canvas (16 MB), then the upload. That transient ~52 MB spike lands
  // squarely between holes, which is exactly where the tab-death breadcrumb
  // below (main.ts `jg-building`) has been catching iOS reclaiming the page.
  // Scaling the budget by the device's quality tier is therefore the single
  // most valuable thing the governor does.
  const bakeArea = (w + pad * 2) * (h + pad * 2);
  const BAKE_TEXEL_BUDGET = 4_000_000 * quality.bakeScale;
  const bakeScale = Math.max(0.5, Math.min(2, Math.sqrt(BAKE_TEXEL_BUDGET / bakeArea)));
  const bakeT0 = performance.now();
  const courseCanvas = renderCourseCanvas(hole, theme, engine, bakeScale);
  // Expose the synchronous ground-bake cost so the perf gate can regression-test
  // it directly (the render-loop timer never sees the one-shot bake stall).
  (globalThis as { __lastBakeMs?: number }).__lastBakeMs = performance.now() - bakeT0;
  const courseTex = new DynamicTexture(
    'course',
    { width: courseCanvas.width, height: courseCanvas.height },
    scene,
    true
  );
  {
    // Babylon's ground UVs run v toward -z (increasing world y), while the
    // canvas paints world y downward — draw flipped so the albedo lands
    // exactly where surfaceAt() classified it. (Asymmetric holes made the
    // old un-flipped upload obvious: greens/bunkers painted mirror-image.)
    const c2 = courseTex.getContext() as CanvasRenderingContext2D;
    c2.save();
    c2.translate(0, courseCanvas.height);
    c2.scale(1, -1);
    c2.drawImage(courseCanvas, 0, 0);
    c2.restore();
  }
  courseTex.update(false);
  // Release the source canvas's backing store the moment its pixels are in the
  // texture. Two ~16 MB canvases were alive at once until GC happened to run,
  // and on a phone the collector is not what decides whether the tab survives
  // the next allocation. Zeroing the dimensions frees it deterministically.
  courseCanvas.width = 0;
  courseCanvas.height = 0;
  courseTex.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);
  courseTex.anisotropicFilteringLevel = 8;
  const groundMat = new StandardMaterial('groundMat', scene);
  groundMat.diffuseTexture = courseTex;
  groundMat.specularColor = new Color3(0.02, 0.03, 0.02);
  // Tiling detail map keeps near-field turf crisp where the baked albedo
  // alone would blur under magnification.
  const detailCanvas = document.createElement('canvas');
  detailCanvas.width = detailCanvas.height = 128;
  const dctx = detailCanvas.getContext('2d')!;
  const img = dctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const px = (i / 4) % 128;
    const py = Math.floor(i / 4 / 128);
    // Mean ~128 so the detail modulates without darkening the albedo
    const n = 122 + smoothNoise(px * 7.3, py * 7.3) * 16 + ((px * 374761393 + py * 668265263) % 29) * 0.45;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
    img.data[i + 3] = 255;
  }
  dctx.putImageData(img, 0, 0);
  const detailTex = new DynamicTexture('turfDetail', { width: 128, height: 128 }, scene, true);
  detailTex.getContext().drawImage(detailCanvas, 0, 0);
  detailTex.update(false);
  detailTex.wrapU = Texture.WRAP_ADDRESSMODE;
  detailTex.wrapV = Texture.WRAP_ADDRESSMODE;
  detailTex.uScale = 110;
  detailTex.vScale = 110;
  groundMat.detailMap.texture = detailTex;
  groundMat.detailMap.isEnabled = true;
  groundMat.detailMap.diffuseBlendLevel = 0.24;
  // Fine turf-grain normal map: near-field grass responds to the sun instead
  // of reading as a flat albedo (art bible: "nothing should appear flat").
  // A course opting into real turf art (theme.turfNormalKey) gets the
  // purchased grass-texture bump map loaded like any other asset texture —
  // no special preload needed (unlike the CPU-sampled grain, GPU texture
  // upload is already async); otherwise the coded sine-wave bump.
  const turfNormal = theme.turfNormalKey ? new Texture(theme.turfNormalKey, scene) : makeTurfNormalTexture(scene);
  turfNormal.uScale = 90;
  turfNormal.vScale = 90;
  turfNormal.level = 0.55;
  if (theme.turfNormalKey) {
    turfNormal.wrapU = Texture.WRAP_ADDRESSMODE;
    turfNormal.wrapV = Texture.WRAP_ADDRESSMODE;
  }
  groundMat.bumpTexture = turfNormal;
  ground.material = groundMat;

  /**
   * THE FAR-FIELD SKIRT — the rough, actually rolling back toward the hills.
   *
   * The owner has asked for this in five different wordings across four
   * passes, most recently: "I just want the background areas before those
   * things to not look like crap between the mountains/hills/horizon and the
   * back of the green." Every previous attempt answered with PAINT —
   * recolouring the flat apron plane, matching its grain, giving it a normal
   * map — and none of it worked, because past the ground mesh there was no
   * GEOMETRY: one 16000-square quad at `subdivisions: 1`, dead level, seen at
   * a grazing angle. A flat sheet reads as a flat sheet however it is painted.
   *
   * So: a ring of real rolling ground, from the mesh edge out to just short of
   * the (now closer) backdrops. A RING, not a bigger `TEXTURE_PAD`, for two
   * reasons. It never overlaps the playable terrain — no z-fighting, no
   * masking plane that could draw over a sunken green. And widening the pad is
   * a measured trap: the bake budget's 0.5 floor stops being a budget past
   * ~1000 of pad (4.0M texels → 10.2M at 2500, class grid ×12, near-field
   * albedo still halves, and the fixed 140 subdivisions drop to 44 units per
   * quad, losing the very relief this is for).
   *
   * COST, deliberately bounded (owner: "don't introduce ... graphic loading
   * issues"): ~10 shells × 144 points ≈ 3k triangles, ONE StandardMaterial
   * with the 128px detail canvas and NO normal map — the previous cut carried
   * the ground's bump texture out here and it was the single biggest line in
   * its frame cost, for relief the fog swallows anyway. The mesh is frozen,
   * casts no shadows, receives none, and is skipped entirely on sea courses
   * (their horizon is water, which is already correct).
   */
  if (theme.backdrop !== 'sea') {
    /** How far past the ground mesh's edge the real geometry reaches — just
     *  short of the pulled-in backdrops, so the hand-off happens where the
     *  ranges and the fog already own the frame.
     *
     * Raised from 1600: the flat `peakApron` quad picks up past this radius,
     * and on a warm-rough course (Wild Prairie #d8a94e, Maple Vale #cfa055)
     * that dead-level plane still read as a lake even after two rounds of
     * pure repaint (`6bd9a78`'s exposure/detail-map fix, this ring's own
     * introduction in `b4f08a5`) — this comment block's own conclusion was
     * "a flat sheet reads as a flat sheet however it is painted," but the
     * ring it justified only ever covered a third of the distance out to the
     * pulled-in backdrops. Pushing it most of the rest of the way there
     * removes the flat stretch for every peaks course, not just a retint of
     * the two that got reported — cooler-rough courses (Wildwood #5d6b3a)
     * were never broken, so they're unaffected either way. Shell count is
     * unchanged (same triangle budget); the squared spacing already goes
     * coarse near the outer edge, so the added ground is cheap and the ring
     * still gives way to fog before the backdrops themselves. */
    const SKIRT_OUT = FAR_FIELD_REACH;
    const SHELLS = quality.tier >= 2 ? 7 : 10;
    const AROUND = quality.tier >= 2 ? 96 : 144;
    const gx0 = -pad;
    const gy0 = -pad;
    const gx1 = w + pad;
    const gy1 = h + pad;

    /** A point on the padded ground rectangle expanded by `e`, at parameter
     *  `u` in [0,1) going round it. */
    const shellPoint = (u: number, e: number): [number, number] => {
      const x0 = gx0 - e;
      const y0 = gy0 - e;
      const x1 = gx1 + e;
      const y1 = gy1 + e;
      const sw = x1 - x0;
      const sh = y1 - y0;
      const per = 2 * (sw + sh);
      let d = u * per;
      if (d < sw) return [x0 + d, y0];
      d -= sw;
      if (d < sh) return [x1, y0 + d];
      d -= sh;
      if (d < sw) return [x1 - d, y1];
      d -= sw;
      return [x0, y1 - d];
    };

    /** The same height the ground mesh's outer vertices take, so the seam is
     *  watertight — that hard horizontal line behind Timberline West's second
     *  green was the whole complaint. See `farLift`. */
    const skirtY = (wx: number, wy: number): number => engine.groundAt(wx, wy) + farLift(wx, wy);

    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    for (let s = 0; s <= SHELLS; s++) {
      // Squared spacing: fine where it meets the real ground (so the seam is
      // smooth), coarse far out (where fog owns it anyway).
      const e = Math.pow(s / SHELLS, 1.7) * SKIRT_OUT;
      for (let a = 0; a <= AROUND; a++) {
        const [wx, wy] = shellPoint((a % AROUND) / AROUND, e);
        pos.push(wx, skirtY(wx, wy), -wy);
        // The detail map is the only texture on this surface, so the uv just
        // has to be continuous and world-scaled.
        uvs.push(wx / 220, wy / 220);
      }
    }
    const row = AROUND + 1;
    for (let s = 0; s < SHELLS; s++) {
      for (let a = 0; a < AROUND; a++) {
        const i0 = s * row + a;
        const i1 = i0 + 1;
        const i2 = i0 + row;
        const i3 = i2 + 1;
        idx.push(i0, i2, i1, i1, i2, i3);
      }
    }
    const skirt = new Mesh('groundSkirt', scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.uvs = uvs;
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, idx, normals);
    vd.normals = normals;
    vd.applyToMesh(skirt, false);
    // The apron's colour, grain and exposure — this surface and the apron
    // behind it must be the same ground, and the ground bake's own edge
    // already fades to exactly this colour (CourseTexture's FADE_SPAN), so all
    // three meet without a step.
    const skirtMat = mat(scene, 'groundSkirtM', shade(groundFarC, 0.58), { emissive: shade(groundFarC, 0.25) });
    skirtMat.specularColor = new Color3(0, 0, 0);
    // The FAR-FIELD tile (see `makeFarFieldCanvas`), not the ground's own weak
    // 128px detail multiplier — this ring is the ONLY texture this surface
    // carries (no baked albedo underneath), and it sits in the fog's fast
    // falloff, so it needs real contrast to still read as ground by the time
    // it reaches the backdrops. First pass (1.8x the real rough's numbers)
    // was verified too subtle at a live elevated camera check — a shallow
    // viewing angle compounds the fog crush with texture minification
    // (many world-units of grain compress into one screen pixel, and
    // trilinear filtering without anisotropy averages it toward flat), so
    // this needed to go further than fog math alone predicted. ~2.5x
    // (noiseAmp 36 -> 90, stripeContrast 0.055 -> 0.15).
    const skirtFarCanvas = makeFarFieldCanvas(512, FAR_TILE_WORLD, 90, 120, 0.15);
    const skirtDetail = new DynamicTexture('turfDetailSkirt', { width: 512, height: 512 }, scene, true);
    skirtDetail.getContext().drawImage(skirtFarCanvas, 0, 0);
    skirtDetail.update(false);
    skirtDetail.wrapU = Texture.WRAP_ADDRESSMODE;
    skirtDetail.wrapV = Texture.WRAP_ADDRESSMODE;
    // Anisotropic filtering: this ring is viewed at grazing angles (looking
    // nearly along the ground toward the horizon), where plain trilinear
    // filtering over-blurs a repeating tile far more than it would looking
    // straight down — the same reason the real ground's own bake sets this.
    skirtDetail.anisotropicFilteringLevel = 8;
    // The uv above is world/220, so a tile every FAR_TILE_WORLD world units is
    // 220/FAR_TILE_WORLD repeats per uv unit.
    skirtDetail.uScale = 220 / FAR_TILE_WORLD;
    skirtDetail.vScale = 220 / FAR_TILE_WORLD;
    skirtMat.detailMap.texture = skirtDetail;
    skirtMat.detailMap.isEnabled = true;
    // Much stronger than the ground's own 0.24 — this blend IS the ring's
    // only visible texture (no baked albedo underneath it), so it has to
    // carry the whole "this is ground, not a painted plane" read by itself,
    // against fog AND grazing-angle minification at once.
    skirtMat.detailMap.diffuseBlendLevel = 0.75;
    // ...AND THE SUN RESPONSE. Matching contrast and colour still leaves a
    // perfectly uniform Lambert sheet where the real ground carries a normal
    // map (`groundMat.bumpTexture`) — a dead-flat sheet right where the
    // normal-mapped ground stops is its own small seam. A fresh instance
    // (not `turfNormal` — its uScale is baked for the ground's own normalized
    // UV, and this ring's UV is world/220, so a shared instance would carry
    // the wrong scale for one of the two surfaces), world-tiled to the same
    // physical tile size (world-units-per-tile) as the ground's own
    // 90-repeats-per-width.
    const skirtNormal = theme.turfNormalKey ? new Texture(theme.turfNormalKey, scene) : makeTurfNormalTexture(scene);
    skirtNormal.wrapU = Texture.WRAP_ADDRESSMODE;
    skirtNormal.wrapV = Texture.WRAP_ADDRESSMODE;
    skirtNormal.uScale = (220 * 90) / (w + pad * 2);
    skirtNormal.vScale = (220 * 90) / (h + pad * 2);
    // Softer than the ground's 0.55: seen at grazing angles from hundreds of
    // units away, where a full-strength normal reads as noise.
    skirtNormal.level = 0.35;
    skirtMat.bumpTexture = skirtNormal;
    skirt.material = skirtMat;
    skirt.applyFog = true;
    skirt.receiveShadows = false;
    skirt.isPickable = false;
    skirt.freezeWorldMatrix();
  }

  // Compile the ground shader NOW (during the loading veil) instead of lazily on
  // the first visible frame. The ground material is heavy (bake diffuse +
  // detailMap + bumpTexture) and, until its shader is ready, the ground mesh is
  // skipped and the sky clearColor shows through as a "blue screen" on the
  // heaviest holes (Wildwood h1). `groundReady` resolves once the ground can
  // paint so the veil/flyover can wait for a rendered course. It never rejects —
  // a compile failure still resolves so nothing can hang on it.
  const groundReady: Promise<void> = groundMat
    .forceCompilationAsync(ground)
    .then(() => undefined)
    .catch(() => undefined);

  // ----------------------------------------------------- green complex mesh
  // The putting surface is BUILT, not painted: a gently raised plateau with a
  // fringe-collar skirt, wearing its own high-resolution texture patch so the
  // green stays crisp at putting-camera distance. Physics remains flat — the
  // ball/golfer add groundHeightAt() when rendered.
  {
    const ANG = 72;
    // Ring radii factors: flat top out to the green edge, then skirt rings
    // stepping across the fringe down to ground level (slightly below to tuck).
    // The top MUST be finely ringed: every vertex conforms to the heightfield
    // (pushVert adds groundAt), and a green sitting across an elevation skirt
    // (Port Johnson 3) bows the sparse old rings ([0, .45, .8, 1]) ~0.1–0.3
    // above the true terrain between samples — enough to bury the cup disc
    // (+0.06) and patches of the putt grid (+0.14) under the green mesh.
    const topT = Array.from({ length: 21 }, (_, i) => i / 20);
    const skirtS = [0.18, 0.45, 0.72, 1, 1.18];
    // ONE shared texture patch covers every lobe (renderGreenPatch sizes its
    // canvas to the union bbox), so a two-lobe green reads as one continuous
    // mown surface — the mow columns run unbroken across the waist.
    const patch = renderGreenPatch(hole, theme, engine, FRINGE_VISUAL + 8, 6);
    const patchTex = new DynamicTexture('greenPatch', { width: patch.canvas.width, height: patch.canvas.height }, scene, true);
    patchTex.getContext().drawImage(patch.canvas, 0, 0);
    patchTex.update(false);
    // Release the source canvas the moment its pixels are uploaded — the same
    // deterministic free the ground bake gets above, which this path forgot: a
    // 1452² patch is an ~8 MiB backing store, and on a phone the collector is
    // not what decides whether the tab survives the next allocation.
    patch.canvas.width = 0;
    patch.canvas.height = 0;
    patchTex.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);
    patchTex.anisotropicFilteringLevel = 8;
    const gm = new StandardMaterial('greenComplexMat', scene);
    gm.diffuseTexture = patchTex;
    gm.specularColor = new Color3(0.02, 0.03, 0.02);
    const greenNormal = makeTurfNormalTexture(scene);
    greenNormal.uScale = 26;
    greenNormal.vScale = 26;
    greenNormal.level = 0.45; // mown-smooth: subtler grain than the ground
    gm.bumpTexture = greenNormal;
    // Build one raised plateau from a boundary function `ringPoint(theta, scale,
    // beyond) → [wx,wy]`: `scale` shrinks the boundary toward the centre for the
    // flat-top rings, `beyond` pushes it outward (world px) for the fringe skirt.
    const buildPlateau = (name: string, center: [number, number], ringPoint: (theta: number, scale: number, beyond: number) => [number, number]): void => {
      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      const pushVert = (wx: number, wy: number, hgt: number): void => {
        positions.push(wx, hgt + engine.groundAt(wx, wy), -wy);
        uvs.push((wx - patch.x0) / patch.w, (wy - patch.y0) / patch.h);
      };
      // Center vertex + top rings at full raise, then skirt rings stepping down.
      pushVert(center[0], center[1], GREEN_RAISE);
      const rings: Array<{ scale: number; beyond: number; h: number }> = [];
      for (const t of topT.slice(1)) rings.push({ scale: t, beyond: 0, h: GREEN_RAISE });
      for (const s of skirtS) {
        const beyond = s * FRINGE_VISUAL;
        const tt = Math.min(1, s);
        const fall = 1 - tt * tt * (3 - 2 * tt);
        rings.push({ scale: 1, beyond, h: s >= 1.15 ? -0.25 : GREEN_RAISE * fall });
      }
      rings.forEach((ring) => {
        for (let a = 0; a < ANG; a++) {
          const [wx, wy] = ringPoint((a / ANG) * Math.PI * 2, ring.scale, ring.beyond);
          pushVert(wx, wy, ring.h);
        }
      });
      // Fan from center to ring 0
      for (let a = 0; a < ANG; a++) indices.push(0, 1 + ((a + 1) % ANG), 1 + a);
      // Ring-to-ring quads
      for (let r = 0; r < rings.length - 1; r++) {
        const base0 = 1 + r * ANG;
        const base1 = 1 + (r + 1) * ANG;
        for (let a = 0; a < ANG; a++) {
          const a2 = (a + 1) % ANG;
          indices.push(base0 + a, base1 + a2, base1 + a);
          indices.push(base0 + a, base0 + a2, base1 + a2);
        }
      }
      const greenMesh = new Mesh(name, scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.uvs = uvs;
      vd.indices = indices;
      // Straight-up normals everywhere: the raised plateau must LIGHT like the
      // flat ground around it. Geometric normals made the sun-facing side of the
      // skirt blow out into a bright cream ring around every green (the aerial
      // "odd green" playtest report) and showed the skirt rings as facet bands.
      const normals: number[] = [];
      for (let i = 0; i < positions.length; i += 3) normals.push(0, 1, 0);
      vd.normals = normals;
      vd.applyToMesh(greenMesh);
      greenMesh.material = gm;
      greenMesh.receiveShadows = true;
    };

    if (hole.green2) {
      // Lobed green: ONE plateau traced from the ROUNDED metaball union (the same
      // shape the paint and physics already use) instead of two raw ellipses.
      // Two overlapping ellipse plateaus meet in two sharp concave "armpit" cusps
      // where their rims cross; the union has no such points (playtest: "the two
      // armpits come to a point — I'd rather they not"). The union is star-convex
      // about the main green centre, so a single-centre fan traces it exactly —
      // bisect pointInGreens for the boundary distance at each ring angle.
      const gc: [number, number] = [hole.green.cx, hole.green.cy];
      const reach =
        Math.hypot(hole.green2.cx - gc[0], hole.green2.cy - gc[1]) +
        Math.max(hole.green.rx, hole.green.ry, hole.green2.rx, hole.green2.ry) * 1.3 +
        FRINGE_VISUAL +
        8;
      const boundaryR: number[] = [];
      for (let a = 0; a < ANG; a++) {
        const theta = (a / ANG) * Math.PI * 2;
        const dx = Math.cos(theta);
        const dy = Math.sin(theta);
        let lo = 0;
        let hi = reach;
        for (let i = 0; i < 22; i++) {
          const mid = (lo + hi) / 2;
          if (pointInGreens(gc[0] + dx * mid, gc[1] + dy * mid, hole.green, hole.green2)) lo = mid;
          else hi = mid;
        }
        boundaryR.push(lo);
      }
      buildPlateau('greenComplex', gc, (theta, scale, beyond) => {
        const a = Math.round((theta / (Math.PI * 2)) * ANG) % ANG;
        const R = boundaryR[a] * scale + beyond;
        return [gc[0] + Math.cos(theta) * R, gc[1] + Math.sin(theta) * R];
      });
    } else {
      // Single-lobe green: the wobbled ellipse, unchanged. `scale` multiplies the
      // radii for the flat-top rings; `beyond` widens them for the fringe skirt.
      const g = hole.green;
      buildPlateau('greenComplex', [g.cx, g.cy], (theta, scale, beyond) => {
        const rxx = g.rx * scale + beyond;
        const ryy = g.ry * scale + beyond;
        const lx0 = Math.cos(theta) * rxx;
        const ly0 = Math.sin(theta) * ryy;
        const w = greenBoundaryScale(Math.atan2(ly0, lx0), g);
        const lx = lx0 * w;
        const ly = ly0 * w;
        const c = Math.cos(g.rot ?? 0);
        const s = Math.sin(g.rot ?? 0);
        return [g.cx + lx * c - ly * s, g.cy + lx * s + ly * c];
      });
    }
  }

  // ----------------------------------------------------------- tee platform
  // A tee that reads like a MOWED TEE, not a mini-golf mat: the top carries the
  // fairway colour with alternating mowing STRIPES (its own design, but of the
  // same turf family as the fairways), the sides fall away as a low turf bank
  // instead of a bright proud box, and real low tee-marker blocks flank the
  // front (not big golf-ball spheres).
  {
    const p = teePlatform(hole);
    const baseH = engine.groundAt(hole.tee.x, hole.tee.y);
    const rotY = Math.atan2(p.ay, p.ax);
    // Turf bank (sides): darker fairway shade so the pad grows out of the ground.
    const base = MeshBuilder.CreateBox('teeBase', { width: p.w, depth: p.d, height: TEE_TOP - 0.22 }, scene);
    base.material = mat(scene, 'teeBaseMat', shade(theme.fairway, 0.62));
    base.position = w2b(p.cx, p.cy, baseH + (TEE_TOP - 0.22) / 2);
    base.rotation.y = rotY;
    // Mowing-stripe top: a DynamicTexture of alternating fairway shades banded
    // across the pad, so the tee reads as professionally mown turf.
    const stripeTex = new DynamicTexture('teeStripeTex', { width: 96, height: 96 }, scene, true);
    {
      const g = stripeTex.getContext();
      const toCss = (n: number): string => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
      const bands = 6;
      for (let i = 0; i < bands; i++) {
        g.fillStyle = toCss(shade(theme.fairway, i % 2 ? 1.14 : 0.82));
        g.fillRect(0, (i * 96) / bands, 96, 96 / bands + 1);
      }
      stripeTex.update();
    }
    const topMat = mat(scene, 'teeTopMat', theme.fairway, { spec: 0.02 });
    topMat.diffuseTexture = stripeTex;
    const top = MeshBuilder.CreateBox('teeTop', { width: p.w + 0.8, depth: p.d + 0.8, height: 0.22 }, scene);
    top.material = topMat;
    top.position = w2b(p.cx, p.cy, baseH + TEE_TOP - 0.13);
    top.rotation.y = rotY;
    top.receiveShadows = true;
    shadows.addShadowCaster(base);
    // Real tee markers: low, flat turf-side blocks at the front corners.
    const markerMat = mat(scene, 'teeMarkerMat', 0xe8ddc4, { emissive: 0x3a362c, spec: 0.15 });
    for (const side of [-1, 1]) {
      const mx = hole.tee.x - p.ay * side * (p.w / 2 - 2.0);
      const my = hole.tee.y + p.ax * side * (p.w / 2 - 2.0);
      const marker = MeshBuilder.CreateBox(`teeMarker${side}`, { width: 1.1, depth: 1.1, height: 0.7 }, scene);
      marker.material = markerMat;
      marker.position = w2b(mx, my, baseH + TEE_TOP + 0.15);
      marker.rotation.y = rotY;
      shadows.addShadowCaster(marker);
    }
  }

  // Bunkers are drawn as plain painted sand (ripple texture + subtle dish in
  // the bake) — no raised lip tube and no dark AO ring (both removed on
  // playtest feedback: "get rid of the outlines around the bunkers"). A ball
  // that lands in one plugs dead (PhysicsEngine), so they read as simple sand.

  // ------------------------------------------------------------------ water
  // Art bible: water should be "one of the prettiest parts of every course" —
  // depth-tinted toward the middle, soft shore blend, animated wavelets
  // (scrolling normal map), and a fresnel sky sheen. All StandardMaterial +
  // vertex colors: no RTT reflections, mobile-safe.
  const waterNormalTex = makeWaterNormalTexture(scene);
  // Optional real planar reflections (theme.waterReflect): one shared mirror per
  // hole — every pond sits on the same y=level plane — kept mobile-friendly with
  // a low resolution, an every-other-frame refresh, and a render list curated to
  // the horizon silhouettes that actually read in a reflection.
  const reflectStrength = theme.waterReflectStrength ?? 0.62;
  // The mirror is a second full render of the scene's silhouettes every other
  // frame. A device that cannot hold 30 fps gets a softer one, and at the
  // cheapest tier none at all — the water keeps its depth tint, shore blend,
  // scrolling wavelets and fresnel sheen, which is what carries the look.
  const mirrorRatio = (theme.waterReflectRatio ?? 0.35) * quality.waterReflectScale;
  let waterMirror: MirrorTexture | null = null;
  /** The scatter batcher, hoisted out of the async planting closure so live
   *  quality shedding can reach it. It is created only once the nature
   *  prototypes resolve, so this stays null on a hole that never plants. */
  let batcherRef: NatureBatcher | null = null;
  /** Set once a mirror exists: rebuild its render list from the scene as it
   *  stands now. The fill loop below latches after a few stable frames (it
   *  cannot run forever), so the scatter drain calls this once when planting
   *  finishes to guarantee the final reflectable set — a straggler tree that
   *  landed after the latch otherwise never reflects. */
  let refreshMirrorList: (() => void) | null = null;
  let wi = 0;
  for (const hz of hole.hazards) {
    if (hz.type !== 'water') continue;
    const level = hz.level ?? 0.35;
    if (theme.waterReflect && mirrorRatio > 0 && !waterMirror) {
      waterMirror = new MirrorTexture('waterMirror', { ratio: mirrorRatio }, scene, false);
      waterMirror.mirrorPlane = new Plane(0, -1, 0, level);
      waterMirror.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES;
      // A light blur hides the low reflection resolution without smearing the
      // pines to mush; the scrolling bump map adds the ripple break-up.
      waterMirror.adaptiveBlurKernel = 4;
      waterMirror.renderList = [];
      // Reflected silhouettes: the sky dome, any backdrop peaks, the clouds
      // (mesh cloud* or the painted cumulus/cirrus billboards), and the
      // tree/scatter INSTANCES (nat*, NOT the parked natProto-* sources — a
      // MirrorTexture only draws instances that are themselves in the list). The
      // water meshes are excluded on purpose: listing them would feed the mirror
      // texture back into itself. Instances plant asynchronously (glb load), so
      // rebuild the list until their count stops growing, then latch.
      const isReflectable = (m: AbstractMesh): boolean => {
        const nm = m.name;
        if (nm === 'sky' || nm.startsWith('peak') || nm.startsWith('cloud') || nm.startsWith('cumulus') || nm.startsWith('cirrus')) {
          return true;
        }
        // Nature instances: only species tagged reflect=true (trees, cloud
        // meshes — see natureModels.ts) feed the mirror. At the low RTT ratio
        // plus adaptive blur, individual grass/flower/heather cards never
        // resolve anyway — they're pure re-render cost on a dense hole's
        // thousands of ground-scatter instances (the water-hole meter lag).
        if (nm.startsWith('nat') && !nm.startsWith('natProto')) {
          // Classic path: an instance carries the tag on its source. Batched
          // path (`natureBatching`): the batch mesh IS the drawable and copies
          // the prototype's metadata, so fall through to its own tag.
          const src = (m as InstancedMesh).sourceMesh ?? m;
          return src?.metadata?.reflect === true;
        }
        return false;
      };
      let lastCount = -1;
      let lastMeshCount = -1;
      let stable = 0;
      refreshMirrorList = (): void => {
        if (!waterMirror) return;
        const list = scene.meshes.filter(isReflectable);
        if (list.length === lastCount) return;
        lastCount = list.length;
        waterMirror.renderList = list;
        if (renderPacing.cameraParked) waterMirror.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      };
      const fillStart = performance.now();
      // Hard cutoff: on a bed-heavy hole (Wildwood's 17 garden beds cover a
      // combined ~140k sq units — many times any other course's scatter job)
      // the chunked popQueue/plantQueue drain can take far longer than the
      // "~1-2s of flyover" this loop was designed around, so total scene.mesh
      // count (and this loop's OWN full-array filter+realloc, itself an O(n)
      // per-frame cost) keeps changing for many seconds — the stable-count
      // self-removal never fires, so the loop (and the resulting mirror
      // re-render) runs at full per-frame cost the whole time. Force it off
      // once fully planted forests never take, so any straggler's reflection
      // is a one-frame-stale non-issue against an unbounded per-frame cost.
      const FILL_MAX_MS = 8000;
      const fill = scene.onBeforeRenderObservable.add(() => {
        if (!waterMirror) return;
        // The mirror is frozen while the meter is live (see perf pacing below),
        // so don't spend a per-frame scene.meshes.filter + array alloc rebuilding
        // a render list nothing will draw until the shot goes.
        if (renderPacing.meterActive) return;
        if (performance.now() - fillStart > FILL_MAX_MS) {
          scene.onBeforeRenderObservable.remove(fill);
          return;
        }
        // Instances are only ever ADDED during planting, so the reflectable
        // subset cannot change unless scene.meshes.length changes. Gate the O(n)
        // filter + array alloc on the total count: on the many frames between
        // instance bursts (mesh count static) we skip the scan entirely — the
        // per-frame cost the comment above warns about. Same renderList result.
        const meshCount = scene.meshes.length;
        if (meshCount === lastMeshCount) {
          // Instances arrive in one synchronous burst after the glb resolves;
          // once the count holds for a few frames the forest is fully planted.
          if (++stable > 4 && lastCount > 0) scene.onBeforeRenderObservable.remove(fill);
          return;
        }
        lastMeshCount = meshCount;
        const list = scene.meshes.filter(isReflectable);
        if (list.length === lastCount) {
          if (++stable > 4 && lastCount > 0) scene.onBeforeRenderObservable.remove(fill);
          return;
        }
        lastCount = list.length;
        stable = 0;
        waterMirror.renderList = list;
        // Shoreline trees plant asynchronously (~1-2 s of time-sliced drain +
        // glb load) — often AFTER the camera parks at address and freezes the
        // mirror to a single RENDER_ONCE capture. Without this, that frozen
        // reflection holds the frame it grabbed before the trees existed, so a
        // tarn reflects the sky/peaks but never the lakeside trees (owner: "the
        // trees are close enough to reflect — why don't they?"). Re-arm a fresh
        // one-shot capture whenever the reflectable set grows while parked, so
        // the newly-planted trees drop into the still reflection.
        if (renderPacing.cameraParked) {
          waterMirror.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
        }
      });
    }
    // Triangulate the ACTUAL hazard outline (earcut) rather than fanning from
    // the polygon's centroid — the fan assumes the shape is star-convex from
    // its center, which breaks for a winding/concave outline (a meandering
    // creek, a harbour inlet): the fan's triangles cut across dry land at
    // concave bends and leave gaps at the concavities, showing bare ground
    // through the water in patches ("water still doesn't look right").
    // triangulatePolygonWithDepth also locates one interior "deepest" point
    // (farthest from every edge) so the pond can still shade darker toward
    // its center and lighter toward the shore, same visual intent as before.
    const ring = hz.polygon;
    // Per-hazard colour override (a coastal course's freshwater creek reading
    // like a Timberline lake while the ocean keeps the theme's sea teal). Theme
    // colours are pre-parsed to ints; the raw hazard hex string is parsed here.
    const toNum = (s: string): number => parseInt(s.replace('#', ''), 16);
    const wHex = hz.water != null ? toNum(hz.water) : theme.water;
    const wDeepHex = hz.waterDeep != null ? toNum(hz.waterDeep) : theme.waterDeep;
    const { points, triangles, deepIndex } = triangulatePolygonWithDepth(ring);
    const positions: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const deep = c3(wDeepHex);
    // Per-vertex SHALLOW→DEEP gradient by true distance to the shoreline
    // (playtest: flat single-tint water "looked like blue paint"). The banks
    // read as bright translucent shallows that let a little of the bank/bottom
    // through; the interior deepens to the opaque tinted body — a real sense of
    // depth, the way the reference ponds carry it, instead of one painted sheet.
    const shallow = c3(shade(wHex, 1.14));
    const boundary = ring;
    const distToShore = (px: number, py: number): number => {
      let m = Infinity;
      for (let k = 0; k < boundary.length; k++) {
        const [ax, ay] = boundary[k];
        const [bx, by] = boundary[(k + 1) % boundary.length];
        const dx = bx - ax;
        const dy = by - ay;
        const L2 = dx * dx + dy * dy || 1;
        let t = ((px - ax) * dx + (py - ay) * dy) / L2;
        t = Math.max(0, Math.min(1, t));
        m = Math.min(m, Math.hypot(px - (ax + dx * t), py - (ay + dy * t)));
      }
      return m;
    };
    let maxD = 1;
    const vdepth = points.map(([x, y], i) => {
      const d = i === deepIndex ? distToShore(x, y) * 1.15 : distToShore(x, y);
      if (d > maxD) maxD = d;
      return d;
    });
    points.forEach(([x, y], i) => {
      positions.push(x, level, -y);
      uvs.push(x / 70, y / 70);
      const t = Math.min(1, Math.pow(vdepth[i] / maxD, 0.7)); // 0 shore .. 1 deep
      colors.push(
        shallow.r + (deep.r - shallow.r) * t,
        shallow.g + (deep.g - shallow.g) * t,
        shallow.b + (deep.b - shallow.b) * t,
        0.6 + 0.34 * t // translucent shallows, near-opaque depths
      );
    });
    const indices: number[] = triangles;
    const waterMesh = new Mesh(`water${wi++}`, scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.uvs = uvs;
    vd.colors = colors;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    vd.applyToMesh(waterMesh);
    waterMesh.hasVertexAlpha = true;
    const wm = new StandardMaterial(`waterMat${wi}`, scene);
    wm.diffuseColor = new Color3(1, 1, 1); // vertex colors carry the tint
    // With a live mirror the reflection carries most of the brightness, so the
    // baseline emissive drops to keep the depth tint readable underneath it.
    // Base glow kept LOW so the surface reads by its depth tint + sky reflection
    // + moving sun sparkle, not a flat self-lit sheet (the old 0.45 emissive was
    // most of why it looked painted-on).
    wm.emissiveColor = c3(shade(wDeepHex, waterMirror ? 0.22 : 0.34));
    // Bright, fairly tight sun sparkle so the scrolling wavelets throw moving
    // glints across the surface (kills the dead-flat paint read).
    wm.specularColor = new Color3(0.9, 0.96, 1);
    wm.specularPower = 64;
    wm.alpha = 1; // per-vertex alpha carries the shallow→deep translucency
    wm.bumpTexture = waterNormalTex;
    // A touch stronger than the old 0.4 so the wavelets actually catch the sun
    // (still soft — not embossed ridges).
    (wm.bumpTexture as Texture).level = 0.6;
    // The earcut winding direction follows the authored polygon's own winding
    // (not guaranteed same-handed as the old fan code assumed) — double-sided
    // so the surface is never accidentally backface-culled from above.
    wm.backFaceCulling = false;
    if (waterMirror) {
      // Fresnel: near-grazing (distant) water reads as a bright mirror; looked at
      // steeply (close) the reflection fades so the depth-tinted body shows —
      // how the reference ponds behave. The scrolling bump map ripples the mirror
      // so highlights shimmer instead of reading as a flat mirror sheet.
      wm.reflectionTexture = waterMirror;
      // Per-hazard reflectivity override: a pond fronting a conifer-backed green
      // mirrors the forest as a GREEN cast (Timberline East #3). Dropping THIS
      // body's reflect strength lets its blue depth-tint read instead, while the
      // theme default keeps other water (e.g. h2's tarn, where lakeside trees are
      // meant to reflect) fully mirrored.
      const hzReflect = (hz as { reflectStrength?: number }).reflectStrength ?? reflectStrength;
      const fr = new FresnelParameters();
      fr.bias = 0.18;
      fr.power = 2;
      fr.leftColor = new Color3(hzReflect, hzReflect, hzReflect);
      const dim = hzReflect * 0.22;
      fr.rightColor = new Color3(dim, dim, dim);
      wm.reflectionFresnelParameters = fr;
    }
    waterMesh.material = wm;
    const emissiveBase = waterMirror ? 0.22 : 0.34;
    scene.onBeforeRenderObservable.add(() => {
      const t = animTime();
      waterNormalTex.uOffset = t * 0.009;
      waterNormalTex.vOffset = t * 0.006 + Math.sin(t * 0.4) * 0.012;
      // Mutate the existing Color3 in place rather than allocating a fresh one
      // every frame (per-water-hole GC churn) — same `shade()` math, byte-identical.
      const shaded = shade(wDeepHex, emissiveBase + Math.sin(t * 1.3) * 0.05);
      wm.emissiveColor.set(((shaded >> 16) & 255) / 255, ((shaded >> 8) & 255) / 255, (shaded & 255) / 255);
    });
  }

  // Shared nature-prop palette. Defined BEFORE the first loadNaturePrototypes
  // call (the mesh clouds below) because the loader caches per-scene with the
  // palette of the first caller — the trees section reuses this same object.
  const natPalette: NaturePalette = {
    bark: theme.treeTrunk,
    foliage: theme.treeCanopy,
    foliageLight: theme.treeCanopyLight,
    grass: shade(theme.rough, 1.1),
    stone: theme.stoneTint ?? 0x7e7c72,
    grassLit: theme.lushGrass
  };
  // Only download the props this course's theme actually places (about half
  // the catalog) — both loadNaturePrototypes calls MUST share this set since
  // the loader caches per scene on the first call.
  const usesBlossom = (theme.blossomChance ?? 0) > 0 || hole.hazards.some((hz) => hz.type === 'trees' && hz.blossom);
  const natKeys = [
    ...new Set<string>([
      ...(theme.treeKeys ?? DEFAULT_TREE_MIX),
      ...(theme.accentTreeKeys ?? []),
      ...(theme.scatterKeys ?? []),
      ...(theme.bushKeys ?? BUSH_KEYS),
      ...(theme.cloudKeys ?? []),
      ...(theme.peakKeys ?? []),
      ...(theme.wasteRimKeys ?? []),
      ...STONE_KEYS,
      ...(theme.grassKeys ?? GRASS_KEYS),
      ...(theme.flowerKeys ?? FLOWER_KEYS),
      ...(theme.heatherKeys ?? []),
      ...(theme.shorelineKeys ?? []),
      ...(theme.sandPlantKeys ?? []),
      // Authored major landforms (hole.landforms — terrain identity pass).
      ...(hole.landforms ?? []).map((l) => l.key),
      // Solid collidable boulders ('rock' hazards) — rendered as grounded
      // prototypes at their collision centers.
      ...hole.hazards.filter((hz) => hz.type === 'rock').map((hz) => hz.key ?? 'rocks_red_bright'),
      // Blooms a hand-placed garden bed uses beyond the theme's ambient set.
      ...(hole.gardens ?? []).flatMap((g) => g.flowerKeys ?? []),
      // SPECIES A TREES HAZARD NAMES ITSELF. Without loading these the
      // prototype is missing at plant time, pickKeyed returns nothing and the
      // authored stand grows the theme's species instead — which is exactly
      // what made the hole builder's tree picker look broken.
      ...hole.hazards.flatMap((hz) => (hz.type === 'trees' ? (hz.treeKeys ?? []) : [])),
      // The real sakura model backs the blossom system wherever it's used
      // (see blossomProto below) — load it whenever this hole/course needs one.
      ...(usesBlossom ? ['tree_sakura'] : [])
    ])
  ];

  // -------------------------------------------------------------------- sky
  // Per-hole sky variation (V2, atmosphere flag): the same palette family
  // reads as a different moment of the day on every hole — the gradient
  // drifts a few percent lighter/darker and the cloud layout reshuffles.
  // Deterministic per hole number; flag off keeps the one shared sky.
  const skySeed = featureFlag('atmosphere') ? hole.number * 13.7 : 0;
  const skyDrift = featureFlag('atmosphere') ? (hash2(hole.number * 7.3, hole.number * 3.1) - 0.5) * 0.16 : 0;
  const skyTopHole = shade(theme.skyTop, 1 + skyDrift);
  const skyBottomHole = shade(theme.skyBottom, 1 + skyDrift * 0.5);
  const sky = MeshBuilder.CreateSphere('sky', { diameter: DOME_R * 2, sideOrientation: Mesh.BACKSIDE }, scene);
  sky.position = new Vector3(w / 2, 0, -h / 2);
  // A course with a painted sky style (theme.skyStyle) swaps the four-stop
  // gradient for its own measured, posterised ramp — same 8x256 texel budget,
  // so the dome costs exactly what it did. The per-hole drift survives as the
  // texture's `level`, which is the emissive shader's scalar multiplier
  // (vEmissiveInfos.y): the same "a few percent lighter/darker per hole" the
  // gradient got from shade(), without re-encoding the image.
  const skyMat = new StandardMaterial('skyMat', scene);
  if (theme.skyStyle) {
    // invertY FALSE, and it is not a detail. The DynamicTexture this replaces
    // uploads with `skyTex.update(false)` — no Y flip — so its canvas row 0
    // (the zenith stop) lands at v=0. A file Texture defaults to invertY TRUE,
    // which puts image row 0 at v=1 and hangs the whole dome upside down: the
    // pale horizon band ends up at the zenith where nothing can see it, and the
    // sky meets the fog on a mid-blue that does not match it. That is the
    // horizon seam this course set has already been through twice.
    const ramp = new Texture(`textures/sky/${theme.skyStyle}_ramp.png`, scene, false, false);
    ramp.wrapU = Texture.CLAMP_ADDRESSMODE;
    ramp.wrapV = Texture.CLAMP_ADDRESSMODE;
    ramp.level = 1 + skyDrift;
    skyMat.emissiveTexture = ramp;
  } else {
    skyMat.emissiveTexture = proceduralSkyRamp();
  }
  skyMat.disableLighting = true;
  skyMat.backFaceCulling = false;
  sky.material = skyMat;
  sky.applyFog = false;
  sky.infiniteDistance = false;

  /** The original coded dome gradient. Still the fallback for any course (and
   *  the daily hole) that names no sky style — byte-identical to what shipped. */
  function proceduralSkyRamp(): DynamicTexture {
    const skyTex = new DynamicTexture('skyTex', { width: 8, height: 256 }, scene, true);
    const sctx = skyTex.getContext();
    const grad = (sctx as CanvasRenderingContext2D).createLinearGradient(0, 0, 0, 256);
    const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
    if (theme.horizonTint !== undefined) {
      // Richer dome: an extra mid stop smooths the zenith falloff and a warm
      // band glows just above the treeline before dissolving into the haze.
      grad.addColorStop(0, hex(skyTopHole));
      grad.addColorStop(0.3, hex(shade(skyTopHole, 1.16)));
      grad.addColorStop(0.55, hex(shade(skyTopHole, 1.35)));
      grad.addColorStop(0.76, hex(skyBottomHole));
      grad.addColorStop(0.88, hex(theme.horizonTint));
      grad.addColorStop(1, hex(theme.haze));
    } else {
      grad.addColorStop(0, hex(skyTopHole));
      grad.addColorStop(0.55, hex(shade(skyTopHole, 1.35)));
      grad.addColorStop(0.8, hex(skyBottomHole));
      grad.addColorStop(1, hex(theme.haze));
    }
    (sctx as CanvasRenderingContext2D).fillStyle = grad;
    sctx.fillRect(0, 0, 8, 256);
    skyTex.update(false);
    return skyTex;
  }

  // Sun disc + clouds: emissive billboards high in the sky. The disc's colour
  // is the course's `sunTint` — measured off the source sky's solar aureole by
  // convert-skies.mjs — so a golden-hour course gets a bronze coin and an
  // alpine one a white star, instead of the one cream disc every course shared.
  const sunBillboard = MeshBuilder.CreatePlane('sunDisc', { size: 260 }, scene);
  const sunTex = new DynamicTexture('sunTex', { width: 128, height: 128 }, scene, true);
  const suctx = sunTex.getContext() as CanvasRenderingContext2D;
  const rg = suctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  const sunRGB = (c: number): string => `${(c >> 16) & 255},${(c >> 8) & 255},${c & 255}`;
  const sunCore = theme.sunTint !== undefined ? sunRGB(shade(theme.sunTint, 1.12)) : '255,252,220';
  const sunHalo = theme.sunTint !== undefined ? sunRGB(theme.sunTint) : '255,243,196';
  rg.addColorStop(0, `rgba(${sunCore},1)`);
  rg.addColorStop(0.35, `rgba(${sunHalo},0.85)`);
  rg.addColorStop(1, `rgba(${sunHalo},0)`);
  suctx.fillStyle = rg;
  suctx.fillRect(0, 0, 128, 128);
  sunTex.update(false);
  sunTex.hasAlpha = true;
  const sunMat = new StandardMaterial('sunMat', scene);
  sunMat.emissiveTexture = sunTex;
  sunMat.opacityTexture = sunTex;
  sunMat.disableLighting = true;
  sunBillboard.material = sunMat;
  sunBillboard.billboardMode = Mesh.BILLBOARDMODE_ALL;
  sunBillboard.position = w2b(
    hole.tee.x + (sunFromRight ? 900 : -900),
    hole.tee.y - 2600,
    1150
  );
  sunBillboard.applyFog = false;

  // A painted sky style brings its own cumulus/cirrus SHEETS, so a styled
  // course takes the billboard path — unless it has explicitly claimed the mesh
  // clouds (cloudKeys). Maple Vale is the one that does: real volumetric puffs
  // are its authored identity, and giving it the autumn dome should not quietly
  // delete them. skyStyle governs the DOME; the cloud SYSTEM is still the
  // course's own choice.
  if ((theme.skyStyle && !theme.cloudKeys) || theme.cloudStyle === 'wispy') {
    // Reference-style sky: soft, feathered, SEE-THROUGH clouds painted onto
    // billboards. The low-poly mesh clouds read as hard white blobs no amount
    // of stretching fixes, so this course paints its own. Two layers: soft
    // cumulus banked low near the treeline + thin cirrus streaks high across
    // the dome, drifting at different speeds for parallax.
    //
    // A feathered radial puff — the gradient falloff IS the soft edge. Built
    // in LOCAL space so the canvas transform places it correctly (an absolute-
    // coord gradient would land off-mesh once translated and fill clear).
    const puff = (ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, alpha: number): void => {
      const R = Math.max(rx, ry);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx / R, ry / R);
      // Denser core/mid with a still-feathered rim: firm enough to read as a
      // real cloud, soft enough not to be a hard-edged blob. Cirrus stays airy
      // via its low billboard opacity, not a softer gradient.
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.42, `rgba(255,255,255,${alpha * 0.6})`);
      g.addColorStop(0.75, `rgba(255,255,255,${alpha * 0.18})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    /**
     * One cloud layer's texture: the course's committed sheet if it has a sky
     * style, else the coded puff painting (identical dimensions, so this is a
     * straight swap and the VRAM cost does not move). The painter is a callback
     * precisely so a styled course never builds — and never has to dispose — a
     * canvas it would not use.
     */
    /**
     * CLOUD COLOUR, PER COURSE — the half of the painted skies that worked.
     *
     * The owner's verdict on Stage 6 was precise: "I'm liking the color changes
     * on the sky so they look unique but the clouds look bad." The DOME ramps
     * are measured off real skies and he likes them; they are untouched. The
     * cloud SHEETS were cut out of the same photographs, and cutting a
     * photographic cloud out of an equirect and posterising it produces —
     * reliably, on every source we tried — either a smooth ellipse with a lens
     * in the middle (Sable Bay's "soap bubbles"), a torn scrap with rectangular
     * blocks in it (Wildwood), or a grey smear (Timberline). None of them is a
     * cloud, and none of them belongs in a flat-shaded low-poly game anyway:
     * photoreal clouds are the wrong LANGUAGE for this art, which is why every
     * attempt to fix them by adjusting the posterise made a different bad cloud.
     *
     * A CC0 cloud pack was evaluated and rejected for the same reason — the ten
     * 2K alphas in OpenGameArt's fx_cloudalphas are VFX smoke plumes, which is
     * the exact word the owner used for what he did not want.
     *
     * So the shapes go back to the hand-painted `puff` cauliflower that shipped
     * before Stage 6 and that nobody ever complained about, and they take their
     * COLOUR from the course instead of from a photograph: lit toward the
     * course's own measured `sunTint`, shaded toward its own sky and haze. Wild
     * Prairie's clouds are gold-lit at its golden hour, Timberline's are cool,
     * Red Hollow's are storm-bruised — unique per course, which is the part he
     * asked to keep, with no photograph anywhere near them.
     */
    const cloudLit = mix(0xffffff, theme.sunTint ?? 0xffffff, 0.34);
    const cloudShade = shade(mix(theme.skyTop, theme.haze, 0.5), 0.82);
    /**
     * Give a painted cloud VOLUME: a top-lit, bottom-shaded ramp laid over the
     * silhouette in `source-atop`, so it tints only where the puffs already put
     * alpha. One gradient across the WHOLE sheet rather than one per blob —
     * per-blob shading makes each lump read as its own sphere, which is what the
     * photo pipeline's cel-shading pass did and why those sheets looked lumpy.
     */
    const shadeCloud = (ctx: CanvasRenderingContext2D, tw: number, th: number): void => {
      ctx.globalCompositeOperation = 'source-atop';
      const g = ctx.createLinearGradient(0, 0, 0, th);
      g.addColorStop(0, rgbStr(cloudLit));
      g.addColorStop(0.5, rgbStr(mix(cloudLit, cloudShade, 0.4)));
      g.addColorStop(1, rgbStr(cloudShade));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, tw, th);
      ctx.globalCompositeOperation = 'source-over';
    };
    /**
     * One cloud layer's texture: a committed CC0 silhouette, tinted for this
     * course, with the coded puff painting standing in until it loads.
     *
     * `sheet` is a GREYSCALE png — `scripts/convert-clouds.mjs` throws the
     * source photograph's grey-brown smoke colour away and keeps only the
     * shape, so luminance here IS the alpha. Turning it back into alpha and
     * laying the course's own lit/shade ramp over it happens in this one canvas
     * pass, which is why the five sheets can be SHARED by all eight courses and
     * still give each of them a different sky.
     *
     * Drawn synchronously first with `paint`, so the sky is never empty while
     * the image is in flight and a course with no committed sheet (the daily
     * hole) simply keeps the painted version.
     */
    const softCloudTex = (
      name: string,
      tw: number,
      th: number,
      paint: (ctx: CanvasRenderingContext2D) => void,
      sheet?: string,
      mirror = false
    ): Texture => {
      const tex = new DynamicTexture(`${name}Tex`, { width: tw, height: th }, scene, true);
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      /** Draw flipped when this is the mirrored copy. On the CANVAS, never by
       *  cloning the texture — see the note at the call site. */
      const flipped = (draw: () => void): void => {
        if (!mirror) {
          draw();
          return;
        }
        ctx.save();
        ctx.translate(tw, 0);
        ctx.scale(-1, 1);
        draw();
        ctx.restore();
      };
      ctx.clearRect(0, 0, tw, th);
      flipped(() => paint(ctx));
      shadeCloud(ctx, tw, th);
      tex.update(false);
      tex.hasAlpha = true;
      if (sheet) {
        const img = new Image();
        img.onload = () => {
          // The hole may have been torn down while this was loading; drawing
          // into a disposed texture's context throws.
          if (scene.isDisposed || !tex.getContext()) return;
          ctx.clearRect(0, 0, tw, th);
          flipped(() => ctx.drawImage(img, 0, 0, tw, th));
          const d = ctx.getImageData(0, 0, tw, th);
          for (let i = 0; i < d.data.length; i += 4) {
            const lum = d.data[i];
            d.data[i] = 255;
            d.data[i + 1] = 255;
            d.data[i + 2] = 255;
            d.data[i + 3] = lum;
          }
          ctx.putImageData(d, 0, 0);
          shadeCloud(ctx, tw, th);
          tex.update(false);
        };
        img.src = sheet;
      }
      return tex;
    };
    // Puffy cumulus: a rounded cauliflower mound — near-circular bumps all the
    // way around (domed crown on top, bumpy base below, shoulders on the sides)
    // so there's no flat top line and the whole silhouette reads soft & round.
    /**
     * A cumulus mound: a rounded cauliflower — near-circular bumps all the way
     * around (domed crown on top, bumpy base below, shoulders on the sides) so
     * there is no flat top line and the silhouette reads soft and round.
     *
     * THREE OF THEM, deterministically varied. One shared sheet on every
     * billboard was the "sable bay is just the same cloud on repeat" report, and
     * that part of the diagnosis was right even though the sheets themselves
     * were wrong: `v` re-proportions the mound (wider/taller, crown pushed left
     * or right, base bumps re-spaced) so the three read as different clouds in
     * the same weather. Same painter, so they cannot drift apart in style.
     */
    const cumulusShape = (v: number) => (ctx: CanvasRenderingContext2D): void => {
      const wide = 1 + (v - 1) * 0.16; // 0.84 / 1.00 / 1.16
      const tallish = 1 - (v - 1) * 0.12;
      const lean = (v - 1) * 34; // crown drifts off-centre
      const blobs: Array<[number, number, number, number, number]> = [
        [0, 0, 120, 104, 0.85], // core
        [-42 + lean, -60, 76, 70, 0.8], [42 + lean, -66, 80, 72, 0.82], [lean * 1.4, -86, 68, 62, 0.78], // domed crown
        [-98, -18, 88, 80, 0.8], [98, -20, 90, 80, 0.8], // upper flanks
        [-142, 22, 78, 70, 0.72], [142, 24, 80, 68, 0.72], // shoulders
        [-70, 58, 84, 68, 0.7], [72, 60, 86, 66, 0.7], [0, 70, 92, 64, 0.74] // rounded base bumps
      ];
      for (const [dx, dy, rx, ry, a] of blobs) {
        puff(ctx, 256 + dx * wide, 180 + dy * tallish, rx * wide, ry * tallish, a);
      }
    };
    const cumulusTex = softCloudTex('cumulus', 512, 320, cumulusShape(1), 'textures/sky/cloud_cumulus1.png');
    // Cirrus: a thin feathered streak that fades in and out along its length.
    const cirrusTex = softCloudTex('cirrus', 512, 96, (ctx) => {
      for (let i = 0; i < 30; i++) {
        const t = i / 29;
        puff(
          ctx,
          20 + t * 472,
          48 + Math.sin(t * 6) * 9,
          Math.abs(30 + 26 * Math.sin(t * 7 + 1.3)) + 12,
          Math.abs(5 + 4 * Math.sin(t * 5 + 0.6)) + 3,
          0.55 * (0.3 + 0.7 * Math.sin(t * Math.PI))
        );
      }
    }, 'textures/sky/cloud_cirrus1.png');
    const cloudMat = (name: string, tex: Texture): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.emissiveTexture = tex;
      m.opacityTexture = tex;
      m.disableLighting = true;
      m.backFaceCulling = false;
      return m;
    };
    /**
     * THREE CUMULUS SHEETS, NOT ONE.
     *
     * Every cumulus billboard shared a single StandardMaterial, so a sky "full
     * of clouds" was literally one cloud stamped six times — the owner's "sable
     * bay is just the same cloud on repeat". `scripts/convert-skies.mjs` now
     * cuts three different connected clouds out of each HDRI, so they share the
     * weather without sharing a silhouette.
     *
     * Only the painted-sky path has variants; the coded fallback keeps its one
     * canvas (it is the daily hole and any future styleless course, and
     * painting three canvases for it would cost more than it buys). Mirrored-U
     * copies double the count again for free — a flipped cloud is a different
     * cloud to the eye and costs one extra material, not one extra texture.
     */
    const cumulusMats: StandardMaterial[] = [];
    for (let v = 0; v < CUMULUS_VARIANTS; v++) {
      const tex =
        v === 0
          ? cumulusTex
          : softCloudTex(`cumulus${v + 1}`, 512, 320, cumulusShape(v + 1), `textures/sky/cloud_cumulus${v + 1}.png`);
      cumulusMats.push(cloudMat(`cumulusMat${v}`, tex));
      // A MIRRORED COPY, PAINTED — not `tex.clone()`.
      //
      // `DynamicTexture.clone()` in Babylon 9 allocates a new texture and
      // copies `hasAlpha`/`level`/`wrapU`/`wrapV` and NOTHING ELSE; it never
      // draws the source canvas. This file already documents that trap for the
      // peak apron, where a cloned detail map sampled (0,0,0,0) and turned the
      // far field into Maple Vale's "gross brown glass pond" — and the first
      // cut of these mirrors walked straight back into it. The clones were
      // blank AND permanently un-ready, so half the cumulus billboards drew
      // nothing and `scene.isReady(true)` stayed false for the whole hole,
      // which is also what made the capture harness hang.
      //
      // 512x320 twice is nothing; painting the flip is correct and cheap.
      const mirrorSheet = v === 0 ? 'textures/sky/cloud_cumulus1.png' : `textures/sky/cloud_cumulus${v + 1}.png`;
      cumulusMats.push(
        cloudMat(`cumulusMatF${v}`, softCloudTex(`cumulusF${v}`, 512, 320, cumulusShape(v + 1), mirrorSheet, true))
      );
    }
    // Two cirrus sheets, alternated. A single streak repeated across the dome is
    // the same "one cloud on repeat" complaint one layer up.
    const cirrusMats = [
      cloudMat('cirrusMat0', cirrusTex),
      cloudMat('cirrusMat1', softCloudTex('cirrus2', 512, 96, () => {}, 'textures/sky/cloud_cirrus2.png'))
    ];

    const drift: Array<{ mesh: Mesh; v: number }> = [];
    const wrapMin = hole.tee.x - 3600;
    const wrapMax = hole.tee.x + 3600;
    const span = wrapMax - wrapMin;
    const place = (mat: StandardMaterial, pw: number, ph: number, wx: number, wy: number, alt: number, vis: number, v: number, tag: string): void => {
      const cl = MeshBuilder.CreatePlane(tag, { width: pw, height: ph }, scene);
      cl.material = mat;
      cl.billboardMode = Mesh.BILLBOARDMODE_ALL;
      cl.position = w2b(wx, wy, alt);
      cl.applyFog = false;
      cl.visibility = vis;
      drift.push({ mesh: cl, v });
    };
    // How much sky the course's weather covers. 1 = the historical 6 cumulus +
    // 10 cirrus; an autumn overcast lid asks for more, an alpine bluebird day
    // for barely any. Clamped so a bad number in a course JSON can never plant
    // a hundred transparent billboards over a fill-rate-bound sky.
    const cover = Math.max(0.15, Math.min(2, theme.cloudCover ?? 1));
    const cumulusCount = Math.max(1, Math.round(6 * cover));
    const cirrusCount = Math.max(1, Math.round(10 * cover));
    for (let i = 0; i < cumulusCount; i++) {
      // Rounded cumulus mounds at varied heights (no flat band). Smaller and a
      // touch firmer than the softest pass so they read as real clouds.
      const j = hash2(i * 12.1 + skySeed, i * 4.7);
      const pw = 520 + j * 340;
      // Walk the variants rather than picking at random: 6 cumulus over 6
      // materials means a sky never repeats a sheet at all, and the same hole
      // always looks the same (the whole scene is seeded).
      const cm = cumulusMats[(i + Math.round(skySeed)) % cumulusMats.length];
      // 0.95, not 0.8. At 0.8 the CORE of every cloud was see-through, which is
      // what read as smoke rather than cloud (owner: "others are just too much
      // like smoke instead of clouds"). The softness belongs in the sheet's own
      // alpha, which already feathers the rim — a global multiplier thins the
      // rim and the core by the same amount, so it can only wash the cloud out.
      place(cm, pw, pw * (0.56 + j * 0.14), hole.tee.x - 2000 + i * (4000 / cumulusCount) + j * 260, hole.tee.y - 2600 - (i % 3) * 260, 430 + (i % 3) * 130 + j * 240, 0.95, 5 + j * 2.5, `cumulus${i}`);
    }
    for (let i = 0; i < cirrusCount; i++) {
      // Thin cirrus streaks — more of them, wide across the dome at varied
      // heights, kept low-opacity so they stay airy waves.
      const j = hash2(i * 7.9 + 2 + skySeed, i * 9.3);
      const pw = 860 + j * 540;
      // 0.72, not 0.5 — same reasoning as the cumulus above, kept lower because
      // cirrus IS thin. Airy, not absent.
      place(cirrusMats[i % cirrusMats.length], pw, pw * 0.1875, hole.tee.x - 3200 + i * (6400 / cirrusCount) + j * 280, hole.tee.y - 2900 - (i % 3) * 300, 780 + (i % 4) * 160 + j * 170, 0.72, 3.2 + j * 1.8, `cirrus${i}`);
    }
    scene.onBeforeRenderObservable.add(() => {
      if (isFrozen()) return;
      const dt = scene.getEngine().getDeltaTime() / 1000;
      for (const c of drift) {
        c.mesh.position.x += dt * c.v;
        if (c.mesh.position.x > wrapMax) c.mesh.position.x -= span; // gentle recycle
      }
    });
  } else if (theme.cloudKeys) {
    // Stylized volumetric cloud meshes from the forest pack. CLONES, not
    // instances — each clone must honor applyFog=false or the EXP2 fog at
    // sky distance washes them into the haze. Two altitude/depth layers with
    // different drift speeds sell parallax for almost nothing; count scales
    // with the theme's shape variety.
    const cloudDrift: Array<{ mesh: Mesh; v: number }> = [];
    const keys = theme.cloudKeys;
    // cloudCover works here too, so "how cloudy is this course" is one knob
    // whichever cloud system the course runs. Still capped at 10 — these are
    // mesh CLONES, not billboards, and each one is real geometry.
    const count = Math.min(10, Math.max(1, Math.round((4 + keys.length) * Math.min(2, theme.cloudCover ?? 1))));
    void loadNaturePrototypes(scene, natPalette, natKeys).then((protos) => {
      for (let i = 0; i < count; i++) {
        const proto = protos.get(keys[i % keys.length]);
        if (!proto) continue;
        const jitter = hash2(i * 17.3 + skySeed, i * 5.1);
        const far = i % 2 === 1; // alternate near/far bands
        const pos = w2b(
          hole.tee.x - 1700 + i * (3600 / count) + jitter * 220,
          hole.tee.y - (far ? 2900 : 2100) - (i % 3) * 300,
          (far ? 740 : 430) + ((i * 97) % 3) * 130 + jitter * 60
        );
        const targetH = (far ? 95 : 65) + jitter * 40;
        for (const part of proto.parts) {
          const cl = part.clone(`meshCloud${i}`);
          cl.position = pos.clone();
          const s = targetH / proto.height;
          cl.scaling = new Vector3(s * (1.4 + jitter * 0.9), s, s * 1.2);
          cl.rotation = new Vector3(0, hash2(i, 3) * Math.PI * 2, 0);
          cl.applyFog = false;
          cl.setEnabled(true);
          cloudDrift.push({ mesh: cl, v: far ? 2.5 : 4.5 });
        }
      }
    });
    scene.onBeforeRenderObservable.add(() => {
      if (isFrozen()) return;
      const dt = scene.getEngine().getDeltaTime() / 1000;
      for (const cl of cloudDrift) cl.mesh.position.x += dt * cl.v;
    });
  } else {
    const cloudMat = new StandardMaterial('cloudMat', scene);
    const cloudTex = new DynamicTexture('cloudTex', { width: 256, height: 128 }, scene, true);
    const cctx = cloudTex.getContext() as CanvasRenderingContext2D;
    cctx.clearRect(0, 0, 256, 128);
    cctx.filter = 'blur(10px)';
    cctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (const [ex, ey, rx, ry] of [[128, 74, 90, 26], [82, 58, 48, 20], [176, 56, 52, 20]]) {
      cctx.beginPath();
      cctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
      cctx.fill();
    }
    cloudTex.update(false);
    cloudTex.hasAlpha = true;
    cloudMat.emissiveTexture = cloudTex;
    cloudMat.opacityTexture = cloudTex;
    cloudMat.disableLighting = true;
    const clouds: Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const cl = MeshBuilder.CreatePlane(`cloud${i}`, { width: 420 + i * 60, height: 170 }, scene);
      cl.material = cloudMat;
      cl.billboardMode = Mesh.BILLBOARDMODE_ALL;
      cl.position = w2b(
        hole.tee.x - 1500 + i * 640,
        hole.tee.y - 2200 - (i % 3) * 300,
        760 + (i % 2) * 180
      );
      cl.applyFog = false;
      clouds.push(cl);
    }
    scene.onBeforeRenderObservable.add(() => {
      if (isFrozen()) return;
      const dt = scene.getEngine().getDeltaTime() / 1000;
      for (const cl of clouds) cl.position.x += dt * 6;
    });
  }

  // Ambient course life (V2 Phase 4 atmosphere — flag-gated, dev-on/prod-off).
  // Per-course presets (coastal gulls / forest butterflies+songbirds / alpine
  // hawks+mist) live in slice3d/atmosphere.ts; the theme's `atmosphere` key
  // picks the preset, defaulting to the shipped coastal gulls on sea-backdrop
  // courses. See docs/content/COURSE_ATMOSPHERE_BIBLE.md for budgets and
  // safety rules (parked-RTT, frozen captures, disposal, aim readability).
  if (featureFlag('atmosphere')) {
    const kind: AtmosphereKind = theme.atmosphere ?? (theme.backdrop === 'sea' ? 'coastal' : 'none');
    buildAtmosphere(scene, kind, { tee: hole.tee, pin: hole.pin }, w2b);
  }

  // ------------------------------------------------------------ backdrop
  //
  // CLOSER ON LAND, on the owner's explicit instruction: "I don't need assets
  // going all the way back ... you can even move those in closer if it makes
  // it easier. I just want the background areas before those things to not
  // look like crap between the mountains/hills/horizon and the back of the
  // green." At 2500 the gap between the last real ground and the first
  // mountain was 700-1100 yards of flat apron — an area no amount of paint
  // ever fixed. 1900 (then this pass's 1450) shrinks that gap further.
  //
  // A SECOND, independent reason to keep pulling this in: the massifs are
  // deliberately NOT fogged (`applyFog = false` on every massif clone,
  // below) — a prior attempt to fog them "washed them to near-haze at this
  // distance" and made the signature backdrop disappear instead of receding,
  // which is worse. The ground IN FRONT of them fogs correctly by real
  // distance (EXP2), and the far-field ground canvas above is now tuned to
  // still show real contrast out to about where this puts the mountains —
  // moving them in from 1900 gives that canvas less distance to survive
  // before the unfogged range takes over, on top of shrinking the apron
  // itself. The sea keeps 2500: its plane geometry and dune line are tuned to
  // it, its near edge is pinned relative to this number, and open water TO the
  // horizon is correct for a links course anyway.
  const peakDist = theme.backdrop === 'sea' ? 2500 : 1450;
  /**
   * A backdrop position, pulled in if it would fall OUTSIDE the sky dome.
   *
   * The sky is a BACKSIDE sphere of radius DOME_R centred on the world's
   * middle, so anything further from that centre is behind the dome's surface
   * and loses the depth test — the sky simply paints over it. The range
   * backstop is placed by pin-relative offsets, so on a long hole whose pin
   * sits far from the world centre it drifts out: Maple Vale lands at 4529 on
   * hole 1 and 4627 on hole 3, so on two of its three holes the wall that
   * exists to seal the saddle gaps never draws at all and sky-blue shows
   * through the mountains. The code has warned about exactly this since it was
   * written ("any farther and the sky mesh wins the depth test and the wall
   * never shows"); nothing enforced it.
   *
   * Scales the offset from the dome centre rather than clamping an axis, so a
   * pulled-in backstop stays on the same sightline — just nearer.
   */
  const backdropAnchor = (wx: number, wy: number, wz: number): Vector3 => {
    const pos = w2b(wx, wy, wz);
    const centre = new Vector3(w / 2, 0, -h / 2);
    const off = pos.subtract(centre);
    // 95% of the dome radius: enough margin that a fog-faded wall is never
    // grazing the surface at an oblique camera angle.
    const SAFE = DOME_R * 0.95;
    const d = off.length();
    return d <= SAFE ? pos : centre.add(off.scaleInPlace(SAFE / d));
  };
  // Resolves once the sailboat ship glb has swapped in (or immediately when
  // the hole has no boats / the load fails) — folded into the returned
  // natureReady so the intro flyover can't sweep past placeholder hulls that
  // pop into real ships mid-shot (Sable Bay h1 cold-load regression).
  let shipReady: Promise<void> = Promise.resolve();
  if (theme.backdrop === 'peaks') {
    // GROUND APRON for a peaks/dunes course. The 'sea' backdrop lays a huge
    // water plane so the world never ends in sky; a peaks course had none, so
    // past the small bounded world the pale sky dome showed BETWEEN the ground
    // and the distant dune line (owner: "what is the white space before the sand
    // hills. Get rid of that."). A large fogged ground plane at grade fills that
    // gap so the foreground reads as continuous sandy ground out to the dunes.
    // THE APRON CONTINUES THE GROUND, SO IT IS THE COLOUR THE GROUND ACTUALLY
    // ENDS ON — which is `theme.haze`, not the turf.
    //
    // Owner: "a weird yellow vale behind the playable area before the mountains
    // ... why can't you just continue the actual course colors out to the
    // horizon?" The answer turned out to be that the apron was never the colour
    // it was abutting. The ground bake runs a HORIZON HAZE FADE across its pad
    // skirt (CourseTexture's fadeTexel): weight 1 at 175 px out, so the ground's
    // outermost ~45 px of albedo is 100% `theme.haze`. The apron meanwhile took
    // `shade(rough, 0.9)` and then — like the sea plane before it was rebalanced
    // one function below — added a 0.5x EMISSIVE on top of a full-strength
    // diffuse. On Maple Vale that arithmetic saturates: 186*1.298 + 93 and
    // 144*1.298 + 72 both clamp, and the plane renders a flat #ffff8b. Literally
    // yellow. Wild Prairie clamps the same way; the darker green courses did not,
    // which is why only these two were ever reported.
    //
    // So the colour stays the COURSE'S OWN GROUND — the owner asked to "continue
    // the actual course colors out to the horizon", and the apron already has
    // `applyFog = true`, so fog fades it into the haze over distance all by
    // itself. What has to change is the EXPOSURE, so the plane renders AS that
    // colour instead of clamping: diffuse and emissive are pre-scaled to sum to
    // 1.0 under this scene's lighting (hemi 0.62 + sun 0.78 x N.L 0.86 = 1.298
    // on an up-facing plane). This is the same rebalance the sea plane got one
    // function below after it painted "a flat cyan stripe" along the horizon;
    // the apron simply never received it.
    const apronC = groundFarC;
    // 16000 square, centred on the WORLD — the footprint the void floor used to
    // cover, because on a peaks course this plane now IS the void floor (see the
    // note above it). At 16000x9000 behind the pin it left the void floor
    // showing around it, which is the band the owner kept seeing.
    const apron = MeshBuilder.CreateGround('peakApron', { width: 16000, height: 16000, subdivisions: 1 }, scene);
    // The apron is a flat backdrop plane; it must sit BELOW all in-play terrain
    // or it OCCLUDES anything that dips beneath it. Red Hollow h3's green is a
    // metaball plateau sunk in a −10 depression (green top ≈ −9.45): a fixed
    // apron at −4 drew straight over the sunken green, so from the approach/putt
    // cameras the whole putting surface read as flat sand-tan apron, not green
    // ("last green is still broken and brown"). Same lesson as the void floor
    // (§4a): a masking plane never overrides authored terrain. Anchor it just
    // under the lowest terrain vertex (minMeshY); it stays distant + fogged so a
    // couple of units either way is invisible on the horizon.
    //
    // This tracks the terrain in BOTH directions now. It used to be
    // `Math.min(-4, minMeshY - 2)` — a ceiling that only ever pushed the apron
    // DOWN. That is right for a course that dips (Red Hollow h3's sunken green,
    // which is why the clamp was added) and wrong for one that sits high: Maple
    // Vale h2/h3 have no authored point below +7, so the apron pinned at −4 sat
    // 11–26 units BELOW the playing surface and the finite ground mesh ended on
    // a vertical lip against a differently-coloured plane. That ledge is the
    // "doesn't meet the ground" seam.
    const apronY = minMeshY - 2;
    apron.position = new Vector3(w / 2, apronY, -h / 2);
    // 0.58 x 1.298 + 0.25 = 1.003 — the plane renders the authored colour, and
    // nothing in a warm palette can saturate a channel any more.
    const apronMat = mat(scene, 'peakApronM', shade(apronC, 0.58), { emissive: shade(apronC, 0.25) });
    apronMat.specularColor = new Color3(0, 0, 0);
    // ...AND THE SAME GRAIN THE GROUND WEARS. Matching the colour is only half
    // of "continue the actual course colors out to the horizon": a flat fill
    // beside a ground carrying a tiling detail map still reads as a painted
    // band, because the eye finds the edge where the texture stops, not where
    // the hue changes. Same 128px noise texture, re-scaled so its tiles are the
    // same WORLD size out here as they are underfoot — the ground runs 110
    // tiles across its padded width, so the apron needs that frequency over its
    // own 16000x9000. A clone rather than a second bake: 128 squared is nothing,
    // and uScale lives on the texture, not the material.
    //
    // NOT `detailTex.clone()`. In Babylon 9 `DynamicTexture.clone()` allocates a
    // new texture and copies `hasAlpha`/`level`/`wrapU`/`wrapV` and NOTHING ELSE
    // — it never draws the source canvas (dynamicTexture.pure.js). The clone
    // sampled (0,0,0,0), and the detail blend is
    // `base * 2 * mix(0.5, detail.r, 0.24)`, so a zero detail is a flat x0.76 on
    // diffuse. The apron rendered at exposure 0.822 instead of 1.003 — ~18%
    // DARKER than the ground bake's skirt, which fades to exactly this colour at
    // full exposure — and carried no grain at all. A dark, flat, untextured
    // plane meeting the turf on a dead-level line is what the owner reported as
    // Maple Vale's "gross brown glass pond"; every peaks course had it.
    //
    // So: paint the FAR-FIELD tile (see `makeFarFieldCanvas`), not the
    // ground's own weak 128px detail multiplier — the apron is seen from
    // much further away than the ground ever is, sitting deeper in the fog's
    // falloff than even the groundSkirt ring in front of it, so it needs MORE
    // headroom, not the same amount: ~3.3x the real rough's numbers
    // (noiseAmp 36 -> 120, stripeContrast 0.055 -> 0.2 — pushed past the
    // skirt's own boost after a live camera check showed even 2.5x still read
    // too flat at a grazing viewing angle). Same FAR_TILE_WORLD as the
    // groundSkirt, so the two meet without a step.
    const apronFarCanvas = makeFarFieldCanvas(512, FAR_TILE_WORLD, 120, 120, 0.2);
    const apronDetail = new DynamicTexture('turfDetailApron', { width: 512, height: 512 }, scene, true);
    apronDetail.getContext().drawImage(apronFarCanvas, 0, 0);
    apronDetail.update(false);
    apronDetail.wrapU = Texture.WRAP_ADDRESSMODE;
    apronDetail.wrapV = Texture.WRAP_ADDRESSMODE;
    // Anisotropic filtering, same reasoning as the skirt's: this plane is
    // seen at grazing angles, where plain trilinear filtering over-blurs a
    // repeating tile far more than it would looking straight down.
    apronDetail.anisotropicFilteringLevel = 8;
    apronDetail.uScale = 16000 / FAR_TILE_WORLD;
    apronDetail.vScale = 16000 / FAR_TILE_WORLD;
    apronMat.detailMap.texture = apronDetail;
    apronMat.detailMap.isEnabled = true;
    apronMat.detailMap.diffuseBlendLevel = 0.85;
    // ...AND THE SUN RESPONSE. Matching colour and grain still leaves a
    // perfectly uniform lambert sheet, because the ground carries a normal map
    // (groundMat.bumpTexture) and the apron carried none. Share the very same
    // texture instance — one upload, and it is disposed with the scene like any
    // other scene texture — at the apron's own world-matched frequency. The
    // bump's uv scale lives on the texture, so a shared instance cannot take a
    // second scale; a light clone of the coded normal is used when the course
    // has no purchased turf art, and the purchased one is re-loaded by key.
    const apronNormal = theme.turfNormalKey
      ? new Texture(theme.turfNormalKey, scene)
      : makeTurfNormalTexture(scene);
    apronNormal.wrapU = Texture.WRAP_ADDRESSMODE;
    apronNormal.wrapV = Texture.WRAP_ADDRESSMODE;
    apronNormal.uScale = (16000 * 90) / (w + pad * 2);
    apronNormal.vScale = (16000 * 90) / (h + pad * 2);
    // Softer than the ground's 0.55: this plane is seen at grazing angles from
    // hundreds of units away, where a full-strength normal reads as noise.
    apronNormal.level = 0.35;
    apronMat.bumpTexture = apronNormal;
    apron.material = apronMat;
    apron.applyFog = true;
    apron.isPickable = false;
    apron.freezeWorldMatrix();
  }
  if (theme.backdrop === 'sea') {
    // Links course: a broad sea plane meeting the sky at a low horizon,
    // with animated sparkle instead of a mountain range
    const sea = MeshBuilder.CreateGround('sea', { width: 14000, height: 8000, subdivisions: 1 }, scene);
    sea.position = w2b(hole.pin.x, hole.pin.y - peakDist - 1400, -8);
    const seaMat = new StandardMaterial('seaMat', scene);
    // The backdrop sea was badly overlit: full theme.water diffuse under
    // sun+hemi (combined ~1.4 on an upward-facing plane) PLUS a 0.7-shaded
    // emissive PLUS a broad grazing specular clamped G/B at 255 and painted a
    // hard saturated cyan band along the horizon of every sea-backdrop hole
    // (visual audit: "flat cyan stripe"). Rebalanced so the LIT total lands on
    // the same deep ocean blue the in-play water reads as, and the far edge
    // fades into haze via fog instead of blooming: darker diffuse, faint
    // emissive floor, and a tight high-power glint instead of plane-wide spec.
    seaMat.diffuseColor = c3(shade(theme.waterDeep, 0.75));
    seaMat.emissiveColor = c3(shade(theme.waterDeep, 0.28));
    seaMat.specularColor = new Color3(0.14, 0.15, 0.16);
    seaMat.specularPower = 220;
    sea.material = seaMat;
    sea.applyFog = true;
    // Low sandy dune line so the course doesn't end in a hard edge. An open-ocean
    // course (theme.seaDunes === false, e.g. Sable Bay's island in the sea) skips
    // it entirely so the horizon is nothing but flat blue water and sky.
    if (theme.seaDunes !== false) {
      const duneMat = mat(scene, 'dune', theme.sand, { emissive: shade(theme.sand, 0.6) });
      for (let i = -4; i <= 4; i++) {
        const d = MeshBuilder.CreateCylinder(
          `dune${i}`,
          { diameterTop: 0, diameterBottom: 900 + Math.abs(i) * 120, height: 90 + ((i * 29) % 40), tessellation: 5 },
          scene
        );
        d.material = duneMat;
        d.position = w2b(hole.pin.x + i * 560 + 90, hole.pin.y - peakDist + 260 - Math.abs(i) * 120, 20);
      }
    }
    // Decorative sailboats on the open sea behind the green (hole.sailboats).
    // A procedural low hull + mast + triangular sail is the instant
    // placeholder (same look as before); the uploaded ship model swaps in
    // once it loads and the placeholders are disposed — same positions/
    // rotations, so nothing shifts when it arrives.
    if (hole.sailboats && hole.sailboats > 0) {
      const hullMat = mat(scene, 'boatHull', 0x3a4756, { emissive: 0x1c2530 });
      // Sails forced UNAMBIGUOUSLY white (owner kept seeing them "solid brown"):
      // strongly self-lit so no sun angle darkens them, and double-sided so the
      // canvas reads white from behind too (a single-sided backface was reading
      // dark/absent when the boats sat with their sterns to the camera).
      const sailMat = mat(scene, 'boatSail', 0xffffff, { emissive: 0xe8e6de });
      sailMat.backFaceCulling = false;
      const mastMat = mat(scene, 'boatMast', 0x8a6a45);
      const boats: TransformNode[] = [];
      const placeholders: Mesh[] = [];
      // Sailboats must sit on WATER, not land (owner: "you put the ships on
      // land"). The old code placed them at a fixed offset behind the pin, which
      // on the coastal/island rebuilds lands over island terrain. Rejection-sample
      // each boat inside a real water hazard (surfaceAt === 'water'); fall back to
      // the old behind-the-green offset only if the hole has no water polygons.
      const waterRings = hole.hazards.filter((h) => h.type === 'water').map((h) => h.polygon);
      const waterBoxes = waterRings.map((r) => {
        const xs = r.map((p) => p[0]);
        const ys = r.map((p) => p[1]);
        return { r, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      });
      for (let i = 0; i < hole.sailboats; i++) {
        const t = hole.sailboats > 1 ? i / (hole.sailboats - 1) : 0.5;
        // Sail height in world units. Toned back from the old 8× (owner: the
        // galleon behind the island green was so big it HID the green + flag).
        // At ~3.2× the boats sit on the open sea a short way back, reading as
        // coastal boats without dominating the tee backdrop. Feeds both the
        // instant placeholder hull/mast/sail AND (via avgSc below, same formula)
        // the real ship model's normalizing scale, so nothing pops on swap-in.
        const sc = 3.6 * (34 + ((i * 37) % 12)); // owner: make the boats WAY larger
        // Keep the pair near the green's line (the tee/approach view is portrait,
        // so its horizontal field is narrow) but just off the island so they read
        // as boats sitting on the open sea a short way behind the green.
        let bx = hole.pin.x + (t - 0.5) * 170 + ((i * 53) % 60) - 30;
        let by = hole.pin.y - 360 - ((i * 71) % 170); // fallback: well behind the green
        // Keep decorative ships clear of the green. The behind-green water can lap
        // right up to the green's back edge (Sable Bay #2), so a large ship sampled
        // there anchors on water but visually sits ON the putting surface. Reject
        // any sample within a ship-sized margin of the green centre(s).
        const greenKeepout = Math.max(hole.green.rx, hole.green.ry) + 120;
        const clearOfGreen = (px: number, py: number): boolean =>
          Math.hypot(px - hole.green.cx, py - hole.green.cy) >= greenKeepout &&
          (!hole.green2 || Math.hypot(px - hole.green2.cx, py - hole.green2.cy) >= greenKeepout);
        // An authored spot wins outright: the hole placed this boat deliberately
        // (see HoleData.sailboatSpots), and second-guessing it would undo the
        // framing it exists for.
        const spot = hole.sailboatSpots?.[i];
        if (spot) {
          bx = spot[0];
          by = spot[1];
        } else if (waterBoxes.length) {
          for (let a = 0; a < 48; a++) {
            const box = waterBoxes[(i + a) % waterBoxes.length];
            const cx = box.minX + hash2(i * 7 + a * 3 + 1, a * 5 + 2) * (box.maxX - box.minX);
            const cy = box.minY + hash2(a * 5 + 3, i * 7 + a * 3 + 4) * (box.maxY - box.minY);
            if (pointInPolygon(cx, cy, box.r) && engine.surfaceAt(cx, cy) === 'water' && clearOfGreen(cx, cy)) {
              bx = cx;
              by = cy;
              break;
            }
          }
        }
        const yaw = (((i * 41) % 100) / 100) * Math.PI * 2;
        const boat = new TransformNode(`boat${i}`, scene);
        boat.position = w2b(bx, by, 0.35);
        boat.rotation = new Vector3(0, yaw, 0);
        boats.push(boat);
        const hull = MeshBuilder.CreateBox(
          `boatHull${i}`,
          { width: 0.95 * sc, height: 0.18 * sc, depth: 0.34 * sc },
          scene
        );
        hull.material = hullMat;
        hull.position = new Vector3(0, 0.09 * sc, 0);
        hull.parent = boat;
        placeholders.push(hull);
        const mast = MeshBuilder.CreateCylinder(
          `boatMast${i}`,
          { diameter: 0.035 * sc, height: 1.08 * sc, tessellation: 5 },
          scene
        );
        mast.material = mastMat;
        mast.position = new Vector3(0, 0.6 * sc, 0);
        mast.parent = boat;
        placeholders.push(mast);
        const sail = new Mesh(`boatSail${i}`, scene);
        const svd = new VertexData();
        svd.positions = [0.02 * sc, 0.16 * sc, 0, 0.02 * sc, sc, 0, 0.62 * sc, 0.2 * sc, 0];
        svd.indices = [0, 1, 2, 0, 2, 1]; // double-sided triangle
        const snorm: number[] = [];
        VertexData.ComputeNormals(svd.positions, svd.indices, snorm);
        svd.normals = snorm;
        svd.applyToMesh(sail);
        sail.material = sailMat;
        sail.parent = boat;
        placeholders.push(sail);
      }
      shipReady = loadModelInto('models/nature/ship.glb', scene)
        .then((container) => {
          // Null means the hole ended mid-load and the container disposed
          // itself; there is nothing left to add it to.
          if (!container) return;
          container.addAllToScene();
          const parts = container.meshes.filter((mm): mm is Mesh => mm instanceof Mesh && mm.getTotalVertices() > 0);
          if (!parts.length) return;
          // Hard-map the source PBR materials by luminance — the scan ships no
          // semantic naming, but its palette is cleanly separable: one bright
          // near-white slot (the sail/cloth) and several dark wood/trim tones.
          // Each raw part is instanced directly (no MergeMeshes): the source
          // primitives don't share one vertex-attribute layout (a bare-bones
          // sail plane vs. the hull's full attribute set), which MergeMeshes
          // requires — and at ~10 parts × 1-2 boats/hole, the extra draw
          // calls from skipping the merge are irrelevant.
          const shipHull = mat(scene, 'shipHull', 0x3a2a1c, { emissive: 0x1a120b });
          const shipTrim = mat(scene, 'shipTrim', 0xc9a876, { emissive: 0x6b5636 });
          const shipSail = mat(scene, 'shipSail', 0xffffff, { emissive: 0xe8e6de });
          shipSail.backFaceCulling = false;
          let minX = Infinity;
          let maxX = -Infinity;
          let minY = Infinity;
          let minZ = Infinity;
          let maxZ = -Infinity;
          for (const p of parts) {
            // Classify each part by MATERIAL NAME first (ship.glb ships named
            // hull / mast / mainsail / jib). The old luminance test read
            // `diffuseColor`, which is UNDEFINED on the PBRMaterial the glTF
            // loader actually creates — so every part scored luma 0 and fell
            // through to the brown hull, turning the whole boat brown IN THE
            // REAL GAME (software-GL renders only ever showed the white-sailed
            // placeholder, hiding it). Name match is GPU-independent; the
            // luminance path is kept as a fallback and now reads albedoColor
            // (PBR) as well as diffuseColor (Standard) for any future ship asset.
            const src = p.material as (StandardMaterial & { albedoColor?: Color3 }) | null;
            const nm = (src?.name ?? '').toLowerCase();
            const c = src?.diffuseColor ?? src?.albedoColor;
            const luma = c ? c.r * 0.3 + c.g * 0.59 + c.b * 0.11 : 0;
            p.material =
              /sail|jib|cloth|canvas/.test(nm) || luma > 0.5
                ? shipSail
                : /mast|trim|rope|rig/.test(nm) || luma > 0.2
                  ? shipTrim
                  : shipHull;
            // An InstancedMesh shares only the source's LOCAL vertex data —
            // the source's own parent-node transform (the glTF's "pirate
            // ship" root, here just an identity node, but not guaranteed by
            // every future ship asset) never composes into an instance. Bake
            // it into the vertices now (same effect MergeMeshes's world-matrix
            // bake has elsewhere in this file) so the world-space bounding
            // box computed below is what instances will actually render.
            p.bakeCurrentTransformIntoVertices();
            p.refreshBoundingInfo();
            const bb = p.getBoundingInfo().boundingBox;
            minX = Math.min(minX, bb.minimum.x);
            maxX = Math.max(maxX, bb.maximum.x);
            minY = Math.min(minY, bb.minimum.y);
            minZ = Math.min(minZ, bb.minimum.z);
            maxZ = Math.max(maxZ, bb.maximum.z);
            // Babylon only draws an instanced mesh's instances while its
            // SOURCE stays enabled — park it far below the course instead of
            // disabling it (same pattern as the nature prop prototypes).
            p.isPickable = false;
          }
          const length = Math.max(0.001, maxX - minX);
          const avgSc = 3.6 * (34 + (((hole.sailboats! - 1) * 37 * 0.5) % 12)); // owner: make the boats WAY larger (matches placeholder sc)
          const s = (0.95 * avgSc * 1.4) / length; // ship reads a touch longer than the old box hull
          // Instances don't inherit the source mesh's own transform — the
          // normalizing scale/centering has to go on each INSTANCE, same as
          // every prototype placement in this file (placeProto above).
          const cx = (minX + maxX) / 2;
          const cz = (minZ + maxZ) / 2;
          for (const boat of boats) {
            for (let i = 0; i < parts.length; i++) {
              const inst = parts[i].createInstance(`${boat.name}Model${i}`);
              inst.parent = boat;
              inst.scaling.setAll(s);
              inst.position = new Vector3(-cx * s, -minY * s, -cz * s);
              inst.freezeWorldMatrix();
            }
          }
          for (const p of parts) p.position.y -= 9000;
          placeholders.forEach((m) => m.dispose());
        })
        .catch(() => {
          /* keep the procedural placeholders if the model fails to load */
        });
    }
  } else if (theme.backdrop === 'none') {
    // No backdrop scenery: the dense conifer wall (backdropTreeStep) plus open
    // sky is the horizon — deliberately no ridges or feature peak (Timberline).
  } else {
    // Soft, ROUNDED low hills on the far horizon — the old pointed cone "ridge"
    // + Fuji peak read as hard triangle mountains, which playtest wanted gone.
    // Flattened, haze-tinted domes sit low behind the treeline so the horizon
    // reads as gentle rolling land, never a spiky range.
    // hillTint (optional theme knob): a desert course tints the domes
    // terracotta so the horizon reads as red-rock mesas instead of haze.
    const hillBase = theme.hillTint ?? shade(theme.skyTop, 1.06);
    const hillMat = mat(scene, 'hill', hillBase, {
      emissive: shade(theme.hillTint !== undefined ? theme.hillTint : theme.skyTop, 0.62)
    });
    if (theme.peakKeys?.length) {
      // Sourced mesa silhouettes (Kenney cliff models — playtest: "find red
      // mountain assets, not assets you create") instead of the procedural
      // domes. Fog at horizon distance washed the tint to pale haze, so the
      // mesas opt OUT of fog and pre-mix the haze into their color instead —
      // stable warm red-rock silhouettes with atmospheric depth per row.
      const peakKeys = theme.peakKeys;
      // Tinted-silhouette rows (the Wild Prairie sand dunes are the only user).
      // The haze-mix and emissive are kept LOW so the dunes stay a darker
      // yellow/brown/green blend (owner: they read too bright/washed) rather
      // than glowing pale cream under the warm haze.
      const rowMat = (t: number): StandardMaterial => {
        const c = mix(hillBase, theme.haze, t);
        const m2 = mat(scene, `mesaRow${Math.round(t * 100)}`, c, { emissive: shade(c, 0.34) });
        return m2;
      };
      const nearMat = rowMat(0.12);
      const farMat = rowMat(0.3);
      // PHOTO-textured massifs (theme peakKeys starting 'mountain', e.g. the
      // CC-BY red mountain) form the NEAR range with their real rock
      // textures; the tinted Kenney mesa silhouettes recede behind them.
      const texturedKeys = peakKeys.filter((k) => k.startsWith('mountain') || k.startsWith('canyon'));
      const tintedKeys = peakKeys.filter((k) => !k.startsWith('mountain') && !k.startsWith('canyon'));
      void loadNaturePrototypes(scene, natPalette, natKeys).then((protos) => {
        if (texturedKeys.length) {
          // Opaque terracotta backstop behind the deepest range layer: the
          // decimated diorama prims leave saddle gaps that showed SKY-BLUE
          // through the mountains at the horizon (playtest: "a blue layer in
          // the back behind the green before the mountain"). A warm wall
          // behind every layer turns any through-gap into hazy far desert.
          // Placement: just behind the deepest range layer, but INSIDE the
          // sky dome's surface distance (~4.8k on the horizon ray here) —
          // any farther and the sky mesh wins the depth test and the wall
          // never shows. Kept short enough that the far echo silhouettes
          // still rise above it.
          // Tall DOWNWARD: the terrain identity pass raised tees onto +8..15
          // benches, and an elevated camera sees over the finite ground
          // mesh's far edge — sky showed as a blue band UNDER the ranges
          // until the wall extended well below the horizon line.
          // Mixed from the far GROUND colour, not from `hillBase` — which is
          // the hill tint, and on a course that sets none (Maple Vale) falls
          // back to a shade of the SKY. A wall built out of sky-blue cannot
          // read as "far hazy ground"; it reads as another strip of sky sitting
          // on the horizon, which is the last band the owner could still see
          // after the apron was fixed. Half-way to the haze keeps it receding.
          const bsC = mix(groundFarC, theme.haze, 0.5);
          const bs = MeshBuilder.CreatePlane('rangeBackstop', { width: 16000, height: 600 }, scene);
          // EXPOSED to render the colour it was mixed to be. A full-strength
          // diffuse plus a heavy emissive saturates every channel on a warm
          // haze, so the wall that exists to read as "far hazy ground" painted a
          // near-white strip along the horizon instead — the same arithmetic
          // that clamped the apron to yellow. 0.58 x 1.298 + 0.25 = 1.003.
          const bsMat = mat(scene, 'rangeBackstopM', shade(bsC, 0.58), { emissive: shade(bsC, 0.25) });
          bsMat.backFaceCulling = false;
          bs.material = bsMat;
          // Top stays LOW (+60): the wall only seals the under-horizon gap —
          // any higher and its flat cream top shows above the range layers'
          // low saddles as a slab (playtest zoom). Bottom reaches -540 so
          // elevated tees can't see under it either.
          bs.position = backdropAnchor(hole.pin.x, hole.pin.y - peakDist - 1700, 0).add(
            new Vector3(0, -240, 0)
          );
          bs.applyFog = false;
          bs.freezeWorldMatrix();
          // These packs are full RANGE DIORAMAS (many peaks arranged by the
          // artist) — place each exactly ONCE, centered behind the green, so
          // the arrangement reads as authored. Multiple shifted instances
          // scattered diorama pieces across the sky (one slab ended up over
          // the tee camera).
          texturedKeys.forEach((key, ki) => {
            const proto = protos.get(key);
            if (!proto) return;
            // A diorama's origin is wherever its artist left it — often far
            // from the visual center (the first attempt floated the range in
            // the sky). Measure the combined geometry bounds and place BY
            // them: bounds center over the target point, bounds bottom sunk
            // just below the horizon ground line.
            let bmin: Vector3 | null = null;
            let bmax: Vector3 | null = null;
            for (const part of proto.parts) {
              const bb = part.getBoundingInfo().boundingBox;
              bmin = bmin ? Vector3.Minimize(bmin, bb.minimum) : bb.minimum.clone();
              bmax = bmax ? Vector3.Maximize(bmax, bb.maximum) : bb.maximum.clone();
            }
            if (!bmin || !bmax) return;
            // LAYERED RANGE, per-hole COMPOSITION (terrain identity pass:
            // "every hole must have a visibly different background
            // silhouette"): the same range diorama in a different
            // arrangement per hole — h1 a right-weighted low range (the
            // cliff side carries the view), h2 one dominant central massif
            // (the signature), h3 a long LOW mesa band (wide-stretched,
            // squat, flat-top skyline). Alternating mirroring + width
            // stretches keep repeats from reading as copies; all
            // bounds-centered and grounded.
            // Each composition ends in a full-width CURTAIN layer (wMul 4.5+
            // at the deepest allowed depth): a jagged mountain wall spanning
            // the whole horizon so no sky gap or flat backstop edge shows
            // between/beside the nearer layers — elevated tees (h2's +15
            // mesa) see over the short backstop otherwise.
            const holeMod = (hole.number - 1) % 3;
            const spots = key.startsWith('mountain_range')
              ? holeMod === 0
                ? // h1 — a DOMINANT right-weighted massif looms close behind
                  // the green (owner: "make the mountains more noticeable on
                  // one"), supporting ridges falling away left, a full-width
                  // curtain behind so the range reads deep.
                  [
                    { dx: 520, dy: 300, h: 430, mirror: false, wMul: 1.2 },
                    { dx: -1250, dy: -150, h: 320, mirror: true, wMul: 1.5 },
                    { dx: 1650, dy: -250, h: 340, mirror: false, wMul: 1.4 },
                    { dx: -300, dy: -1400, h: 260, mirror: true, wMul: 4.2 }
                  ]
                : holeMod === 1
                  ? // h2 — ONE DOMINANT CENTRAL MASSIF (the signature): the
                    // centerpiece dwarfs both flanks the way h1/h3's does, and
                    // the flanks themselves are asymmetric in both distance
                    // and height — mirror-equal dx (±1950, both close to the
                    // centre's own 430) was the actual bug (owner: "sky on
                    // two... takes over the background mountains"): two
                    // near-equal supporting peaks read as a competing pair,
                    // not support for a signature, and sat proportionally far
                    // wider than h1/h3's own flanks relative to this hole's
                    // smaller world. Pulled in and staggered to match.
                    [
                      { dx: 0, dy: 320, h: 430, mirror: false, wMul: 1.15 },
                      { dx: -1300, dy: -600, h: 250, mirror: true, wMul: 1.25 },
                      { dx: 1550, dy: -820, h: 275, mirror: false, wMul: 1.4 },
                      { dx: 250, dy: -1500, h: 245, mirror: false, wMul: 4.5 }
                    ]
                  : // h3 — a tall LEFT-weighted signature peak close behind the
                    // green (owner: "...and 3"), a second mass to the right, a
                    // deep curtain. Distinct silhouette from h1/h2.
                    [
                      { dx: -320, dy: 300, h: 440, mirror: true, wMul: 1.2 },
                      { dx: 1350, dy: -100, h: 320, mirror: false, wMul: 1.5 },
                      { dx: -1650, dy: -250, h: 300, mirror: true, wMul: 1.6 },
                      { dx: 220, dy: -1400, h: 255, mirror: false, wMul: 4.2 }
                    ]
              : // Non-range massif (e.g. the alpine peaks): owner note "too tall,
                // overlap a bunch" — a LOW range of many OVERLAPPING instances
                // (short h, wide wMul, close dx spacing so silhouettes merge into
                // a continuous ridgeline) instead of two tall isolated spikes.
                // Per-hole recomposition keeps repeats from reading as copies.
                //
                // Each of these ends in the same full-width CURTAIN layer the
                // range compositions use (wMul 4.3+ at the deepest depth). It
                // was missing here, so the only course on these keys — Maple
                // Vale — had five isolated massifs with open sky between and
                // beside them, and on two of its holes the backstop that would
                // otherwise have sealed the gaps was outside the sky dome too
                // (see backdropAnchor). Both halves of "the background to the
                // horizon on maple vale is terrible" met here.
                holeMod === 0
                ? [
                    { dx: -1450, dy: 40, h: 210, mirror: true, wMul: 1.9 },
                    { dx: -720, dy: -140, h: 250, mirror: false, wMul: 1.7 },
                    { dx: 40, dy: -40, h: 230, mirror: true, wMul: 1.8 },
                    { dx: 780, dy: -180, h: 270, mirror: false, wMul: 1.7 },
                    { dx: 1520, dy: -60, h: 220, mirror: true, wMul: 2.0 },
                    { dx: -200, dy: -1400, h: 190, mirror: false, wMul: 4.4 }
                  ]
                : holeMod === 1
                  ? [
                      { dx: -1400, dy: -120, h: 220, mirror: false, wMul: 1.9 },
                      { dx: -640, dy: -20, h: 250, mirror: true, wMul: 1.7 },
                      { dx: 120, dy: 90, h: 300, mirror: false, wMul: 1.6 },
                      { dx: 860, dy: -30, h: 245, mirror: true, wMul: 1.7 },
                      { dx: 1580, dy: -150, h: 215, mirror: false, wMul: 1.9 },
                      { dx: 150, dy: -1450, h: 185, mirror: true, wMul: 4.5 }
                    ]
                  : [
                      { dx: -1500, dy: -60, h: 200, mirror: true, wMul: 2.1 },
                      { dx: -760, dy: -170, h: 235, mirror: false, wMul: 1.8 },
                      { dx: 0, dy: -70, h: 215, mirror: true, wMul: 1.9 },
                      { dx: 760, dy: -190, h: 240, mirror: false, wMul: 1.8 },
                      { dx: 1520, dy: -50, h: 205, mirror: true, wMul: 2.1 },
                      { dx: -100, dy: -1500, h: 180, mirror: false, wMul: 4.3 }
                    ];
            for (let si = 0; si < spots.length; si++) {
              const spot = spots[si];
              const sMul = spot.h / proto.height;
              // ANCHORED, like the range backstop. The curtain layer reaches
            // ~4490 from the world centre and its wMul-4.2 wings reach further
            // still, so an unanchored massif could run through the dome even
            // now that DOME_R is 6000 — on a long hole with an off-centre pin.
            const anchor = backdropAnchor(hole.pin.x + spot.dx, hole.pin.y - peakDist + spot.dy, -35);
              // Mirroring negates local X, so the recentering offset's X
              // component flips sign with it. The width stretch widens each
              // layer so adjacent silhouettes overlap (high saddles between
              // instances let slivers of blue sky through) — and per-hole
              // compositions push it further (h3's 2x = squat mesa band).
              const sx = (spot.mirror ? -sMul : sMul) * (spot.wMul ?? 1.3);
              const off = new Vector3(
                ((bmin.x + bmax.x) / 2) * -sx,
                -bmin.y * sMul,
                -((bmin.z + bmax.z) / 2) * sMul
              );
              for (const part of proto.parts) {
                const cl = part.clone(`hillRange${ki}_${si}`);
                cl.position = anchor.add(off);
                cl.scaling = new Vector3(sx, sMul, sMul);
                // NO FOG ON A BACKDROP LAYER. Tried and reverted: fogging the
                // deepest curtain to give it atmospheric perspective washed it
                // to near-haze at this distance, so instead of receding it read
                // as a pale slab sitting on the ground between the darker
                // peaks. The curtain's job is to be an unbroken silhouette
                // behind the gaps; it does that best in the same material as
                // the layers in front of it.
                cl.applyFog = false;
                cl.setEnabled(true);
                cl.freezeWorldMatrix();
              }
            }
          });
        }
        // Tinted silhouette rows behind the textured range (or standalone
        // when a course lists only mesa keys).
        // Backstop for a TINTED-ONLY horizon (Wild Prairie's sand dunes): the
        // dunes are a tinted key so they never earned the textured range's
        // rangeBackstop, and sky-blue bled through the saddle gaps between the
        // low dune silhouettes (playtest: "get rid of the blue that bleeds
        // through"). A warm haze-mixed wall seals the gaps so any through-gap
        // reads as far dune haze, not blue sky. Kept low + narrow-tall like the
        // range backstop so its flat top never slabs above the dune crests.
        if (tintedKeys.length && !texturedKeys.length) {
          const bsC = mix(groundFarC, theme.haze, 0.22);
          // Kept LOW (top just under the dune crests) so it never slabs above
          // them — the sky gaps are sealed by DENSER, overlapping dune rows
          // (below) instead of a taller wall. Bottom still drops under the
          // horizon so no pale strip shows in front of the dune bases.
          const bs = MeshBuilder.CreatePlane('duneBackstop', { width: 16000, height: 520 }, scene);
          // EXPOSED to render the colour it was mixed to be. A full-strength
          // diffuse plus a heavy emissive saturates every channel on a warm
          // haze, so the wall that exists to read as "far hazy ground" painted a
          // near-white strip along the horizon instead — the same arithmetic
          // that clamped the apron to yellow. 0.58 x 1.298 + 0.25 = 1.003.
          const bsMat = mat(scene, 'duneBackstopM', shade(bsC, 0.58), { emissive: shade(bsC, 0.25) });
          bsMat.backFaceCulling = false;
          bs.material = bsMat;
          // backdropAnchor, not raw w2b — this wall is 16000 wide and the one
          // thing it must never do is stop short of the dunes it is sealing.
          bs.position = backdropAnchor(hole.pin.x, hole.pin.y - peakDist - 980, 0).add(new Vector3(0, -170, 0));
          bs.applyFog = false;
          bs.freezeWorldMatrix();
        }
        // Tinted silhouette rows. For the sand-dune horizon these are SHRUNK
        // (playtest: "shrink the sandhills in the horizon") — lower crests,
        // tighter spacing — so they read as distant rolling dunes, not a
        // looming range.
        // DENSER, overlapping silhouettes (tighter spread + more instances) so
        // the dune crests interlock and leave no sky gap to bleed through, while
        // staying the same shrunk crest height (owner liked the size).
        const rows: Array<{ dy: number; matr: StandardMaterial; hMul: number; count: number; spread: number }> = [
          { dy: 0, matr: nearMat, hMul: 1, count: 17, spread: 300 },
          { dy: 300, matr: nearMat, hMul: 1.1, count: 15, spread: 360 },
          { dy: 620, matr: farMat, hMul: 1.25, count: 13, spread: 430 }
        ];
        if (tintedKeys.length) rows.forEach((row, ri) => {
          const half = Math.floor(row.count / 2);
          for (let i = -half; i <= half; i++) {
            const proto = protos.get(tintedKeys[(((i + 12) * 5) + ri * 3) % tintedKeys.length]);
            if (!proto) continue;
            const j = hash2(i * 3.7 + 11 + ri * 7, i * 8.9);
            const targetH = (105 + Math.abs(i) * 15 + j * 70) * row.hMul;
            // THE SANDHILLS THE SKY WAS EATING. These rows spread up to
            // i*430 laterally from a pin that is itself off-centre, so on
            // Wild Prairie h3 (pin x 748 of a 1200-wide world) the outer
            // right-hand dunes measured 4662-4970 from the dome centre and
            // were painted over one by one from the edge inward. DOME_R now
            // clears them; anchoring keeps the guarantee on any future hole
            // whose pin sits further out still.
            const pos = backdropAnchor(
              hole.pin.x + i * row.spread + (j - 0.5) * 300 + 120,
              hole.pin.y - peakDist - 260 - row.dy - j * 160,
              -16
            );
            const sMul = targetH / proto.height;
            for (const part of proto.parts) {
              const cl = part.clone(`hillMesa${ri}_${i}`);
              cl.material = row.matr;
              cl.position = pos.clone();
              cl.scaling = new Vector3(sMul * (1.5 + j * 1.0), sMul, sMul * 1.2);
              cl.rotation = new Vector3(0, j * Math.PI * 2, 0);
              cl.applyFog = false;
              cl.setEnabled(true);
              cl.freezeWorldMatrix();
            }
          }
        });
      });
    } else {
      for (let i = -3; i <= 3; i++) {
        const dome = MeshBuilder.CreateSphere(`hill${i}`, { diameter: 1400 + Math.abs(i) * 260, segments: 10 }, scene);
        dome.material = hillMat;
        // Very flat (wide, low) so it's a soft swell, not a peak; parked far back.
        dome.scaling = new Vector3(1.4, 0.16 + ((Math.abs(i) * 7) % 5) * 0.01, 1);
        dome.position = backdropAnchor(hole.pin.x + i * 660 + 120, hole.pin.y - peakDist - 200 - Math.abs(i) * 120, -60);
      }
    }
  }

  // Decorative static props (hole.props — e.g. the wooden footbridge out to
  // Sable Bay h2's island green). Render-only: no physics footprint. The
  // model keeps its own textured materials (the wood IS the look); its long
  // axis is measured and scaled to the authored `len`, then yawed by `rot`.
  const propWaterPolys = (hole.hazards ?? []).filter((hz) => hz.type === 'water').map((hz) => hz.polygon);
  /**
   * AUTHORED MASSES A PROP MIGHT BE STANDING ON.
   *
   * Landforms and rock hazards are both grounded at `heightAt(x, y)` and rise
   * `h` from there (placeProto below). An upright prop was grounded at the very
   * same datum, so a rock authored UNDER a prop came up THROUGH it: Sable Bay's
   * lighthouse has three 13-16 unit boulders clustered within 11px of its
   * centre, and its own base flare is ~21px across at the authored scale, so
   * all three stood inside the tower (owner: "rocks inside of it rather than
   * under it"). The authoring comment in scripts/courses/sablebay_v2.mjs asks
   * for the opposite — "the lighthouse standing ON the rocks" — so the fix is
   * to let the prop stand on them, not to push the rocks aside.
   */
  const authoredMassList: Array<{ x: number; y: number; h: number }> = [
    ...(hole.landforms ?? []),
    ...hole.hazards
      .filter((hz) => hz.type === 'rock')
      .map((hz) => ({ x: hz.cx ?? 0, y: hz.cy ?? 0, h: hz.height ?? 10 }))
  ];
  /**
   * How far a mass lifts the ground at (x, y), above `heightAt`.
   *
   * A rock prototype is scaled uniformly to height `h`, and the stone meshes are
   * wide slabs rather than domes — measured, `stone_a/b/c` run 1.1-1.4x wider
   * than tall on the long axis and 0.58-0.80x on the short one, with a
   * deterministic random yaw. A parabolic dome of radius `h` is therefore only a
   * rough stand-in for the silhouette, which is exactly why the supporting mass
   * has to be authored as a RING that spans the prop's whole footprint rather
   * than one boulder under its centre: no seat height can close a gap where
   * there is simply no rock (see the skerry comments in
   * scripts/courses/sablebay_v2.mjs and portjohnson_v2.mjs).
   *
   * The 0.78 factor SEATS the prop into the mass rather than on its peak. A prop
   * resting on the highest point of an uneven plinth floats everywhere else;
   * bedded a couple of units in, the stones close around its base and the join
   * disappears. The lighthouse's flare is 4.5 units tall at the authored scale,
   * so it stays partly proud.
   */
  const massLiftAt = (x: number, y: number): number => {
    let lift = 0;
    for (const m of authoredMassList) {
      const r = Math.max(1, m.h);
      const d = Math.hypot(x - m.x, y - m.y);
      if (d >= r) continue;
      const t = 1 - (d / r) ** 2;
      lift = Math.max(lift, m.h * t * 0.78);
    }
    return lift;
  };

  for (const pr of hole.props ?? []) {
    // A fence must never march through water (Wildwood #3 ran its rail along the
    // creek and straight across it). Skip any fence post whose base sits inside a
    // water hazard, so the rail stops at the bank on each side and leaves the
    // crossing open instead of standing in the stream.
    if (pr.key === 'fence' && propWaterPolys.some((poly) => pointInPolygon(pr.x, pr.y, poly))) continue;
    void loadModelInto(`models/props/${pr.key}.glb`, scene)
      .then((container) => {
        // The hole was cut while this prop was loading — already disposed.
        if (!container) return;
        container.addAllToScene();
        const parts = container.meshes.filter((mm): mm is Mesh => mm instanceof Mesh && mm.getTotalVertices() > 0);
        for (const p of parts) p.bakeCurrentTransformIntoVertices();
        const merged = parts.length ? Mesh.MergeMeshes(parts, true, true, undefined, false, true) : null;
        if (!merged) return;
        merged.refreshBoundingInfo();
        const gh = heightAt(pr.x, pr.y);
        if (pr.upright) {
          // UPRIGHT props (lighthouse, bench, fence, boat): keep the model's
          // native Y-up orientation, scale UNIFORMLY so its LARGEST extent =
          // pr.len (height for a lighthouse, length for a boat, width for a
          // bench/fence — all read naturally), and rest the base ON the ground.
          const bb = merged.getBoundingInfo().boundingBox;
          const maxExt = Math.max(
            bb.maximum.x - bb.minimum.x,
            bb.maximum.y - bb.minimum.y,
            bb.maximum.z - bb.minimum.z
          ) || 1;
          const s = (pr.len ?? 20) / maxExt;
          merged.scaling = new Vector3(s, s, s);
          merged.rotation = new Vector3(0, pr.rot ?? 0, 0);
          // ...and rest that base on whatever authored mass is under it, not on
          // the bare terrain (see massLiftAt).
          merged.position = w2b(pr.x, pr.y, gh + massLiftAt(pr.x, pr.y) - bb.minimum.y * s);
        } else {
          // BRIDGE path: source packs arrive in arbitrary up-conventions (this
          // one stood its bridges on end), so orient by MEASURED extents: lay
          // the longest axis flat along local X (the span) before anything else.
          const bb0 = merged.getBoundingInfo().boundingBox;
          const ex = bb0.maximum.x - bb0.minimum.x;
          const ey = bb0.maximum.y - bb0.minimum.y;
          const ez = bb0.maximum.z - bb0.minimum.z;
          if (ey >= ex && ey >= ez) merged.rotation = new Vector3(0, 0, Math.PI / 2);
          else if (ez >= ex && ez >= ey) merged.rotation = new Vector3(0, Math.PI / 2, 0);
          merged.bakeCurrentTransformIntoVertices();
          merged.refreshBoundingInfo();
          const bb = merged.getBoundingInfo().boundingBox;
          const long = bb.maximum.x - bb.minimum.x || 1;
          const s = (pr.len ?? 60) / long;
          // Span scales to the authored length; HEIGHT and deck WIDTH cap in
          // absolute world units — stretching a small footbridge across 65yd
          // of water at uniform scale turned its railings into golfer-dwarfing
          // walls. Local Y is height, local Z the deck width (the yaw below
          // only reorients the span).
          const hExt = bb.maximum.y - bb.minimum.y || 1;
          const wExt = bb.maximum.z - bb.minimum.z || 1;
          const ys = Math.min(s, 8 / hExt);
          const zs = Math.min(s, 14 / wExt);
          merged.scaling = new Vector3(s, ys, zs);
          merged.rotation = new Vector3(0, pr.rot ?? 0, 0);
          // Deck at bank height: drop the underside just below the local
          // ground so the legs stand in the water on a crossing.
          merged.position = w2b(pr.x, pr.y, gh - bb.minimum.y * ys - 1.2);
        }
        merged.isPickable = false;
        merged.receiveShadows = false;
        shadows.addShadowCaster(merged);
        merged.freezeWorldMatrix();
      })
      .catch(() => {
        /* decorative — a failed load just means no prop */
      });
  }

  // ------------------------------------------------------------------ trees
  // Real prop meshes from the purchased Fantastic Nature pack replace the old
  // procedural cylinders/spheres. Loading is async (glb), so instances plant a
  // moment after the hole builds — like the character models. Positions come
  // from the same collectTreeBlobs() the baked texture drops shadows for, so
  // trunks land on their shadows. (Palette defined above the sky section.)
  const treeRoot = new TransformNode('nature', scene);
  // Canopy occlusion candidates registry: declared here (not inside the async
  // .then below) so updateTreeOcclusion can close over it and be returned
  // synchronously — the array is populated gradually as nature props load and
  // plant in, which the occlusion scan tolerates fine (it just sees more
  // candidates over time).
  const canopyOcclusion: Array<{ insts: PropHandle[]; x: number; y: number; r: number; mass?: boolean }> = [];
  // Static-scatter batching (`natureBatching`). Off = the classic one-
  // InstancedMesh-per-prop path, byte-identical.
  const batcher = featureFlag('natureBatching') ? new NatureBatcher(treeRoot) : null;
  batcherRef = batcher;
  // Resolves once every tree/bush/flower/grass instance has actually been
  // planted (the chunked plant/pop queue below has fully drained) — the
  // flyover waits on this so the sweep never outruns the scatter and shows
  // an empty course filling in mid-shot (playtest: "wasn't rendered until
  // halfway through the flyover"). Declared here so it resolves even if
  // natKeys is empty (no async load ever kicks off the drain below).
  let resolveNatureReady: () => void = () => undefined;
  const natureReady = new Promise<void>((resolve) => {
    resolveNatureReady = resolve;
  });
  void loadNaturePrototypes(scene, natPalette, natKeys).then((protos) => {
    const pick = (keys: readonly string[]): NatureProto[] =>
      keys.map((k) => protos.get(k)).filter((p): p is NatureProto => !!p);
    // Keyed variant for the woods: the key decides the conifer height boost.
    const pickKeyed = (keys: readonly string[]): Array<{ key: string; proto: NatureProto }> =>
      keys
        .map((key) => ({ key, proto: protos.get(key) }))
        .filter((e): e is { key: string; proto: NatureProto } => !!e.proto);
    // Species mix is per-course art direction (conifers on Timberline,
    // broadleaf on Wildwood); themes without a mix keep the generic trees.
    const trees = pickKeyed(theme.treeKeys ?? DEFAULT_TREE_MIX);
    const accents = pickKeyed(theme.accentTreeKeys ?? []);
    const scatter = pickKeyed(theme.scatterKeys ?? []);
    const conifers = new Set<string>(CONIFER_KEYS);
    const bushSet = pickKeyed(theme.bushKeys ?? BUSH_KEYS);
    const grasses = pick(theme.grassKeys ?? GRASS_KEYS);
    const flowers = pick(theme.flowerKeys ?? FLOWER_KEYS);
    // Native plants that dot exposed SAND (Pinehurst-style wiregrass/bush clumps
    // in the waste); opt-in per course via theme.sandPlantKeys.
    const sandPlants = pick(theme.sandPlantKeys ?? []);
    // Trees do NOT cast dynamic shadows: their drop shadows are already baked
    // into the course texture (collectTreeBlobs), and adding the native-scale
    // prototypes as shadow casters would blow up the directional light's
    // shadow-map frustum and darken the whole (shadow-receiving) terrain.

    // Warm the nature shaders (instanced variants) as soon as the prototypes
    // exist — the flyover is still playing, so the compile cost lands there
    // instead of on the first frame the props appear (part of the "hole-1 first
    // shot lags / meter jerks" fix). Best-effort.
    for (const proto of protos.values()) {
      for (const part of proto.parts) {
        const mat = part.material as { forceCompilationAsync?: (m: Mesh, o?: object) => Promise<void> } | null;
        void mat?.forceCompilationAsync?.(part, { useInstances: true })?.catch(() => undefined);
      }
    }

    // CHUNKED PLANTING: creating every prop instance in one synchronous burst
    // (2-4k createInstance calls on a dense forest hole) blocked the main thread
    // for long enough to visibly freeze the rAF-driven swing meter and the
    // first-shot camera (playtest: "the bar doesn't move smoothly"). placeProto
    // now enqueues a thunk; a per-frame drain plants a bounded batch, so the
    // forest fills in over ~a second of flyover without ever stalling a frame.
    // Two queues, both drained under ONE per-frame time budget:
    //  - popQueue: PLACEMENT rows (the surfaceAt grid scans that decide where a
    //    prop goes). This used to run as one synchronous burst the moment the
    //    glbs resolved — thousands of surfaceAt() cells — which landed right on
    //    the first shot on the heaviest holes and hitched the rAF swing meter
    //    (playtest: "the bar still isn't smooth on the first shot", Timberline
    //    h1/h3). Rows now run a few per frame; each enqueues its instance thunks.
    //  - plantQueue: the createInstance work, as before.
    const plantQueue: Array<() => void> = [];
    const popQueue: Array<() => void> = [];
    let plantHead = 0;
    let popHead = 0;
    let n = 0;
    // Canopy occlusion candidates (declared at the outer buildCourse scope,
    // above): only trees/blossoms register here (via the onPlanted callback
    // plantTree passes below) — grass, flowers and bushes never grow tall
    // enough to hide the golfer, so they're left out of the scan entirely.
    // Shared white so an untinted tintable part shows its material colour instead
    // of a black (uninitialised) instance-colour buffer. One instance, never
    // mutated — reused across every placement.
    const WHITE_TINT = new Color4(1, 1, 1, 1);
    const placeProto = (
      proto: NatureProto,
      x: number,
      y: number,
      targetH: number,
      tint?: Color4,
      onPlanted?: (insts: PropHandle[]) => void
    ): void => {
      plantQueue.push(() => {
        const s = targetH / proto.height;
        const pos = w2b(x, y, heightAt(x, y));
        const rotY = hash2(y, x) * Math.PI * 2;
        const planted: PropHandle[] = [];
        // BATCHED PATH (`natureBatching`): the same props, drawn as static thin
        // instances grouped by spatial cell — no per-frame matrix upload and a
        // few dozen scene nodes instead of thousands. See natureBatch.ts.
        if (batcher) {
          for (const part of proto.parts) {
            const tintable = (part as Mesh & { tintable?: boolean }).tintable === true;
            planted.push(batcher.plant(part, pos, rotY, s, tintable ? (tint ?? WHITE_TINT) : undefined));
          }
          onPlanted?.(planted);
          return;
        }
        // Instance every material part of the prop with one shared transform.
        for (const part of proto.parts) {
          const inst = part.createInstance(`nat${n++}`);
          inst.scaling = new Vector3(s, s, s);
          inst.position = pos;
          inst.rotation = new Vector3(0, rotY, 0);
          inst.parent = treeRoot;
          // Per-tuft tint (lush grass only; the 'color' buffer is registered on
          // tintable prototype parts in natureModels when grassLit) breaks the flat
          // one-color read. For split flowers only the petal part is tintable, so a
          // hue colors the bloom while the stem part stays green.
          // CRITICAL: a tintable part uses useVertexColors, so its color buffer
          // MULTIPLIES the material. If it's registered but left UNSET (a tintable
          // grass placed with no tint — e.g. the links-fescue field), the buffer
          // reads as black and the blade renders pure black (owner: "PJ grass ...
          // black most of the time, some render green"). Always initialise the
          // buffer — the passed tint, or white so the material's own colour shows.
          if ((part as Mesh & { tintable?: boolean }).tintable) inst.instancedBuffers.color = tint ?? WHITE_TINT;
          // Scenery never moves: freeze the world matrix (thousands of static
          // instances otherwise recompute matrices EVERY frame — the real
          // steady-state cost behind "the meter doesn't move smoothly"), skip
          // bounding-info resyncs, and opt out of pointer picking.
          inst.computeWorldMatrix(true);
          inst.freezeWorldMatrix();
          inst.doNotSyncBoundingInfo = true;
          inst.isPickable = false;
          planted.push(instanceHandle(inst));
        }
        onPlanted?.(planted);
      });
    };
    // Time-sliced drain: run placement rows first (they enqueue instance thunks),
    // then the instances, all bounded to BUDGET_MS/frame so nothing the scatter
    // does can ever block a frame long enough to hitch the meter. Index cursors
    // (not shift()) keep the walk O(n). Fills in over ~1–2s of flyover.
    const BUDGET_MS = 3.5;
    // While the meter is live, stop the background placement drain completely.
    // Even a small budget can line up with the first tap on dense holes and steal
    // time from the rAF meter. Scenery resumes immediately after the shot.
    const AIM_BUDGET_MS = 0;
    // HARD CEILING ON THE WHOLE JOB, measured in WORK DONE rather than wall
    // clock. Without a ceiling the drain's only exit is an empty queue, so a
    // player who spends a hole with the meter armed pushes planting minutes
    // into the round, and the densest holes (Port Johnson h3 scans ~40k grass
    // cells, Wild Prairie h3 ~26k) can still be planting while the ball is in
    // the air. Past this the remaining queue is ABANDONED: some grass never
    // appears, which nobody will notice, instead of frames the browser reclaims
    // the WebGL context over, which everybody does.
    //
    // WALL CLOCK WOULD BE WRONG, and measurably so: the budget is only spent on
    // frames that render, so a slow or briefly-backgrounded device burns the
    // allowance without planting anything. Gating a 12s wall clock cost a third
    // of the scenery under a 1fps headless renderer — 151 batches down to 102,
    // and 2% of the frame visibly different. Counting the drain's OWN time
    // makes the ceiling mean the same thing at 5fps as at 60.
    const DRAIN_TOTAL_MS = 6_000;
    let drainSpentMs = 0;
    // Upload on a CADENCE, not every frame. `thinInstanceBufferUpdated` re-sends
    // a batch's ENTIRE matrix array, not just the slots added since last time,
    // so flushing per frame costs O(planted) of bus traffic per frame — for a
    // 40k-instance hole that is hundreds of MB over the drain. Flushing every
    // sixth frame cuts that by six with no visible difference: grass still fills
    // in progressively, just in ~100ms steps instead of ~16ms ones.
    const FLUSH_EVERY = 6;
    let sinceFlush = 0;
    const finish = (): void => {
      scene.onBeforeRenderObservable.remove(drain);
      // Push the final cell transforms and compute the batch bounds ONCE,
      // before the course is declared ready, so the flyover never sees a
      // half-uploaded batch. See NatureBatcher.finalize for why the bounds pass
      // cannot run per frame.
      batcher?.finalize();
      refreshMirrorList?.();
      // Trees register as shadow casters AS THEY ARE PLANTED, so a shadow map
      // frozen mid-drain (the flyover's timeout path, where the sweep starts
      // before planting finishes) would hold a capture with trees missing from
      // it. One forced re-capture the moment planting ends fixes that; it is
      // a no-op when the map is live.
      const sm = shadows.getShadowMap();
      if (sm && sm.refreshRate === RenderTargetTexture.REFRESHRATE_RENDER_ONCE) {
        sm.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      }
      resolveNatureReady();
    };
    const drain = scene.onBeforeRenderObservable.add(() => {
      const budget = renderPacing.meterActive ? AIM_BUDGET_MS : BUDGET_MS;
      if (budget <= 0) return;
      if (drainSpentMs > DRAIN_TOTAL_MS) {
        finish();
        return;
      }
      const t0 = performance.now();
      for (;;) {
        // Amortize the performance.now() cost — but only over a handful of
        // items, because ONE popQueue item is a whole grid row (up to ~180
        // columns x several surfaceAt calls). At the old quantum of 32 the loop
        // could chew ~5,800 cells before it ever read the clock, which made the
        // budget a floor rather than a ceiling.
        let batch = 8;
        while (batch-- > 0) {
          if (popHead < popQueue.length) popQueue[popHead++]();
          else if (plantHead < plantQueue.length) plantQueue[plantHead++]();
          else {
            drainSpentMs += performance.now() - t0;
            finish();
            return;
          }
        }
        if (performance.now() - t0 >= budget) {
          // Upload what has been planted so the scatter fills in progressively
          // (same visible behaviour as the instanced path) rather than popping
          // in all at once at the end — but on a cadence, and counted against
          // this frame's clock rather than after it. The old code flushed here
          // unconditionally and AFTER the budget test, so a frame's real cost
          // was the budget plus an unbounded upload plus an unbounded bounds
          // pass. That was the stall.
          if (++sinceFlush >= FLUSH_EVERY) {
            sinceFlush = 0;
            batcher?.flush();
          }
          drainSpentMs += performance.now() - t0;
          return;
        }
      }
    });
    // ---------------------------------------------- parked-camera perf pacing
    // The swing-meter stutter on the water holes (Timberline h1/h3, Wildwood
    // h1/h3, Port Johnson h3) was never the scatter drain — it is the two dominant
    // per-frame GPU costs: the planar water-reflection RTT (re-renders every
    // scatter instance) and the 1024² shadow map. As soon as the meter is ARMED
    // the camera is parked at address and the only animating thing is the 2D bar,
    // so freeze both — each captures one fresh frame (REFRESHRATE_RENDER_ONCE)
    // then holds — and restore their live cadence the instant the ball is struck
    // and the flight camera takes over.
    //
    // The freeze is gated on `cameraParked` OR `meterActive`: cameraParked flips
    // true at ARM (main.ts armMeter, camera parked at address) — BEFORE the first
    // tap — so the very first pointerdown and every armed-idle frame are already
    // cheap, which is the real fix for "the first tee shot ignores taps / stutters
    // on heavy holes" (the old gate was meterActive alone, which only flips once
    // the cursor is already SWEEPING, so the costly first frame landed square on
    // the first tap). The scatter drain stays gated on meterActive alone, so it
    // keeps populating vegetation right through the armed-idle window — the two
    // costs are now decoupled.
    //
    // The "live" cadence itself used to be a full shadow-map regen EVERY frame —
    // the single heaviest fixed per-frame GPU cost in the scene, paid on every
    // course regardless of how sparse its scatter is (this is what actually made
    // Wildwood/Timberline/Port Johnson feel laggy next to Sable Bay: none of them
    // ever reached the meter-armed freeze during ordinary aiming/dragging/flight,
    // so their extra shadow-caster/scatter load was paid every single frame).
    // Shadows are soft and directional; a same-frame-as-the-mirror cadence
    // (every OTHER frame, matching waterMirror below) halves that cost with no
    // perceptible difference — the mirror has run at this same cadence all
    // along and nobody has ever reported reflection lag from it.
    //
    // At the cheapest tier the map is baked ONCE for the hole instead: only the
    // ball and the golfer move, so the loss is that their own shadows stop
    // tracking, in exchange for removing the largest fixed per-frame GPU cost
    // in the scene on the device least able to pay it.
    const shadowMap = shadows.getShadowMap();
    const liveShadowRate = quality.staticShadows
      ? RenderTargetTexture.REFRESHRATE_RENDER_ONCE
      : RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES;
    if (shadowMap) shadowMap.refreshRate = liveShadowRate;
    // The two RTTs freeze on DIFFERENT conditions, because they depend on
    // different things (see renderPacing's `cinematic` note):
    //
    //  - the water mirror is a reflection FROM THE CAMERA, so it re-renders
    //    whenever the camera moves — including through the whole flyover;
    //  - the shadow map is fitted to the CASTERS, and takes nothing from the
    //    camera but minZ/maxZ. A camera move cannot change one texel of it, so
    //    it additionally freezes for the flyover's travel sweep, where the
    //    camera is the only thing moving.
    let mirrorFrozen = false;
    let shadowFrozen = false;
    scene.onBeforeRenderObservable.add(() => {
      const parked = renderPacing.meterActive || renderPacing.cameraParked || renderPacing.overhead;
      if (waterMirror && parked !== mirrorFrozen) {
        mirrorFrozen = parked;
        waterMirror.refreshRate = parked
          ? RenderTargetTexture.REFRESHRATE_RENDER_ONCE
          : RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES;
      }
      const castersStill = parked || renderPacing.cinematic;
      if (shadowMap && castersStill !== shadowFrozen) {
        shadowFrozen = castersStill;
        shadowMap.refreshRate = castersStill ? RenderTargetTexture.REFRESHRATE_RENDER_ONCE : liveShadowRate;
      }
    });
    // Deterministic per-tuft grass tint: vary brightness and nudge some tufts
    // warmer (yellow-green) so the field reads as varied blades, not flat green.
    const grassTint = (x: number, y: number): Color4 => {
      const lum = 0.72 + hash2(x * 1.7, y * 0.7) * 0.6; // 0.72..1.32
      const warm = hash2(x + 13, y - 9); // 0..1
      return new Color4(lum * (1 + warm * 0.2), lum, lum * (1 - warm * 0.12), 1);
    };
    // Fairway mow-pattern tint: the tuft carpet follows the SAME bands the
    // ground bake paints (per theme.mowPattern — see CourseTexture's matching
    // branch), so the grass reinforces the cells/stripes instead of speckling
    // random brightness over them and washing the pattern out. Light band
    // brighter, dark band darker, with a whisper of per-tuft jitter so bands
    // aren't dead flat.
    const holeAxis = Math.atan2(hole.pin.y - hole.tee.y, hole.pin.x - hole.tee.x);
    const checkerAxis = holeAxis + CHECKER_ROTATION;
    const cax = Math.cos(checkerAxis);
    const cay = Math.sin(checkerAxis);
    const hax = Math.cos(holeAxis);
    const hay = Math.sin(holeAxis);
    const dax2 = Math.cos(holeAxis + Math.PI / 4);
    const day2 = Math.sin(holeAxis + Math.PI / 4);
    const mowTile = theme.mowTile ?? 30;
    // Stripe patterns share the SAME band width the ground bake uses
    // (theme.mowWidth) or the carpet stripes drift off the painted ones.
    const mowW = theme.mowWidth ?? mowTile * 2.4;
    const fairwayTint = (x: number, y: number): Color4 => {
      let band: number;
      if (theme.mowPattern === 'cross') {
        band = mowCheckerboard(x * hax + y * hay, -x * hay + y * hax, mowTile);
      } else if (theme.mowPattern === 'straight') {
        band = Math.sin(((x * hax + y * hay) / mowW) * Math.PI) > 0 ? 1 : -1;
      } else if (theme.mowPattern === 'diagonal') {
        band = Math.sin(((x * dax2 + y * day2) / mowW) * Math.PI) > 0 ? 1 : -1;
      } else if (theme.mowPattern === 'ns') {
        band = Math.sin((x / mowW) * Math.PI) > 0 ? 1 : -1;
      } else if (theme.mowPattern === 'diag45') {
        band = Math.sin((((x + y) * 0.7071) / mowW) * Math.PI) > 0 ? 1 : -1;
      } else {
        band = mowCheckerboard(x * cax + y * cay, -x * cay + y * cax, mowTile);
      }
      // Light cells/bands brighten fully; dark ones only dip a little so the
      // fairway carpet stays clearly above the rough in grayscale (matches
      // the biased ground bake in CourseTexture).
      const lum = (band > 0 ? 1.12 : 0.95) + (hash2(x * 1.7, y * 0.7) - 0.5) * 0.08;
      return new Color4(lum, lum, lum * 0.98, 1);
    };
    // Multi-colored blooms: pick a hue from a small wildflower palette per
    // flower (the lit near-white flower material multiplies by this).
    const FLOWER_COLORS = [
      new Color4(0.98, 0.95, 0.62, 1), // yellow
      new Color4(0.96, 0.96, 0.98, 1), // white
      new Color4(0.72, 0.55, 0.92, 1), // purple
      new Color4(0.95, 0.5, 0.55, 1), // red-pink
      new Color4(0.98, 0.66, 0.4, 1) // orange
    ];
    const flowerTint = (x: number, y: number): Color4 =>
      FLOWER_COLORS[Math.floor(hash2(x + 31, y - 19) * FLOWER_COLORS.length) % FLOWER_COLORS.length];
    // Subtle green variance so bushes stop reading as one flat tone.
    const bushTint = (x: number, y: number): Color4 => {
      const l = 0.82 + hash2(x - 4, y + 8) * 0.34; // 0.82..1.16
      return new Color4(l * 0.97, l, l * 0.92, 1);
    };
    const place = (set: NatureProto[], x: number, y: number, targetH: number, jitter = 0, tint?: Color4): void => {
      if (!set.length) return;
      placeProto(set[Math.floor(hash2(x + jitter, y - jitter) * set.length) % set.length], x, y, targetH, tint);
    };
    // Cherry-blossom prototype (Wildwood's spring-parkland identity), planted
    // for any `blossom` trees hazard AND for the theme.blossomChance mix-in
    // (treeField kind 3). A pink-repainted clone of a broadleaf, ALWAYS: the
    // uploaded sakura's photo canopy is baked so dark it reads maroon under
    // scene lighting from every camera (owner, twice: "no flowers in the
    // picture" — the whole spring identity read as autumn), and no material
    // lift turns a red photo pink. Palette-driven blossom is guaranteed pink.
    let blossomProto: NatureProto | null = null;
    {
      const src = trees.find((t) => /maple|oak|poplar|aspen/.test(t.key)) ?? trees[0];
      if (src) {
        const pink = mat(scene, 'natBlossom', 0xf4a6c8, { emissive: shade(0xf4a6c8, 0.5) });
        const parts = src.proto.parts.map((p, i) => {
          const cl = p.clone(`blossomPart${i}`, null) as Mesh;
          cl.setEnabled(false);
          if ((p.material?.name ?? '') !== 'natBark') cl.material = pink;
          return cl;
        });
        blossomProto = { parts, height: src.proto.height };
      }
    }
    const plantTree = (b: TreeBlob): void => {
      // A blossom-hazard trunk (b.blossom) OR a theme.blossomChance mix-in
      // trunk (kind 3, treeField.collectTreeBlobs) uses the blossom prototype
      // — ordinary woods get an occasional cherry tree scattered through them
      // (Wildwood's spring-parkland identity), not just the dedicated groves.
      const register = (insts: PropHandle[]): void => {
        canopyOcclusion.push({ insts, x: b.x, y: b.y, r: Math.max(8, b.r) });
      };
      if ((b.blossom || b.kind === 3) && blossomProto) {
        placeProto(blossomProto, b.x, b.y, Math.max(24, b.r * 2.0), undefined, register);
        return;
      }
      // AUTHORED SPECIES WIN. A `trees` hazard that names its own treeKeys is a
      // deliberate act — a fir stand on a parkland course, the hole builder's
      // species picker — and it beat nothing at all before this: every tree was
      // drawn from the course THEME, so choosing a species in the builder
      // silently did nothing.
      const authored = b.keys?.length ? pickKeyed(b.keys) : [];
      // Accent species (e.g. birch among Timberline's pines) on ~15% of trees;
      // hazards authored `accent: true` ALWAYS plant from the accent set
      // (deliberate specimens — Sable Bay's fairway/island palms), and
      // `accentChance` dials the mix per hazard (palm-heavy shore lines).
      const roll = b.accentChance ?? 0.15;
      const set = authored.length
        ? authored
        : accents.length && (b.accent || hash2(b.x * 1.7, b.y * 0.9) < roll)
          ? accents
          : trees;
      if (!set.length) return;
      const e = set[Math.floor(hash2(b.x, b.y) * set.length) % set.length];
      // Conifer silhouettes are tall and narrow; at broadleaf target heights
      // they read squat, so they grow taller from the same canopy radius —
      // with per-tree jitter so a pine wall gets a ragged natural skyline.
      const hMul = conifers.has(e.key) ? 2.3 + hash2(b.x * 1.3, b.y * 2.1) * 0.7 : 2.0;
      placeProto(e.proto, b.x, b.y, Math.max(24, b.r * hMul), undefined, register);
    };

    // forRender=true: the 3D trunks read any hz.renderOffset nudge (visual
    // pop-out), hz.visualSpacing (denser render-only grid), and hz.visualOnly
    // hazards (extra trunks with zero collision footprint). Collision
    // (PhysicsEngine) and the baked ground shadow (bakeGroundShadows) call
    // collectTreeBlobs without it, so a hazard's hitbox never moves/densifies.
    const treeBlobs = collectTreeBlobs(hole, theme.blossomChance, true);
    for (let i = 0; i < treeBlobs.length; i += 40) {
      const start = i;
      popQueue.push(() => {
        for (let j = start; j < Math.min(start + 40, treeBlobs.length); j++) {
          const b = treeBlobs[j];
          // Never plant a GENERIC-woods tree on the green or its collar (playtest:
          // "no trees on the fringe anywhere"). Deliberate ACCENT specimens are
          // exempt — Sable Bay's island-green palms ring the sand collar right at
          // the green edge on purpose, and this skip was silently deleting them
          // (they never rendered and never registered for camera occlusion).
          if (!b.accent && pointInGreens(b.x, b.y, hole.green, hole.green2, FRINGE_MARGIN)) continue;
          plantTree(b);
        }
      });
    }

    // Backdrop woods (scenery only — never on a playable surface): a wall of
    // trees behind the green and deep bands down both outer margins. Forest
    // themes tighten the grid via backdropTreeStep for a denser wall. A
    // treeless course (authored `treeKeys: []`, e.g. an open links) OR any
    // sea-backdrop coast skips the enclosing woods entirely — its horizon is
    // ocean/dunes and sky, not a treeline (even when the hole itself uses a few
    // authored trees for framing).
    const treeless = (trees.length === 0 && accents.length === 0) || theme.backdrop === 'sea';
    const bStep = theme.backdropTreeStep;
    const bands = [
      { x0: 40, x1: 860, y0: -190, y1: 180, step: bStep ?? 60 },
      { x0: -180, x1: 160, y0: 140, y1: h + 80, step: bStep ? Math.round(bStep * 1.23) : 74 },
      { x0: 740, x1: 1080, y0: 140, y1: h + 80, step: bStep ? Math.round(bStep * 1.23) : 74 }
    ];
    for (const band of treeless ? [] : bands) {
      for (let yy = band.y0; yy < band.y1; yy += band.step) {
        const yRow = yy;
        popQueue.push(() => {
          for (let xx = band.x0; xx < band.x1; xx += band.step) {
            if (blobHash(xx + 13, yRow + 29) < 0.25) continue; // organic gaps
            const jx = xx + (blobHash(xx, yRow) - 0.5) * 44;
            const jy = yRow + (blobHash(yRow, xx) - 0.5) * 44;
            const s = engine.surfaceAt(jx, jy);
            if (s === 'green' || s === 'fringe' || s === 'fairway' || s === 'sand' || s === 'water') continue;
            if (Math.hypot(jx - hole.pin.x, jy - hole.pin.y) < 130) continue;
            plantTree({ x: jx, y: jy, r: 15 + blobHash(xx + 7, yRow + 3) * 12, kind: 0, tint: 1 });
          }
        });
      }
    }

    // Ground detail encodes grass LENGTH by surface: tall, sparse tufts +
    // stones/bushes on the rough; short, dense tufts on the fairway; nothing on
    // the green (mown smooth) — so fairway/rough/green read differently up close.
    // tuftDensity 1 keeps the exact historical 34-unit grid (hash-stable).
    // A flower bed replaces the turf with mulch + blooms, so keep the ambient
    // grass/scatter out of any garden footprint — no green tufts poking through
    // the dirt.
    const inGarden = (x: number, y: number): boolean =>
      (hole.gardens ?? []).some((g) => {
        const dx = x - g.cx;
        const dy = y - g.cy;
        const cr = Math.cos(g.rot ?? 0);
        const sr = Math.sin(g.rot ?? 0);
        const lx = (dx * cr + dy * sr) / g.rx;
        const ly = (-dx * sr + dy * cr) / g.ry;
        return lx * lx + ly * ly <= 1;
      });
    // CORRIDOR DETAIL RESTORATION (dev-environment roadmap Phase 2; bounded
    // world only — production keeps the classic exclusions byte-identical):
    //
    // 1. Green surrounds. The historical bare radius around the PIN (110 px
    //    ≈ 55 yd) scalped the rough around every green — the single biggest
    //    "meaningful assets missing near play" offender from the audit. With
    //    the bounded world on, scatter now stays out of the green complex +
    //    fringe + a short readability collar only; the rough beyond keeps its
    //    grass/bushes/rocks.
    const GREEN_SURROUND_PAD = FRINGE_MARGIN + 16; // collar past the fringe kept clean
    const nearPinClassic = (px: number, py: number, classicR: number): boolean =>
      hole.boundary
        ? pointInGreens(px, py, hole.green, hole.green2, GREEN_SURROUND_PAD)
        : Math.hypot(px - hole.pin.x, py - hole.pin.y) < classicR;
    // 2. The FRAME BAND. The big identity fields (tall fescue, waste fescue,
    //    sand plants) now stop at the SAME playable boundary as every other
    //    scatter family (owner: "don't put grass or bush assets outside the
    //    playable area"). No vegetation spills into the off-course void — the
    //    void/haze treatment owns the view past the boundary. (Previously these
    //    fields kept an ~40 yd framing band beyond the corridor; that band is
    //    what leaked grass into the dunes/void, so it's removed.)
    const FRAME_BAND = 0; // vegetation stops at the playable boundary, no framing spill
    const frameBoundary = hole.boundary ? computeBoundary(hole, DEFAULT_MARGIN + FRAME_BAND) : null;
    const inFrame = (px: number, py: number): boolean =>
      !frameBoundary || pointInBoundary(px, py, frameBoundary);
    // A tree hazard's authored polygon marks where TRUNKS may land, but the
    // rendered CANOPY overhangs up to ~27 world units past a trunk near the
    // boundary — so ground scatter (grass/flowers/bushes) planted right up to
    // the polygon edge can end up sitting visually under a canopy from above
    // (aerial "plants rendering over trees" — no depth-sort bug, the canopy
    // genuinely extends past the hazard the scatter was excluded from). Give
    // scatter the same clearance the sand-plant guard already uses for
    // woods/water (nearWaterOrWoods below), so beds and tufts stop short of
    // a treeline's true visual edge, not just its authored footprint.
    const treesHz = hole.hazards.filter((z) => z.type === 'trees');
    const TREE_CLEARANCE = 22;
    const nearTrees = (px: number, py: number): boolean =>
      treesHz.some(
        (z) =>
          pointInPolygon(px, py, z.polygon) ||
          pointInPolygon(px + TREE_CLEARANCE, py, z.polygon) ||
          pointInPolygon(px - TREE_CLEARANCE, py, z.polygon) ||
          pointInPolygon(px, py + TREE_CLEARANCE, z.polygon) ||
          pointInPolygon(px, py - TREE_CLEARANCE, z.polygon)
      );
    const tuftStep = (34 / Math.sqrt(theme.tuftDensity)) * scatterPitch;
    for (let yy = 0; yy < h; yy += tuftStep) {
      const yRow = yy;
      popQueue.push(() => {
      for (let xx = 0; xx < w; xx += tuftStep) {
        // BOUNDED WORLD: never generate ground scatter (grass, bushes, flowers,
        // rocks, forest litter) outside the playable boundary — the void stays
        // empty. Cheapest possible reject, before the surface lookup.
        if (hole.boundary && !pointInBoundary(xx, yRow, hole.boundary)) continue;
        const surf = engine.surfaceAt(xx, yRow);
        if (surf !== 'rough' && surf !== 'fairway') continue;
        if (nearPinClassic(xx, yRow, 110)) continue;
        if (inGarden(xx, yRow)) continue;
        // Keep tall grass off the mown tee pad (it reads as short, clean turf)
        // and out of the tee approach — a tuft right in front of the camera
        // reads huge at address.
        if (inTeePad(hole, xx, yRow)) continue;
        if (Math.hypot(xx - hole.tee.x, yRow - hole.tee.y) < 55) continue;
        const jx = xx + (hash2(xx, yRow) - 0.5) * 26;
        const jy = yRow + (hash2(yRow + 5, xx) - 0.5) * 26;
        if (engine.surfaceAt(jx, jy) !== surf) continue;
        const roll = hash2(xx + 91, yRow + 47);
        // Lush grass (theme.lushGrass): per-tuft color variation, a denser
        // fairway carpet, and a taller rough cap. Undefined = historical.
        const lush = theme.lushGrass;
        const tint = lush ? grassTint(jx, jy) : undefined;
        if (surf === 'fairway') {
          // Short, dense mown tufts (kept low so they never block the ball read);
          // lush lays a denser carpet so the fairway isn't a bare painted surface.
          // The fairway carpet follows whichever mow pattern the theme paints
          // (checker/cross/straight/diagonal) so the tufts read as the same
          // bands instead of random speckle.
          const fTint = lush ? fairwayTint(jx, jy) : undefined;
          if (roll < (lush ? 0.9 : 0.62)) place(grasses, jx, jy, 0.85 + hash2(jx, jy) * 0.6, 3, fTint);
        } else {
          // Longer rough grass, plus the occasional bush/flower — knee-high at
          // most (the golfer is ~6 units; tufts must never read as walls). Cap
          // kept low (grass cards read as flat "2D blocks" the taller they get,
          // playtest) — the 3D bushes/flowers carry the visual interest instead.
          const cap = lush ? 3.4 : 3.0;
          const bare = theme.bareRough === true; // desert: no grass in the rough at all
          if (roll < 0.5) {
            if (!bare) place(grasses, jx, jy, Math.min(cap, (2.0 + hash2(jx, jy) * 1.2) * theme.roughTuftHeight), 3, tint);
          }
          // Bushes/flowers are tall enough to visually crowd under a canopy's
          // true (overhanging) edge, so they respect the tree clearance;
          // forest-floor litter below is deliberately allowed close to trees.
          else if (roll < (theme.bareRough ? 0.62 : 0.55) && bushSet.length && !nearTrees(jx, jy)) {
            // The tall leafy plant (bush_kenney_b) stands a touch higher than the
            // rounded shrub; both stay knee-to-waist so they never read as walls.
            const e = bushSet[Math.floor(hash2(jx + 7, jy - 7) * bushSet.length) % bushSet.length];
            const bh = 3.2 + (e.key === 'bush_kenney_b' ? 1.0 : 0) + hash2(jy, jx) * 1.6;
            placeProto(e.proto, jx, jy, bh, lush ? bushTint(jx, jy) : undefined);
          }
          // Flowers: multi-colored + a wider band when lush (patchier bloom).
          else if (!bare && roll < (lush ? 0.64 : 0.59) && !nearTrees(jx, jy))
            place(flowers, jx, jy, 1.6 + hash2(jx + 3, jy) * 0.9, 13, lush ? flowerTint(jx, jy) : undefined);
          // Forest-floor props (ferns/stumps/logs/deadwood) where the theme
          // asks for them — rare, visual only (never physics). Heights are
          // keyed: a fallen trunk is height-scaled from its LYING pose (big
          // height = huge length), a broken snag should tower like a dead
          // spar, everything else stays knee-high.
          else if (scatter.length && roll < (theme.bareRough ? 0.82 : lush ? 0.68 : 0.625)) {
            const e = scatter[Math.floor(hash2(jx + 17, jy - 17) * scatter.length) % scatter.length];
            const sh =
              e.key === 'tree_broken'
                ? 5.5 + hash2(jx, jy + 9) * 2.5
                : e.key === 'tree_fallen'
                  ? 1.6 + hash2(jx, jy + 9) * 0.6
                  : e.key.startsWith('rock_desert')
                    ? 1.1 + hash2(jx, jy + 9) * 1.9
                    : e.key.startsWith('rocks_red')
                      ? // The cluster diorama is much wider than tall — keep
                        // scatter placements low so a "small rocks" patch
                        // stays boulder-scale in the rough.
                        0.9 + hash2(jx, jy + 9) * 1.5
                      : e.key.startsWith('stone')
                        ? 0.8 + hash2(jx, jy + 9) * 0.9
                        : 2.4 + hash2(jx + 7, jy) * 1.1;
            // A theme can list a tintable species (a bush/flower/grass key) in
            // scatterKeys alongside plain forest-floor props (ferns, stumps,
            // stones) — its prototype parts are still registered for the
            // per-instance 'color' buffer (natureModels), so leaving it unset
            // here rendered those instances solid black (visual pass 7 audit:
            // an unexplained black blob sitting alone in open rough). Passing
            // a tint is a no-op for the untintable props (the tintable check
            // in placeProto only applies it where registered).
            placeProto(e.proto, jx, jy, sh, lush ? bushTint(jx, jy) : undefined);
          }
        }
      }
      });
    }

    // Links TALL GRASS (theme.tallGrass): sparse, wind-blown marram/fescue in the
    // rough, standing well above the knee-high default cap — the signature look
    // of an open links. Visual only (no collision), kept off the tee/fairway/
    // green and the immediate tee approach so it never reads as a wall at address.
    if (theme.tallGrass) {
      const { cap, density } = theme.tallGrass;
      const tgStep = (40 / Math.sqrt(Math.max(0.15, density))) * scatterPitch;
      // Photo-textured heather / links-fescue cards (theme.heatherKeys) are the
      // preferred field content — real fescue + purple heather imagery, planted
      // untinted so the photo (incl. the purple bloom) reads true. Absent that,
      // fall back to the theme grass cards mixed with 3D tussock clumps.
      const heatherSet = pick(theme.heatherKeys ?? []);
      const clump3d = pick(['fern_kenney', 'bush_kenney_b']);
      // PRAIRIE CLUSTERING (theme.prairieClusters — Wild Prairie pass 2):
      // smooth value noise over ~170px cells modulates the field density —
      // big continuous dense patches, natural sparse transitions, no even
      // grid. Where the noise peaks, a second offset tuft doubles the core
      // and native-grass FINGERS intrude past the fairway's cut line.
      const clustered = theme.prairieClusters === true;
      const CLUSTER_CELL = 170;
      const smooth01 = (t: number): number => t * t * (3 - 2 * t);
      const vnoise = (x: number, y: number): number => {
        const cx = Math.floor(x / CLUSTER_CELL);
        const cy = Math.floor(y / CLUSTER_CELL);
        const u = smooth01(x / CLUSTER_CELL - cx);
        const v = smooth01(y / CLUSTER_CELL - cy);
        const n00 = hash2(cx * 13.37, cy * 7.77);
        const n10 = hash2((cx + 1) * 13.37, cy * 7.77);
        const n01 = hash2(cx * 13.37, (cy + 1) * 7.77);
        const n11 = hash2((cx + 1) * 13.37, (cy + 1) * 7.77);
        return n00 * (1 - u) * (1 - v) + n10 * u * (1 - v) + n01 * (1 - u) * v + n11 * u * v;
      };
      for (let yy = 0; yy < h; yy += tgStep) {
        const yRow = yy;
        popQueue.push(() => {
        for (let xx = 0; xx < w; xx += tgStep) {
          // Bounded world: the fescue/heather field stops at the frame band
          // (corridor + FRAME_BAND) — cheapest reject first.
          if (!inFrame(xx, yRow)) continue;
          const surfHere = engine.surfaceAt(xx, yRow);
          if (surfHere !== 'rough') {
            // Fairway-edge fingers: where the cluster noise peaks right at
            // the cut line, native grass presses INTO the fairway.
            if (
              clustered &&
              surfHere === 'fairway' &&
              heatherSet.length &&
              vnoise(xx * 1.9 + 991, yRow * 1.9) > 0.63 &&
              (engine.surfaceAt(xx + 14, yRow) === 'rough' ||
                engine.surfaceAt(xx - 14, yRow) === 'rough' ||
                engine.surfaceAt(xx, yRow + 14) === 'rough' ||
                engine.surfaceAt(xx, yRow - 14) === 'rough') &&
              !inTeePad(hole, xx, yRow) &&
              Math.hypot(xx - hole.tee.x, yRow - hole.tee.y) >= 70 &&
              !nearPinClassic(xx, yRow, 110)
            ) {
              // Jitter off the sampling grid — the raw (xx,yRow) placement made
              // these fairway-edge tufts line up in PERFECT ROWS (owner: "bushes
              // in one fairway on the left ... in perfect rows"). Clamp the
              // jittered point back onto fairway-adjacent ground before planting.
              const fjx = xx + (hash2(xx + 5, yRow) - 0.5) * tgStep * 0.8;
              const fjy = yRow + (hash2(yRow + 5, xx) - 0.5) * tgStep * 0.8;
              place(heatherSet, fjx, fjy, cap * (0.5 + hash2(fjx + 5, fjy - 5) * 0.3), 0, theme.lushGrass ? grassTint(fjx, fjy) : undefined);
            }
            continue;
          }
          if (inTeePad(hole, xx, yRow)) continue;
          if (Math.hypot(xx - hole.tee.x, yRow - hole.tee.y) < 70) continue;
          if (nearPinClassic(xx, yRow, 90)) continue;
          // Cluster mask: plant probability scales 0.25..~1.6 with the patch
          // noise (non-clustered courses keep the historical always-plant).
          const patch = clustered ? 0.25 + vnoise(xx, yRow) * 1.45 : 1;
          if (clustered && hash2(xx * 3.1 + 7, yRow * 2.3 - 5) > patch) continue;
          const jx = xx + (hash2(xx + 13, yRow) - 0.5) * tgStep * 0.9;
          const jy = yRow + (hash2(yRow + 13, xx) - 0.5) * tgStep * 0.9;
          if (engine.surfaceAt(jx, jy) !== 'rough') continue;
          const tall = cap * (0.6 + hash2(jx + 2, jy - 2) * 0.4);
          if (heatherSet.length) {
            // lushGrass tint greens the tintable grass blades in the mix; the
            // (non-tintable) heather cards ignore it and keep their purple photo.
            const tgTint = theme.lushGrass ? grassTint(jx, jy) : undefined;
            place(heatherSet, jx, jy, tall, 0, tgTint);
            // Dense patch cores: a second offset tuft doubles the stand.
            if (clustered && patch > 1.25) {
              const ox = jx + (hash2(jx + 31, jy) - 0.5) * tgStep * 1.4;
              const oy = jy + (hash2(jy + 31, jx) - 0.5) * tgStep * 1.4;
              if (engine.surfaceAt(ox, oy) === 'rough') {
                place(heatherSet, ox, oy, cap * (0.55 + hash2(ox, oy) * 0.4), 0, theme.lushGrass ? grassTint(ox, oy) : undefined);
              }
            }
          } else if (clump3d.length && hash2(jx + 9, jy + 4) < 0.3) {
            // ~30% 3D tussock clumps (kept a touch shorter); the rest fescue cards.
            place(clump3d, jx, jy, tall * 0.8, 3, theme.lushGrass ? grassTint(jx, jy) : undefined);
          } else {
            place(grasses, jx, jy, tall, 3, theme.lushGrass ? grassTint(jx, jy) : undefined);
          }
        }
        });
      }
      // Fescue growing THROUGH the waste bunkers: still plain sand for physics,
      // but scruffy grass clumps rise out of it so it reads as a natural blowout.
      if (theme.tallGrass.waste) {
        for (const hz of hole.hazards) {
          if (hz.type !== 'bunker' || !hz.waste) continue;
          popQueue.push(() => {
            const xs = hz.polygon.map((p) => p[0]);
            const ys = hz.polygon.map((p) => p[1]);
            const bcx = xs.reduce((a, b) => a + b, 0) / xs.length;
            const bcy = ys.reduce((a, b) => a + b, 0) / ys.length;
            const step = 15;
            for (let yy = Math.min(...ys); yy < Math.max(...ys); yy += step) {
              for (let xx = Math.min(...xs); xx < Math.max(...xs); xx += step) {
                const jx = xx + (hash2(xx + 5, yy) - 0.5) * step;
                const jy = yy + (hash2(yy + 5, xx) - 0.5) * step;
                if (!inFrame(jx, jy)) continue; // waste fescue stops at the frame band
                if (!pointInPolygon(jx, jy, hz.polygon)) continue;
                // A fairway ribbon or treeline can now be drawn over part of a
                // waste polygon (fairway "islands" in the sand) — surfaceAt
                // resolves those in the fairway/trees' favour, so skip fescue
                // there instead of poking grass tufts up through mown turf.
                if (engine.surfaceAt(jx, jy) !== 'sand') continue;
                // Leave the middle open so the sand still reads as a playable trap.
                if (Math.hypot(jx - bcx, jy - bcy) < 12) continue;
                if (hash2(jx + 3, jy + 7) > 0.55) continue; // sparse clumps
                place(grasses, jx, jy, cap * (0.5 + hash2(jx, jy) * 0.35), 3, theme.lushGrass ? grassTint(jx, jy) : undefined);
              }
            }
          });
        }
      }
    }

    /**
     * FAR-FIELD FESCUE — sparse grass on the ground between the corridor and
     * the hills, because the reference the owner keeps pointing at is scatter
     * on rolling ground, not a texture.
     *
     * THIS IS NOT THE FRAMING BAND THAT WAS REMOVED. `FRAME_BAND = 0` stays 0
     * and the corridor families still stop dead at the playable boundary — the
     * owner asked for that explicitly ("don't put grass or bush assets outside
     * the playable area") and it stands. This is a different thing in a
     * different place: it starts a clear FAR_GAP outside the boundary (so the
     * corridor edge stays clean), it is only ever low grass — never bushes or
     * props — and it thins to nothing toward the fog. Landscape, not
     * furniture.
     *
     * COST, deliberately bounded. The first cut ran a 78-unit grid to 1500 —
     * ~1500 extra cards per hole — and the perf gate caught it at once
     * (Wildwood h3's worst armed frame went 80ms-ceiling → 567ms while the
     * plant queue drained). This grid is 130 units to 900, roughly a fifth of
     * the cards, tier 0/1 only, honouring scatterPitch: the first decoration a
     * struggling device stops paying for.
     */
    if (theme.backdrop !== 'sea' && quality.tier <= 1) {
      const farSet = pick(theme.heatherKeys ?? theme.grassKeys ?? []);
      if (farSet.length) {
        const farCap = theme.tallGrass?.cap ?? 5;
        const FAR_GAP = 150;
        const farGap = hole.boundary ? computeBoundary(hole, DEFAULT_MARGIN + FAR_GAP) : null;
        const FAR_STEP = 130 * scatterPitch;
        const REACH = 900;
        for (let yy = -pad - REACH; yy < h + pad + REACH; yy += FAR_STEP) {
          const yRow = yy;
          popQueue.push(() => {
            for (let xx = -pad - REACH; xx < w + pad + REACH; xx += FAR_STEP) {
              if (farGap && pointInBoundary(xx, yRow, farGap)) continue;
              const e = outsideBy(xx, yRow);
              if (e <= 0) {
                // Inside the world the real surface is knowable: rough OR sand
                // (on a links the exposed waste is where fescue belongs), never
                // water or a mown surface the boundary happens not to reach.
                const surf = engine.surfaceAt(xx, yRow);
                if (surf !== 'rough' && surf !== 'sand') continue;
              }
              // Thin toward the fog so the field fades out, never ends on a line.
              const fade = 1 - Math.min(1, e / REACH);
              if (hash2(xx * 1.7, yRow * 1.3) > 0.2 + fade * 0.45) continue;
              const jx = xx + (hash2(xx + 21, yRow) - 0.5) * FAR_STEP * 0.9;
              const jy = yRow + (hash2(yRow + 21, xx) - 0.5) * FAR_STEP * 0.9;
              place(farSet, jx, jy, farCap * (0.7 + hash2(jx + 4, jy - 4) * 0.6), 9);
            }
          });
        }
        /**
         * THE MID BAND — 900 out to ~2200, the same stretch the far-field
         * ground canvas above was re-tuned for (the backdrop massifs on a
         * land course sit around 1450-1900 out). Fog crushes a flat ground
         * texture's contrast fast, but a bright, saturated fescue card reads
         * against a duller fogged ground long after the ground's own subtle
         * grain has washed out — by the survival math above, ~45% of the
         * card's colour still gets through at 2200u, which is worth the
         * draw; past that it drops below what's worth the cost, so this
         * band stops there rather than reaching the full FAR_FIELD_REACH.
         * A courser grid than the inner pass (roughly 3x the spacing) — this
         * ring covers a much bigger area, and fog + distance hide the
         * difference out here the same way the outer relief shells go
         * coarse.
         */
        const FAR_STEP_MID = 380 * scatterPitch;
        const REACH_MID = 2200;
        for (let yy = -pad - REACH_MID; yy < h + pad + REACH_MID; yy += FAR_STEP_MID) {
          const yRow = yy;
          popQueue.push(() => {
            for (let xx = -pad - REACH_MID; xx < w + pad + REACH_MID; xx += FAR_STEP_MID) {
              const e = outsideBy(xx, yRow);
              if (e <= REACH) continue; // the inner pass already covers this
              if (farGap && pointInBoundary(xx, yRow, farGap)) continue;
              // Same fade shape as the inner pass, continuing from its edge.
              const fade = 1 - Math.min(1, (e - REACH) / (REACH_MID - REACH));
              if (hash2(xx * 1.7, yRow * 1.3) > 0.35 + fade * 0.45) continue;
              const jx = xx + (hash2(xx + 21, yRow) - 0.5) * FAR_STEP_MID * 0.9;
              const jy = yRow + (hash2(yRow + 21, xx) - 0.5) * FAR_STEP_MID * 0.9;
              place(farSet, jx, jy, farCap * (0.7 + hash2(jx + 4, jy - 4) * 0.6), 9);
            }
          });
        }
      }
    }

    // Native plants scattered ON the sand (Pinehurst No. 2 waste look): sparse,
    // low wiregrass/bush clumps rising out of the exposed sand so a giant beach
    // reads as vegetated links waste rather than bare sand. Visual only; kept off
    // the tee/pin and thinned to occasional clumps so it never becomes a carpet.
    if (sandPlants.length) {
      // Waste-plant density is per-course: a Pinehurst waste can be sparse
      // accent clumps (default) or a dense aloe-dotted expanse (Sable Bay wants
      // "way more"). sandPlantStep = grid pitch (smaller = denser), sandPlantKeep
      // = fraction of cells kept (higher = denser).
      const sandStep = (theme.sandPlantStep ?? 82) * scatterPitch;
      const keep = theme.sandPlantKeep ?? 0.5;
      // Keep the aloe out of the WATER and the WOODS (playtest: "don't put the
      // aloe in the woods / in the water"). The sand under an authored tree band
      // reads as beach 'sand', and the shore reads 'sand' right up to the water
      // line, so a plain surface test isn't enough — exclude a margin around
      // every water/trees hazard (sample the point + its 4 neighbours).
      const wt = hole.hazards.filter((z) => z.type === 'water' || z.type === 'trees');
      const AVOID = 34;
      const nearWaterOrWoods = (px: number, py: number): boolean =>
        wt.some(
          (z) =>
            pointInPolygon(px, py, z.polygon) ||
            pointInPolygon(px + AVOID, py, z.polygon) ||
            pointInPolygon(px - AVOID, py, z.polygon) ||
            pointInPolygon(px, py + AVOID, z.polygon) ||
            pointInPolygon(px, py - AVOID, z.polygon)
        );
      for (let yy = 0; yy < h; yy += sandStep) {
        const yRow = yy;
        popQueue.push(() => {
          for (let xx = 0; xx < w; xx += sandStep) {
            if (!inFrame(xx, yRow)) continue; // sand plants stop at the frame band
            if (engine.surfaceAt(xx, yRow) !== 'sand') continue;
            if (nearPinClassic(xx, yRow, 110)) continue;
            if (Math.hypot(xx - hole.tee.x, yRow - hole.tee.y) < 60) continue;
            if (hash2(xx + 41, yRow + 19) > keep) continue; // thin to clumps
            const jx = xx + (hash2(xx, yRow) - 0.5) * sandStep * 0.7;
            const jy = yRow + (hash2(yRow + 3, xx) - 0.5) * sandStep * 0.7;
            if (engine.surfaceAt(jx, jy) !== 'sand') continue;
            if (nearWaterOrWoods(jx, jy)) continue;
            // A tint is REQUIRED for lush (tintable) prototypes — without it the
            // instanced color buffer defaults to black. Wiregrass reads olive.
            place(sandPlants, jx, jy, 2.2 + hash2(jx, jy) * 1.8, 3, theme.lushGrass ? bushTint(jx, jy) : undefined);
          }
        });
      }
    }

    // Hand-placed flower beds (hole.gardens): a dense, color-ORGANIZED sweep of
    // blooms at an authored spot — e.g. behind the green. Unlike the ambient
    // rough scatter above, a bed paints a left→right rainbow: each bloom's hue
    // comes from its horizontal position across the bed (pink · purple · blue ·
    // green · yellow · white), so the whole bed reads as designed color beds
    // rather than random speckle. Decor only: planted on the rough surface,
    // never on the green/fringe/sand/water or a tree hitbox, and invisible to
    // physics/AI (gardens carry no collision — see types.ts GardenBed).
    //
    // The blooms are the genuinely-3D nature-kit meshes (flower_f/g/h clusters,
    // flower_e sunflower); the theme's lit two-sided flower material multiplies
    // by the band hue so each reads as its true color. Some bands prefer a
    // species (sunflowers in the yellow band, leafy plants in the green band).
    const BANDS: Array<{ hue: Color4; prefer: string[] }> = [
      { hue: new Color4(0.98, 0.46, 0.66, 1), prefer: [] }, // pink
      { hue: new Color4(0.66, 0.42, 0.92, 1), prefer: [] }, // purple
      { hue: new Color4(0.42, 0.6, 0.98, 1), prefer: [] }, // blue
      { hue: new Color4(0.44, 0.82, 0.46, 1), prefer: ['flower_h'] }, // green — leafy plant
      { hue: new Color4(0.98, 0.85, 0.32, 1), prefer: ['flower_e'] }, // yellow — sunflower
      { hue: new Color4(0.98, 0.98, 1.0, 1), prefer: [] } // white
    ];
    // Per-species target height band (world units): sunflowers stand tall at the
    // back, clusters/plants sit knee-to-waist high.
    const BLOOM_H: Record<string, [number, number]> = {
      flower_e: [4.0, 5.4],
      flower_f: [2.2, 3.2],
      flower_g: [2.4, 3.4],
      flower_h: [2.0, 2.9],
      flower_a: [2.2, 3.2]
    };
    for (const g of hole.gardens ?? []) {
      popQueue.push(() => {
      const bedFlowers = (g.flowerKeys ?? theme.flowerKeys ?? FLOWER_KEYS)
        .map((k) => ({ k, proto: protos.get(k) }))
        .filter((e): e is { k: string; proto: NatureProto } => !!e.proto);
      if (!bedFlowers.length) return;
      // Colorway precedence: this bed's own `colors` > the course theme's
      // `gardenColors` (a course with a floral identity states it once and
      // every bed follows) > the generic rainbow BANDS. Cycled across the bed
      // with no species preference so any bloom mesh takes the color.
      const colorway = g.colors && g.colors.length ? g.colors : theme.gardenColors;
      const bands: Array<{ hue: Color4; prefer: string[] }> =
        colorway && colorway.length
          ? colorway.map((c) => ({ hue: Color4.FromColor3(c3(parseInt(c.replace('#', ''), 16))), prefer: [] }))
          : BANDS;
      // Species that only belong in their own band (never scattered generically).
      const banded = new Set(bands.flatMap((b) => b.prefer));
      let generic = bedFlowers.filter((e) => !banded.has(e.k));
      // A DESIGNED colorway bed only plants tintable blooms: photo-textured
      // flowers (coreopsis) keep their natural petal color no matter what hue
      // the band asks for, so one yellow photo species scattered through a
      // pink/white azalea bed breaks the whole read. Textured species still
      // appear in the ambient rough scatter and in rainbow (BANDS) beds.
      if (colorway && colorway.length) {
        const tintable = generic.filter((e) =>
          e.proto.parts.some((p) => (p as Mesh & { tintable?: boolean }).tintable)
        );
        if (tintable.length) generic = tintable;
      }
      // Cap only the extreme authored values. The real first-shot hitch was the
      // unbounded water-mirror render-list rebuild above, not the garden art
      // itself; capping every Wildwood bed down to 12 made h1/h3 visibly sparse
      // without addressing that root cost. Restore the fuller 16-density visual
      // tier while still avoiding the 19–26 outliers from dominating placement.
      const GARDEN_DENSITY_CAP = 16;
      // Rough margin (world px ≈ 4 yd) kept between a bed's blooms and any mown
      // surface so no petal head overhangs the fairway/green edge.
      const GARDEN_MOWN_COLLAR = 8;
      const step = tuftStep / Math.sqrt(Math.min(g.density ?? 1, GARDEN_DENSITY_CAP));
      const bloom = g.bloomChance ?? 0.85;
      const bushCh = g.bushChance ?? 0.1;
      const rot = g.rot ?? 0;
      const cosr = Math.cos(rot);
      const sinr = Math.sin(rot);
      const lush = theme.lushGrass;
      for (let yy = g.cy - g.ry; yy <= g.cy + g.ry; yy += step) {
        for (let xx = g.cx - g.rx; xx <= g.cx + g.rx; xx += step) {
          // Inside the (possibly rotated) ellipse footprint. lx is the position
          // along the bed's major axis, normalized to [-1, 1].
          const dx = xx - g.cx;
          const dy = yy - g.cy;
          const lx = (dx * cosr + dy * sinr) / g.rx;
          const ly = (-dx * sinr + dy * cosr) / g.ry;
          if (lx * lx + ly * ly > 1) continue;
          const jx = xx + (hash2(xx, yy) - 0.5) * step * 0.8;
          const jy = yy + (hash2(yy + 5, xx) - 0.5) * step * 0.8;
          // Rough only — never bury the green/fringe/sand/water or a tree hitbox.
          if (engine.surfaceAt(jx, jy) !== 'rough') continue;
          // Keep a clean turf collar between the putting surface and the bed.
          if (Math.hypot(jx - hole.pin.x, jy - hole.pin.y) < 82) continue;
          // ...and a collar off any MOWN playing surface: a bloom plants on rough,
          // but a wide petal head in the last rough row still overhangs the
          // fairway edge (owner: "flowers spill onto the fairway — they
          // shouldn't"). Skip a bloom whose ring samples a fairway/green/fringe
          // texel, so a clean rough margin frames every bed against the short grass.
          let overhangsMown = false;
          for (let a = 0; a < 4; a++) {
            const ang = (a / 4) * Math.PI * 2;
            const s = engine.surfaceAt(jx + Math.cos(ang) * GARDEN_MOWN_COLLAR, jy + Math.sin(ang) * GARDEN_MOWN_COLLAR);
            if (s === 'fairway' || s === 'green' || s === 'fringe') {
              overhangsMown = true;
              break;
            }
          }
          if (overhangsMown) continue;
          const roll = hash2(jx + 51, jy + 23);
          if (roll < bushCh) {
            // A scatter of low bushes gives the bed structure/edging.
            if (!bushSet.length) continue;
            const e = bushSet[Math.floor(hash2(jx + 7, jy - 7) * bushSet.length) % bushSet.length];
            const bh = 3.0 + (e.key === 'bush_kenney_b' ? 1.0 : 0) + hash2(jy, jx) * 1.5;
            placeProto(e.proto, jx, jy, bh, lush ? bushTint(jx, jy) : undefined);
            continue;
          }
          if (roll >= bloom + bushCh) continue;
          // Rainbow by position: map the point along the bed's major axis to one
          // of the color bands, with a little hash dither so band seams feather
          // instead of drawing a hard line.
          const t = (lx + 1) / 2 + (hash2(jx + 5, jy - 11) - 0.5) * 0.06;
          const band = bands[Math.min(bands.length - 1, Math.max(0, Math.floor(t * bands.length)))];
          const prefer = band.prefer.map((k) => bedFlowers.find((e) => e.k === k)).filter(Boolean) as Array<{
            k: string;
            proto: NatureProto;
          }>;
          const pool = prefer.length ? prefer : generic.length ? generic : bedFlowers;
          const e = pool[Math.floor(hash2(jx + 9, jy - 5) * pool.length) % pool.length];
          const [hmin, hmax] = BLOOM_H[e.k] ?? [2.0, 2.8];
          const bh = hmin + hash2(jx + 3, jy) * (hmax - hmin);
          placeProto(e.proto, jx, jy, bh, lush ? band.hue : undefined);
        }
      }
      });
    }

    // Weathered stones ring each bunker's outside edge (theme.bunkerStones):
    // sparse, on the surrounding rough only (never sand/fairway/green), so a
    // trap reads as dug into the terrain rather than laid onto it.
    if (theme.bunkerStones) {
      popQueue.push(() => {
      const stones = pickKeyed(STONE_KEYS);
      for (const hz of hole.hazards) {
        if (!stones.length) break;
        if (hz.type !== 'bunker' || hz.beach) continue; // beaches carry no stone rim
        const cx = hz.polygon.reduce((a, p) => a + p[0], 0) / hz.polygon.length;
        const cy = hz.polygon.reduce((a, p) => a + p[1], 0) / hz.polygon.length;
        let placed = 0;
        for (const [px, py] of hz.polygon) {
          if (placed >= 4) break;
          if (hash2(px * 1.3, py * 0.7) > 0.5) continue; // sparse, hash-stable
          const d = Math.hypot(px - cx, py - cy) || 1;
          const sx = px + ((px - cx) / d) * 2.6;
          const sy = py + ((py - cy) / d) * 2.6;
          const s = engine.surfaceAt(sx, sy);
          if (s !== 'rough' && s !== 'trees') continue; // never on fringe/fairway/sand
          const e = stones[Math.floor(hash2(sx, sy) * stones.length) % stones.length];
          placeProto(e.proto, sx, sy, 0.9 + hash2(sx + 3, sy) * 0.9);
          placed++;
        }
      }
      });
    }
    // Authored MAJOR landforms (hole.landforms — terrain identity pass):
    // deliberate rock masses framing landing zones, shelf edges, wash banks
    // and mesa tops, placed exactly where the hole data says. Distinct from
    // the random scatter below.
    // Collidable boulders share the landform pipeline: the SAME (x,y) the
    // physics cylinder uses, grounded by placeProto at heightAt(x,y) — the
    // exact surface PhysicsEngine reads — so mesh and collider cannot drift.
    const rockHazards = hole.hazards
      .filter((hz) => hz.type === 'rock')
      .map((hz) => ({ key: hz.key ?? 'rocks_red_bright', x: hz.cx ?? 0, y: hz.cy ?? 0, h: hz.height ?? 10 }));
    const authoredMasses = [...(hole.landforms ?? []), ...rockHazards];
    if (authoredMasses.length) {
      popQueue.push(() => {
        const keyed = pickKeyed([...new Set(authoredMasses.map((l) => l.key))]);
        const byKey = new Map(keyed.map((e) => [e.key, e.proto]));
        for (const l of authoredMasses) {
          const proto = byKey.get(l.key);
          // Register every authored MASS (boulders, rock landforms, fir-sapling
          // landforms) with the same camera-occlusion system the trees use, so a
          // rock standing between the camera and the player's ball goes
          // translucent instead of hiding the shot (owner: "make the rocks
          // transparent if they're in the way when you're hitting and they're
          // behind the player"). Occlusion radius tracks the mass's size (r ≈ h,
          // like its collider), floored so a small one still reads.
          if (proto)
            placeProto(proto, l.x, l.y, l.h, undefined, (insts) => {
              canopyOcclusion.push({ insts, x: l.x, y: l.y, r: Math.max(8, l.h), mass: true });
            });
        }
      });
    }

    // Waste-rim cliff formations (theme.wasteRimKeys — Red Hollow's canyon
    // walls): walk each WASTE bunker's perimeter and plant LARGE tinted rock/
    // cliff formations on the land side, so the red waste reads carved below
    // rock rims (references: fairways perched against stratified rock).
    // Same per-edge normal technique as the shoreline band below.
    if (theme.wasteRimKeys && theme.wasteRimKeys.length) {
      popQueue.push(() => {
        const rims = pickKeyed(theme.wasteRimKeys ?? []);
        if (!rims.length) return;
        for (const hz of hole.hazards) {
          if (hz.type !== 'bunker' || !hz.waste) continue;
          const n = hz.polygon.length;
          for (let i = 0; i < n; i++) {
            const [x1, y1] = hz.polygon[i];
            const [x2, y2] = hz.polygon[(i + 1) % n];
            const segLen = Math.hypot(x2 - x1, y2 - y1);
            const steps = Math.max(1, Math.round(segLen / 34));
            let nx = -(y2 - y1) / (segLen || 1);
            let ny = (x2 - x1) / (segLen || 1);
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            if (engine.surfaceAt(mx + nx * 8, my + ny * 8) === 'sand') {
              nx = -nx;
              ny = -ny;
            }
            for (let sIdx = 0; sIdx < steps; sIdx++) {
              const t = (sIdx + 0.5) / steps;
              const px = x1 + (x2 - x1) * t;
              const py = y1 + (y2 - y1) * t;
              const roll = hash2(px * 1.3, py * 2.7);
              if (roll > 0.55) continue; // broken formations, not a wall
              const off = 6 + hash2(px + 3, py - 8) * 10;
              const ox = px + nx * off + (hash2(px, py + 11) - 0.5) * 8;
              const oy = py + ny * off + (hash2(py, px - 3) - 0.5) * 8;
              // Rough side only — never crowd fairway/green/sand edges.
              if (engine.surfaceAt(ox, oy) !== 'rough') continue;
              if (Math.hypot(ox - hole.pin.x, oy - hole.pin.y) < 130) continue;
              // 140 (was 90): the cluster diorama's footprint is far wider
              // than its height, so a rim placement near the tee could hang
              // a rock slab over the tee camera (playtest screenshot).
              if (Math.hypot(ox - hole.tee.x, oy - hole.tee.y) < 140) continue;
              const e = rims[Math.floor(hash2(ox + 5, oy + 1) * rims.length) % rims.length];
              // Boulder-to-outcrop scale, biggest pieces rarest. Cluster
              // heights stay modest — the diorama spreads several rocks over
              // a wide footprint, so height 9 already reads as an outcrop.
              const big = hash2(ox * 0.7, oy * 0.9);
              const rh = e.key.startsWith('rocks_red')
                ? 3.5 + big * 5.5
                : e.key.startsWith('mesa')
                  ? 5 + big * 9
                  : 2.2 + big * 3.4;
              // Register the rim cliff with the camera-occlusion system too — a
              // canyon-wall slab standing mid-corridor on the cam→ball line must
              // ghost like any other shot-blocker (Matt review nit: Red Hollow's
              // rims are the case most likely to hide a shot).
              placeProto(e.proto, ox, oy, rh, undefined, (insts) => {
                canopyOcclusion.push({ insts, x: ox, y: oy, r: Math.max(10, rh), mass: true });
              });
            }
          }
        }
      });
    }

    // Shoreline margin scatter (theme.shorelineKeys — opt-in per course): real
    // water always announces its edge, but every waterline in the game met the
    // turf as two flat colors (visual audit: "shorelines have no margin"). Walk
    // each water polygon's perimeter and plant a thin, broken band of reeds/
    // tall grass with occasional stones just up the bank. Per-EDGE normals
    // (not centroid direction — a winding creek is concave, so "away from
    // centroid" points the wrong way along half its length), with the land
    // side found by probing surfaceAt on both sides of the edge. Planted on
    // rough only, so fairway/green/sand edges at the water stay clean.
    if (theme.shorelineKeys && theme.shorelineKeys.length) {
      popQueue.push(() => {
        const keyed = pickKeyed(theme.shorelineKeys ?? []);
        const plants = keyed.filter((e) => !e.key.startsWith('stone'));
        const stones = keyed.filter((e) => e.key.startsWith('stone'));
        if (!plants.length && !stones.length) return;
        for (const hz of hole.hazards) {
          if (hz.type !== 'water') continue;
          const n = hz.polygon.length;
          for (let i = 0; i < n; i++) {
            const [x1, y1] = hz.polygon[i];
            const [x2, y2] = hz.polygon[(i + 1) % n];
            const segLen = Math.hypot(x2 - x1, y2 - y1);
            // /6 (was /9) + skip 0.92 (was 0.85): "reeds look great and could
            // be far more dense" — a fuller, still-broken band.
            const steps = Math.max(1, Math.round(segLen / 6));
            // Edge normal; land side resolved by probing both sides.
            let nx = -(y2 - y1) / (segLen || 1);
            let ny = (x2 - x1) / (segLen || 1);
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            if (engine.surfaceAt(mx + nx * 4, my + ny * 4) === 'water') {
              nx = -nx;
              ny = -ny;
            }
            for (let s = 0; s < steps; s++) {
              const t = (s + 0.5) / steps;
              const px = x1 + (x2 - x1) * t;
              const py = y1 + (y2 - y1) * t;
              const roll = hash2(px * 2.1, py * 1.7);
              if (roll > 0.92) continue; // broken clumps, not a hedge
              const off = 1.5 + hash2(px + 9, py - 4) * 2.5;
              const ox = px + nx * off + (hash2(px, py + 7) - 0.5) * 2;
              const oy = py + ny * off + (hash2(py, px - 5) - 0.5) * 2;
              // Rough or woods-floor banks both take the band (a creek running
              // through trees still fringes its edge); fairway/green/sand
              // shores stay clean so the mown line meets the water crisply.
              const surf = engine.surfaceAt(ox, oy);
              if (surf !== 'rough' && surf !== 'trees') continue;
              if (stones.length && roll < 0.13) {
                const e = stones[Math.floor(hash2(ox + 1, oy + 2) * stones.length) % stones.length];
                placeProto(e.proto, ox, oy, 0.8 + hash2(ox, oy + 9) * 0.8);
              } else if (plants.length) {
                const e = plants[Math.floor(hash2(ox + 4, oy - 3) * plants.length) % plants.length];
                // Warm golden reed tint (not the ambient grassTint): the band
                // has to READ at gameplay distance, and green-on-green clumps
                // vanish against the rough. Golden marsh grass pops against
                // both the water and the bank.
                const lum = 0.95 + hash2(ox * 1.3, oy * 0.9) * 0.35;
                const reed = new Color4(lum * 1.18, lum * 1.02, lum * 0.52, 1);
                placeProto(e.proto, ox, oy, 4.2 + hash2(ox - 2, oy + 5) * 2.0, theme.lushGrass ? reed : undefined);
              }
            }
          }
        }
      });
    }
    if (theme.bunkerLipFescue) {
      popQueue.push(() => {
        // The SAME heather mix already planted through this course's rough
        // (theme.heatherKeys — every variant, including heather_purple; the
        // links look is those plants growing right up to the sand, not a
        // separate invented asset) — planted on the hole-side of EVERY bunker
        // (plain, waste, beach, or revetted-wall) so a trap reads as sand
        // carved out of a real turf lip, not a clean disc dropped onto flat
        // ground. Grows in a few THICK, MOUNDED clumps with bare sand-to-turf
        // gaps between them (real links fescue at a bunker edge — reference
        // photo). Cluster anchors (rim position, 2-4 per bunker, a green-
        // centroid bunker skipped entirely) come from bunkerFescueClusters —
        // shared with renderCourseCanvas so the ground-texture bake paints a
        // matching brown patch under each clump (see its own doc comment).
        const pool = pick(theme.heatherKeys ?? []);
        if (!pool.length) return;
        for (const center of bunkerFescueClusters(hole, theme)) {
          const count = 18 + Math.floor(hash2(center.x + center.nx, center.y + center.ny) * 20); // 18-37 per clump (~25% denser)
          for (let j = 0; j < count; j++) {
            // 1.8-unit INWARD nudge (was 0.6 outward) — the clump's near edge
            // starts right at the sand line and a little into it, rather than
            // standing back on the turf, so the wiry lip reads as pushing into
            // the trap instead of stopping short of it.
            const jx =
              center.x + (hash2(center.x + j * 3.1, center.y - j * 2.7) - 0.5) * FESCUE_CLUSTER_JITTER * 2 - center.nx * 1.8;
            const jy =
              center.y + (hash2(center.y + j * 3.1, center.x - j * 2.7) - 0.5) * FESCUE_CLUSTER_JITTER * 2 - center.ny * 1.8;
            // Accept rough, sand, and (unless the theme says otherwise) fairway
            // turf. A fairway-side bunker (very common — Sable Bay/Port
            // Johnson both flank the short grass directly, no rough buffer
            // between) can have NO rough anywhere along its rim, so gating on
            // 'rough' alone silently skipped fescue on every one of those
            // traps, leaving a completely bare sand→fairway edge (bug report:
            // "no grass by the bunker"). Sand is accepted too so the
            // inward-nudged tufts that land just past the rim still render —
            // renderCourseCanvas paints real brown ground under them so
            // "sand" here never means visually bare sand.
            // `bunkerFescueAvoidFairway` (Sable Bay) drops the fairway
            // fallback once a course's rough is a real brown patch — the lip
            // should read as sitting on dune-brown turf, never on the vivid
            // green fairway. Green/fringe/water/trees stay excluded — a
            // putting collar or another hazard should never sprout wiregrass.
            const surf = engine.surfaceAt(jx, jy);
            const fairwayOk = surf === 'fairway' && !theme.bunkerFescueAvoidFairway;
            if (surf !== 'rough' && surf !== 'sand' && !fairwayOk) continue;
            place(pool, jx, jy, 2.8 + hash2(jx + j, jy - j) * 3.4); // 2.8-6.2: taller, bushier wall
          }
        }
        // PACKED lip (theme.bunkerLipPacked — Wild Prairie): beyond the
        // mounded clumps above, walk EVERY bunker's full perimeter and pack
        // fescue tightly along the sand line ("the edges of every bunker
        // should be absolutely lined with that bright gold grass — not
        // uniformly but really packed"). ~72% of steps plant (broken, not a
        // hedge), each straddling the lip with jitter.
        if (theme.bunkerLipPacked) {
          for (const hz of hole.hazards) {
            if (hz.type !== 'bunker') continue;
            const n = hz.polygon.length;
            for (let i = 0; i < n; i++) {
              const [x1, y1] = hz.polygon[i];
              const [x2, y2] = hz.polygon[(i + 1) % n];
              const segLen = Math.hypot(x2 - x1, y2 - y1);
              const steps = Math.max(1, Math.round(segLen / 7));
              for (let sIdx = 0; sIdx < steps; sIdx++) {
                const t = (sIdx + 0.5) / steps;
                const px = x1 + (x2 - x1) * t;
                const py = y1 + (y2 - y1) * t;
                if (hash2(px * 1.7, py * 2.3) > 0.72) continue;
                const jx = px + (hash2(px + 19, py) - 0.5) * 7;
                const jy = py + (hash2(py + 19, px) - 0.5) * 7;
                const surf = engine.surfaceAt(jx, jy);
                if (surf !== 'rough' && surf !== 'sand' && surf !== 'fairway') continue;
                if (Math.hypot(jx - hole.pin.x, jy - hole.pin.y) < 90) continue;
                place(pool, jx, jy, 2.4 + hash2(jx + 5, jy - 5) * 3.2);
              }
            }
          }
        }
      });
    }
  });

  // ---------------------------------------------------- revetted bunker walls
  // St-Andrews-style pot bunkers (hazard.wall): the height field already sank
  // the floor (WALL_DEPTH below the turf); here we build the stacked-stone wall
  // face standing around the rim so it reads as a deep, walled trap you have to
  // pitch out of. Visual only — physics is the usual sand plug.
  const wallBunkers = hole.hazards.filter((hz) => hz.type === 'bunker' && hz.wall);
  if (wallBunkers.length) {
    const wallMat = new StandardMaterial('revetWall', scene);
    wallMat.diffuseTexture = new Texture('textures/rock_wall.jpg', scene);
    wallMat.bumpTexture = new Texture('textures/rock_normal.png', scene);
    wallMat.specularColor = new Color3(0.08, 0.08, 0.08);
    wallMat.backFaceCulling = false;
    for (const hz of wallBunkers) {
      const poly = hz.polygon;
      const positions: number[] = [];
      const indices: number[] = [];
      const uvs: number[] = [];
      let uRun = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const topA = w2b(a[0], a[1], heightAt(a[0], a[1]) + 0.2);
        const topB = w2b(b[0], b[1], heightAt(b[0], b[1]) + 0.2);
        const botA = topA.add(new Vector3(0, -WALL_DEPTH - 0.3, 0));
        const botB = topB.add(new Vector3(0, -WALL_DEPTH - 0.3, 0));
        const base = positions.length / 3;
        for (const v of [topA, topB, botB, botA]) positions.push(v.x, v.y, v.z);
        const segU = Math.hypot(b[0] - a[0], b[1] - a[1]) / 12; // ~12px per stone course
        const vTop = (WALL_DEPTH + 0.3) / 1.8; // stacked courses ~1.8 units tall
        uvs.push(uRun, vTop, uRun + segU, vTop, uRun + segU, 0, uRun, 0);
        uRun += segU;
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
      const wall = new Mesh(`revet-${Math.round(poly[0][0])}-${Math.round(poly[0][1])}`, scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.indices = indices;
      vd.uvs = uvs;
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);
      vd.normals = normals;
      vd.applyToMesh(wall);
      wall.material = wallMat;
      wall.isPickable = false;
      wall.freezeWorldMatrix();
    }
  }

  // --------------------------------------------------------- dry-stone walls
  // A `building` hazard is solid in physics (flight below treeHeight is
  // knocked down anywhere on the footprint) and bakes a footprint + sun
  // shadow, but never had a 3D body. Stand each one up as a dry-stone wall:
  // the polygon rim extruded from the turf to a low stone height with a flat
  // capstone run — Port Johnson's "Old Wall" landmark behind the 3rd green
  // (the St Andrews road-wall backstop). CONVEX footprints only (the cap
  // fans from vertex 0); author a bent wall as convex quads end-to-end.
  const buildings = hole.hazards.filter((hz) => hz.type === 'building');
  if (buildings.length) {
    const stoneMat = new StandardMaterial('dryStoneWall', scene);
    stoneMat.diffuseTexture = new Texture('textures/rock_wall.jpg', scene);
    stoneMat.bumpTexture = new Texture('textures/rock_normal.png', scene);
    stoneMat.specularColor = new Color3(0.07, 0.07, 0.07);
    stoneMat.backFaceCulling = false;
    const WALL_H = 6.0; // twice the original hip-height stack — a proper backstop landmark
    for (const hz of buildings) {
      const poly = hz.polygon;
      const positions: number[] = [];
      const indices: number[] = [];
      const uvs: number[] = [];
      let uRun = 0;
      const top: Vector3[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const topA = w2b(a[0], a[1], heightAt(a[0], a[1]) + WALL_H);
        const topB = w2b(b[0], b[1], heightAt(b[0], b[1]) + WALL_H);
        const botA = w2b(a[0], a[1], heightAt(a[0], a[1]) - 0.4);
        const botB = w2b(b[0], b[1], heightAt(b[0], b[1]) - 0.4);
        top.push(topA);
        const base = positions.length / 3;
        for (const v of [topA, topB, botB, botA]) positions.push(v.x, v.y, v.z);
        const segU = Math.hypot(b[0] - a[0], b[1] - a[1]) / 12; // ~12px per stone course
        const vTop = (WALL_H + 0.4) / 1.8; // stacked courses ~1.8 units tall
        uvs.push(uRun, vTop, uRun + segU, vTop, uRun + segU, 0, uRun, 0);
        uRun += segU;
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
      // Flat capstone (fan — convex footprints only).
      const capBase = positions.length / 3;
      for (const v of top) {
        positions.push(v.x, v.y, v.z);
        uvs.push(v.x / 12, v.z / 12);
      }
      for (let i = 1; i < top.length - 1; i++) {
        indices.push(capBase, capBase + i, capBase + i + 1);
      }
      const wall = new Mesh(`drystone-${Math.round(poly[0][0])}-${Math.round(poly[0][1])}`, scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.indices = indices;
      vd.uvs = uvs;
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);
      vd.normals = normals;
      vd.applyToMesh(wall);
      wall.material = stoneMat;
      wall.isPickable = false;
      shadows.addShadowCaster(wall);
      wall.freezeWorldMatrix();
    }
  }

  // ------------------------------------------------------- ocean rock cliffs
  // A `cliff` water hazard (Port Johnson's links coast): the shoreline edges are
  // extruded into a rock-textured headland face dropping from the turf down into
  // the sea, so the left of the hole reads as ocean cliffs, not a flat pond. Only
  // in-world edges get a face (the ocean runs off-world on its far sides). Physics
  // still reads the polygon as water.
  const cliffs = hole.hazards.filter((hz) => hz.type === 'water' && hz.cliff);
  if (cliffs.length) {
    const cliffMat = new StandardMaterial('oceanCliff', scene);
    cliffMat.diffuseTexture = new Texture('textures/rock_wall.jpg', scene);
    cliffMat.bumpTexture = new Texture('textures/rock_normal.png', scene);
    cliffMat.specularColor = new Color3(0.06, 0.06, 0.06);
    cliffMat.backFaceCulling = false;
    const CLIFF_TOP = 2.4;
    const CLIFF_BOT = -18;
    const inWorld = (p: number[]): boolean => p[0] > 4 && p[0] < w - 4 && p[1] > 4 && p[1] < h - 4;
    for (const hz of cliffs) {
      const poly = hz.polygon;
      const positions: number[] = [];
      const indices: number[] = [];
      const uvs: number[] = [];
      let uRun = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        // Only face the shoreline the player can see — skip edges that run along
        // the off-world side of the ocean.
        if (!inWorld(a) && !inWorld(b)) continue;
        const topA = w2b(a[0], a[1], CLIFF_TOP);
        const topB = w2b(b[0], b[1], CLIFF_TOP);
        const botA = w2b(a[0], a[1], CLIFF_BOT);
        const botB = w2b(b[0], b[1], CLIFF_BOT);
        const base = positions.length / 3;
        for (const v of [topA, topB, botB, botA]) positions.push(v.x, v.y, v.z);
        const segU = Math.hypot(b[0] - a[0], b[1] - a[1]) / 40;
        uvs.push(uRun, 1, uRun + segU, 1, uRun + segU, 0, uRun, 0);
        uRun += segU;
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
      if (!positions.length) continue;
      const cliff = new Mesh(`cliff-${Math.round(poly[0][0])}`, scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.indices = indices;
      vd.uvs = uvs;
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);
      vd.normals = normals;
      vd.applyToMesh(cliff);
      cliff.material = cliffMat;
      cliff.isPickable = false;
      cliff.freezeWorldMatrix();
    }
  }

  // Authored CLIFF-FACE strips (hole.cliffWalls — Red Hollow h1's sheer right
  // wall): the 8px heightfield can only express ~30° between cells, so the
  // rising wall's toe gets a rock-textured strip extruded to the terrain a few
  // px UPHILL — the visible face reads near-vertical while physics stays the
  // real heightfield (whose steep slope already returns every ball to the
  // toe; nothing can rest behind the strip). Same quad-strip recipe as the
  // ocean cliffs above, tinted to the course's stone palette.
  if (hole.cliffWalls && hole.cliffWalls.length) {
    const faceMat = new StandardMaterial('cliffFace', scene);
    faceMat.diffuseTexture = new Texture('textures/rock_wall.jpg', scene);
    faceMat.bumpTexture = new Texture('textures/rock_normal.png', scene);
    faceMat.specularColor = new Color3(0.05, 0.05, 0.05);
    if (theme.stoneTint !== undefined) {
      const st = theme.stoneTint;
      const r = ((st >> 16) & 0xff) / 255;
      const g = ((st >> 8) & 0xff) / 255;
      const b = (st & 0xff) / 255;
      faceMat.diffuseColor = new Color3(0.6 + r * 0.9, 0.6 + g * 0.9, 0.6 + b * 0.9);
    }
    faceMat.backFaceCulling = false;
    // Uphill unit direction from a numerical gradient of the same heightAt
    // the terrain mesh displaces with — the strip follows the wall wherever
    // the authoring puts its toe.
    const uphill = (x: number, y: number): [number, number] => {
      const gx = heightAt(x + 4, y) - heightAt(x - 4, y);
      const gy = heightAt(x, y + 4) - heightAt(x, y - 4);
      const l = Math.hypot(gx, gy) || 1;
      return [gx / l, gy / l];
    };
    hole.cliffWalls.forEach((wall, wi) => {
      const inset = wall.inset ?? 8;
      const pts = wall.points;
      const positions: number[] = [];
      const indices: number[] = [];
      const uvs: number[] = [];
      let uRun = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const [uax, uay] = uphill(a[0], a[1]);
        const [ubx, uby] = uphill(b[0], b[1]);
        const at: [number, number] = [a[0] + uax * inset, a[1] + uay * inset];
        const bt: [number, number] = [b[0] + ubx * inset, b[1] + uby * inset];
        const topA = w2b(at[0], at[1], heightAt(at[0], at[1]) + 0.3);
        const topB = w2b(bt[0], bt[1], heightAt(bt[0], bt[1]) + 0.3);
        const botA = w2b(a[0], a[1], heightAt(a[0], a[1]) - 0.4);
        const botB = w2b(b[0], b[1], heightAt(b[0], b[1]) - 0.4);
        const base = positions.length / 3;
        for (const v of [topA, topB, botB, botA]) positions.push(v.x, v.y, v.z);
        const segU = Math.hypot(b[0] - a[0], b[1] - a[1]) / 40;
        uvs.push(uRun, 1, uRun + segU, 1, uRun + segU, 0, uRun, 0);
        uRun += segU;
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
      if (!positions.length) return;
      const face = new Mesh(`cliffFace-${wi}`, scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.indices = indices;
      vd.uvs = uvs;
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);
      vd.normals = normals;
      vd.applyToMesh(face);
      face.material = faceMat;
      face.isPickable = false;
      face.freezeWorldMatrix();
    });
  }

  // -------------------------------------------------------------------- pin
  // The pin lives on a root node that scales with camera distance (with a
  // minimum on-screen size), so the flag stays findable even on a 560yd tee
  // shot — the Tiger-Woods-style "always visible target".
  const pinBaseH = greenLift(hole.pin.x, hole.pin.y, hole) + engine.groundAt(hole.pin.x, hole.pin.y);
  const pinRoot = new TransformNode('pinRoot', scene);
  pinRoot.position = w2b(hole.pin.x, hole.pin.y, pinBaseH);
  const pole = MeshBuilder.CreateCylinder('pole', { diameter: 0.55, height: 12, tessellation: 8 }, scene);
  pole.material = mat(scene, 'poleMat', 0xf5f5f0, { emissive: 0x555550 });
  pole.position = new Vector3(0, 6, 0);
  pole.parent = pinRoot;
  const flag = MeshBuilder.CreatePlane('flag', { width: 5.4, height: 3.2 }, scene);
  const flagMat = mat(scene, 'flagMat', 0xd23c3c, { emissive: 0x7c1f1f, spec: 0.1 });
  flagMat.backFaceCulling = false;
  flag.material = flagMat;
  flag.position = new Vector3(2.7, 10.2, 0);
  flag.parent = pinRoot;
  scene.onBeforeRenderObservable.add(() => {
    const t = animTime();
    flag.rotation.y = Math.sin(t * 3.1) * 0.28;
    flag.rotation.z = Math.sin(t * 5.3) * 0.06;
    const cam = scene.activeCamera;
    if (cam) {
      const d = Vector3.Distance(cam.position, pinRoot.position);
      pinRoot.scaling.setAll(Math.min(4.6, Math.max(1, d / 240)));
    }
  });
  shadows.addShadowCaster(pole);
  shadows.addShadowCaster(flag);

  // Cup: small dark disc at the pin, sitting on the green plateau. Drawn at
  // EXACTLY the physics capture radius so the hole you see is the hole that
  // catches the ball — a putt that visibly crosses the black disc at a
  // makeable pace drops, killing the "rolled right over the hole" miss (FB9).
  const cup = MeshBuilder.CreateDisc('cup', { radius: PHYSICS.cupRadius, tessellation: 24 }, scene);
  cup.rotation.x = Math.PI / 2;
  cup.material = mat(scene, 'cupMat', 0x0c2410, { emissive: 0x081a0b });
  cup.position = w2b(hole.pin.x, hole.pin.y, pinBaseH + 0.06);

  // (The old gold "green target ring" torus was removed — playtest: it read as a
  // glitchy beige ring around the green in the tee/aerial views. The pin marker
  // and, while putting, the white cupRing/cupBeacon are the target aids now.)

  // ----------------------------------------------------------------- petals
  // A sparse drift of blossom petals around the camera keeps the air alive
  const petalTex = new DynamicTexture('petalTex', { width: 32, height: 32 }, scene, true);
  const ptx = petalTex.getContext() as CanvasRenderingContext2D;
  ptx.clearRect(0, 0, 32, 32);
  ptx.fillStyle = 'rgba(246,190,214,0.95)';
  ptx.beginPath();
  ptx.ellipse(16, 16, 10, 6, 0.6, 0, Math.PI * 2);
  ptx.fill();
  ptx.fillStyle = 'rgba(255,226,238,0.9)';
  ptx.beginPath();
  ptx.ellipse(13, 13, 4, 2.5, 0.6, 0, Math.PI * 2);
  ptx.fill();
  petalTex.update(false);
  petalTex.hasAlpha = true;
  const petals = new ParticleSystem('petals', 36, scene);
  petals.particleTexture = petalTex;
  petals.emitter = w2b(hole.tee.x, hole.tee.y - 60, 24);
  petals.minEmitBox = new Vector3(-80, -6, -80);
  petals.maxEmitBox = new Vector3(80, 26, 80);
  petals.minSize = 0.5;
  petals.maxSize = 1.0;
  petals.minLifeTime = 7;
  petals.maxLifeTime = 12;
  petals.emitRate = 2.5;
  petals.gravity = new Vector3(0, -0.55, 0);
  petals.direction1 = new Vector3(-2.2, -0.4, -1.2);
  petals.direction2 = new Vector3(2.2, -1.1, 1.2);
  petals.minAngularSpeed = -2.2;
  petals.maxAngularSpeed = 2.2;
  petals.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  if (!isFrozen()) petals.start();
  // Allocation-free per-frame emitter follow (hoisted scratch + constant axis):
  // getDirection/Vector3.Forward()/.scale/.add each minted a fresh Vector3 every
  // frame — pure GC churn on the hottest observable, felt as swing-meter micro-hitches.
  const petalEmitter = petals.emitter as Vector3;
  const petalFwd = new Vector3();
  const PETAL_FORWARD = Vector3.Forward();
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera;
    if (!cam) return;
    cam.getDirectionToRef(PETAL_FORWARD, petalFwd);
    petalEmitter.set(
      cam.position.x + petalFwd.x * 55,
      Math.max(20, cam.position.y + 14),
      cam.position.z + petalFwd.z * 55
    );
  });

  // ------------------------------------------------------------- putt grid
  // Reading aid: a soft white square grid, circular-clipped to cover the green.
  // Its orientation is DYNAMIC — the scene re-points it down the golfer→hole
  // line each putt (orientPuttAids) so one axis runs straight at the cup and
  // the other is the 90° horizontal, which is how you actually read break.
  // A square mesh + circular clip means re-orienting is just a rotation (no
  // texture rebuild) and never exposes a corner. The mutable `puttAids.rot` is
  // shared with the break dots so lines and dots always agree.
  const g = hole.green;
  // Cover BOTH lobes on a two-part green (owner: "putting grid isn't rendering on
  // the second green" — Wild Prairie h2, whose default pin sits on the green2
  // lobe, outside a grid sized to the main green only). Center on the midpoint of
  // the two lobes and grow the radius to reach the far edge of each.
  const g2 = hole.green2;
  let gcx = g.cx;
  let gcy = g.cy;
  let maxR = Math.max(g.rx, g.ry);
  if (g2) {
    gcx = (g.cx + g2.cx) / 2;
    gcy = (g.cy + g2.cy) / 2;
    const r1 = Math.hypot(gcx - g.cx, gcy - g.cy) + Math.max(g.rx, g.ry);
    const r2 = Math.hypot(gcx - g2.cx, gcy - g2.cy) + Math.max(g2.rx, g2.ry);
    maxR = Math.max(r1, r2);
  }
  const side = maxR * 2 + 12;
  const puttAids = { rot: g.rot ?? 0 };
  const texW = 1024;
  const gridTex = new DynamicTexture('puttGridTex', { width: texW, height: texW }, scene, true);
  const gtx = gridTex.getContext() as CanvasRenderingContext2D;
  gtx.clearRect(0, 0, texW, texW);
  gtx.save();
  gtx.beginPath();
  gtx.ellipse(texW / 2, texW / 2, ((maxR + 2) / side) * texW, ((maxR + 2) / side) * texW, 0, 0, Math.PI * 2);
  gtx.clip();
  // Two-tone lines: a soft dark underlay beneath the white stroke. On dark
  // parkland greens the underlay disappears into the turf (no visible change);
  // on PALE links turf (Port Johnson — worst on the big bright Redan green of
  // hole 2) the white-only grid washed out to invisible, and the dark edge is
  // what keeps it readable (playtest: "putting grid isn't showing up on hole
  // 2 at Port Johnson").
  const stepPx = (4 / side) * texW; // one cell ≈ 2 yards
  const drawLines = (): void => {
    for (let x = (texW / 2) % stepPx; x <= texW; x += stepPx) {
      gtx.beginPath();
      gtx.moveTo(x, 0);
      gtx.lineTo(x, texW);
      gtx.stroke();
    }
    for (let y = (texW / 2) % stepPx; y <= texW; y += stepPx) {
      gtx.beginPath();
      gtx.moveTo(0, y);
      gtx.lineTo(texW, y);
      gtx.stroke();
    }
  };
  gtx.strokeStyle = 'rgba(12,44,24,0.55)';
  gtx.lineWidth = 3.5;
  drawLines();
  gtx.strokeStyle = 'rgba(255,255,255,0.6)';
  gtx.lineWidth = 1.5;
  drawLines();
  gtx.restore();
  gridTex.update(false);
  gridTex.hasAlpha = true;
  const puttGrid = MeshBuilder.CreateGround('puttGrid', { width: side, height: side, subdivisions: 24, updatable: true }, scene);
  puttGrid.position = new Vector3(gcx, 0, -gcy);
  // Conform the grid to the contoured green surface (each vertex floats a
  // constant skin above groundHeight at its WORLD spot) — re-run whenever the
  // grid re-orients so the skin still tracks the green under the rotated lattice.
  const conformGrid = (rot: number): void => {
    const rotC = Math.cos(rot);
    const rotS = Math.sin(rot);
    puttGrid.updateMeshPositions((pos) => {
      for (let i = 0; i < pos.length; i += 3) {
        const lx = pos[i];
        const lz = pos[i + 2];
        const wx = gcx + rotC * lx + rotS * lz;
        const wzOff = -rotS * lx + rotC * lz;
        const wy = gcy - wzOff;
        pos[i + 1] = engine.groundAt(wx, wy) + greenLift(wx, wy, hole) + 0.14;
      }
    }, true);
  };
  puttGrid.rotation.y = puttAids.rot;
  conformGrid(puttAids.rot);
  const gridMat = new StandardMaterial('puttGridMat', scene);
  gridMat.emissiveTexture = gridTex;
  gridMat.opacityTexture = gridTex;
  gridMat.disableLighting = true;
  gridMat.alpha = 0.45;
  puttGrid.material = gridMat;
  puttGrid.setEnabled(false);

  // Break-dot flow field: every dot drifts along the LOCAL breakAccel (the
  // same field the roll integrator uses), speed ∝ break magnitude — so the
  // aid always agrees with the actual putt. Shares puttAids.rot. See breakDots.ts.
  buildBreakDots(scene, hole, engine, puttGrid, (x, y) => engine.groundAt(x, y) + greenLift(x, y, hole), puttAids);
  // White ring marks the open cup while the pin is pulled. Drawn at the HONEST
  // cup radius (== the physics capture zone) so the target the player aims at is
  // exactly the target that catches the ball — no more "rolled right over the
  // hole". Thin tube so the smaller cup reads as a crisp painted rim.
  const cupRing = MeshBuilder.CreateTorus(
    'cupRing',
    { diameter: PHYSICS.cupRadius * 2, thickness: 0.09, tessellation: 28 },
    scene
  );
  const cupRingM = new StandardMaterial('cupRingM', scene);
  cupRingM.emissiveColor = new Color3(0.95, 0.98, 0.95);
  cupRingM.disableLighting = true;
  cupRing.material = cupRingM;
  cupRing.scaling.y = 0.05; // squashed flat: reads as painted on the green
  // Parented to the grid so it hides with it; but its LOCAL offset is
  // counter-rotated into the (dynamically rotated) grid frame so the ring
  // stays pinned over the cup no matter which way the grid is oriented.
  cupRing.parent = puttGrid;
  // Cup BEACON: the honest cup + thin rim are near-invisible from a long putt's
  // low telephoto camera against the two-tone green (playtest: "you can't even
  // see the hole"). A larger, gently pulsing halo ring marks the hole while the
  // putt grid is up — an aid ring, clearly not the cup itself, so the honest
  // capture size stays readable.
  const cupBeacon = MeshBuilder.CreateTorus(
    'cupBeacon',
    { diameter: PHYSICS.cupRadius * 6, thickness: 0.14, tessellation: 40 },
    scene
  );
  const cupBeaconM = new StandardMaterial('cupBeaconM', scene);
  cupBeaconM.emissiveColor = new Color3(1, 1, 1);
  cupBeaconM.disableLighting = true;
  cupBeaconM.alpha = 0.55;
  cupBeacon.material = cupBeaconM;
  cupBeacon.scaling.y = 0.05;
  cupBeacon.parent = puttGrid;
  scene.onBeforeRenderObservable.add(() => {
    if (!cupBeacon.isEnabled(false) || !puttGrid.isEnabled()) return;
    const t = animTime() * 2.4;
    cupBeaconM.alpha = 0.42 + 0.18 * Math.sin(t);
    const s = 1 + 0.08 * Math.sin(t * 0.5);
    cupBeacon.scaling.x = s;
    cupBeacon.scaling.z = s;
  });
  const placeCupRing = (rot: number): void => {
    const rotC = Math.cos(rot);
    const rotS = Math.sin(rot);
    // Offset from the GRID CENTRE (gcx/gcy — the two-lobe midpoint), not the
    // main lobe (g.cx/g.cy): the ring/beacon are parented to the grid, which
    // sits at gcx/gcy, so on a two-part green the old g.cx offset placed them a
    // half-lobe off the cup (owner: "the hole marker doesn't always render on
    // the hole when putting" — the two-lobe greens).
    const dx = hole.pin.x - gcx;
    const dzW = -(hole.pin.y - gcy);
    cupRing.position = new Vector3(rotC * dx - rotS * dzW, pinBaseH + 0.1, rotS * dx + rotC * dzW);
    cupBeacon.position = new Vector3(rotC * dx - rotS * dzW, pinBaseH + 0.12, rotS * dx + rotC * dzW);
  };
  placeCupRing(puttAids.rot);

  // ------------------------------------------------ camera occlusion (fade)
  // Trees AND authored rock/landform masses register in `canopyOcclusion`; any
  // that stand between the camera and the player's ball go translucent so they
  // never hide the shot (owner: fade "any asset that's between the tee and the
  // player after the tee shot"). Kept the `updateTreeOcclusion` name so callers
  // (main.ts) are undisturbed.
  // Regular (non-thin) InstancedMesh.visibility is a documented no-op in this
  // Babylon build (it just proxies the SHARED source mesh's value, logging a
  // warning on write) — there is no per-instance alpha in the instanced draw
  // path. Genuine translucency needs a standalone mesh with its own material,
  // so an occluding tree is swapped for a lazily-created, alpha-blended
  // "ghost" clone of its source mesh (hide the instance, show the ghost) —
  // bounded to the handful of trees ever near the camera at once, created and
  // disposed on entry/exit rather than kept live for the whole course.
  // Was 0.28, then 0.12 — owner still wanted the occluding trees to melt
  // further out of the way ("tree transparency needs to be ramped up to be
  // even more transparent"), so a ghosted canopy is now a faint 0.06 wash.
  const FADE_ALPHA = 0.06;
  const OCCLUSION_RECOMPUTE_EVERY = 4; // ~15Hz at 60fps — snappier as the camera orbits on aim
  // Worst case (camera embedded deep in a dense forest wall) can otherwise
  // pull in dozens of candidates — measured ~0.9ms per ghost clone+material
  // swap, so an uncapped recompute frame could hitch. A close-range gameplay
  // camera only ever needs a handful of trees faded for the effect to read;
  // past this cap the scene is thick enough the fade wouldn't help anyway.
  const MAX_GHOSTS_PER_PASS = 10;
  const ghostMatCache = new Map<StandardMaterial, StandardMaterial>();
  const ghostFor = (mat: StandardMaterial): StandardMaterial => {
    let g = ghostMatCache.get(mat);
    if (!g) {
      g = mat.clone(`${mat.name}Ghost`);
      g.alpha = FADE_ALPHA;
      g.backFaceCulling = false;
      ghostMatCache.set(mat, g);
    }
    return g;
  };
  const activeGhosts = new Map<PropHandle, Mesh>();
  let occlusionFrame = 0;
  const updateTreeOcclusion = (camPos: Vector3, golferPos: Vector3): void => {
    occlusionFrame++;
    if (occlusionFrame % OCCLUSION_RECOMPUTE_EVERY !== 0 || !canopyOcclusion.length) return;
    const dx = golferPos.x - camPos.x;
    const dz = golferPos.z - camPos.z;
    const segLen = Math.hypot(dx, dz);
    const nowOccluding = new Set<PropHandle>();
    if (segLen > 0.5) {
      const ux = dx / segLen;
      const uz = dz / segLen;
      // MASSES (rocks, rim cliffs) first so a blocking boulder is never starved
      // out of the per-pass ghost budget by faded foliage in front of it (Matt
      // review nit): a rock hiding the shot matters more than a tree already
      // going translucent beside it.
      const ordered =
        canopyOcclusion.length && canopyOcclusion.some((c) => c.mass)
          ? [...canopyOcclusion].sort((a, b) => (b.mass ? 1 : 0) - (a.mass ? 1 : 0))
          : canopyOcclusion;
      for (const c of ordered) {
        if (nowOccluding.size >= MAX_GHOSTS_PER_PASS) break;
        const tx = c.x - camPos.x;
        const tz = -c.y - camPos.z; // w2b maps world y -> Babylon -z
        const camDist2 = tx * tx + tz * tz;
        // Camera sitting INSIDE (or right at) a canopy fills the whole view with
        // trunk/leaves — the ball-tucked-in-the-woods case (see playtest shots).
        // The old between-cam-and-golfer test rejected exactly these trees (they
        // hug the camera, t≈0), so fade them unconditionally now.
        if (camDist2 < (c.r * 1.2) * (c.r * 1.2)) {
          for (const m of c.insts) nowOccluding.add(m);
          continue;
        }
        // Cheap reject: a tree further from the camera than the golfer (plus
        // its own canopy radius) can't sit "between" them.
        if (camDist2 > (segLen + c.r) * (segLen + c.r)) continue;
        const t = tx * ux + tz * uz; // projection onto the cam->golfer segment
        // Reject only trees clearly BEHIND the camera (can't block the forward
        // view) or clearly PAST the golfer toward the hole. A tree anywhere from
        // just in front of the lens through to right at the golfer DOES fade —
        // camera-hugging foliage is the worst offender when the ball is in trees.
        if (t < -c.r || t > segLen * 1.02) continue;
        const perp = Math.abs(tx * uz - tz * ux); // perpendicular offset from the line
        // 1.3× the canopy radius so a tree whose trunk sits just off the sightline
        // but whose canopy arches over the golfer still fades.
        if (perp < c.r * 1.3) for (const m of c.insts) nowOccluding.add(m);
      }
    }
    // Entering occlusion: hide the prop, show a translucent ghost.
    for (const prop of nowOccluding) {
      if (activeGhosts.has(prop) || !(prop.source.material instanceof StandardMaterial)) continue;
      const src = prop.source;
      const ghost = src.clone(`ghost${src.name}${activeGhosts.size}`, treeRoot);
      ghost.position.copyFrom(prop.position);
      ghost.rotation.set(0, prop.rotationY, 0);
      ghost.scaling.set(prop.scale, prop.scale, prop.scale);
      ghost.material = ghostFor(src.material as StandardMaterial);
      ghost.isPickable = false;
      ghost.doNotSyncBoundingInfo = true;
      ghost.receiveShadows = false;
      ghost.computeWorldMatrix(true);
      ghost.freezeWorldMatrix();
      prop.setVisible(false);
      activeGhosts.set(prop, ghost);
    }
    // Leaving occlusion: drop the ghost, show the prop again.
    for (const [prop, ghost] of activeGhosts) {
      if (nowOccluding.has(prop)) continue;
      ghost.dispose();
      prop.setVisible(true);
      activeGhosts.delete(prop);
    }
    // A fade only ever rewrites matrices already inside a batch's bounds, so
    // this is a small buffer re-upload on the frames the fade set changes.
    batcher?.flush();
  };

  return {
    sun,
    shadows,
    waterMirror,
    pin: [pole, flag],
    puttGrid,
    /** Re-point the putt grid + break dots down the golfer→hole line (one axis
     *  at the cup, the perpendicular for horizontal break). Call each putt. */
    orientPuttAids: (ballX: number, ballY: number): void => {
      const rot = Math.atan2(hole.pin.y - ballY, hole.pin.x - ballX);
      puttAids.rot = rot;
      puttGrid.rotation.y = rot;
      conformGrid(rot);
      placeCupRing(rot);
    },
    groundHeightAt: (x: number, y: number): number =>
      engine.groundAt(x, y) + (onTeePlatform(x, y, hole) ? TEE_TOP : greenLift(x, y, hole)),
    // Scatter drain AND the ship swap-in — the flyover gate waits on both
    // (still bounded by main.ts's MAX_NATURE_WAIT_MS fallback).
    natureReady: Promise.all([natureReady, shipReady]).then(() => undefined),
    // Resolves once the ground shader is compiled and the course can paint — the
    // loading veil and flyover wait on this so no blue frame is ever shown.
    groundReady,
    updateTreeOcclusion,
    shedQuality: (q): void => {
      // The mirror first — it is a second full render of the scene's
      // silhouettes, so dropping it is the biggest single saving available
      // without touching geometry. Unwire it from the water material before
      // disposing, or the material keeps a dangling reflectionTexture.
      if (q.waterReflectScale <= 0 && waterMirror) {
        for (const m of scene.materials) {
          const sm = m as StandardMaterial;
          if (sm.reflectionTexture === waterMirror) sm.reflectionTexture = null;
        }
        waterMirror.dispose();
        waterMirror = null;
      }
      const map = shadows.getShadowMap();
      if (map) {
        // `mapSize` is a real Babylon setter — it recreates the RTT at the new
        // size, so this frees GPU memory rather than just drawing less.
        if (q.shadowSize > 0 && q.shadowSize < shadows.mapSize) shadows.mapSize = q.shadowSize;
        if (q.staticShadows) {
          const fresh = shadows.getShadowMap();
          if (fresh) fresh.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
        }
      }
      if (q.scatterScale < 1) batcherRef?.thinTo(q.scatterScale);
    },
    invalidateShadows: (): void => {
      // Re-assigning the SAME refresh rate is not a no-op in Babylon: the
      // setter resets the refresh counter, which is exactly "capture one more
      // frame". Only meaningful while frozen — a live map is about to redraw
      // anyway.
      const sm = shadows.getShadowMap();
      if (sm && sm.refreshRate === RenderTargetTexture.REFRESHRATE_RENDER_ONCE) {
        sm.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      }
    },
    refreshParkedRTTs: (): void => {
      // Only while parked/frozen — otherwise the freeze observer owns the cadence.
      if (!renderPacing.cameraParked && !renderPacing.meterActive && !renderPacing.overhead) return;
      if (waterMirror) waterMirror.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      const sm = shadows.getShadowMap();
      if (sm) sm.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    },
    // During a drag-to-aim the camera is reframing every pointermove. Forcing a
    // RENDER_ONCE capture per move re-rendered both RTTs at input frequency
    // (120Hz pointers > frame rate) — worse than never freezing at all. While
    // the drag lasts, run the mirror + shadow map at the normal live cadence;
    // when it ends, take one fresh capture and hold it frozen (parked).
    aimDragRTTs: (dragging: boolean): void => {
      if (!renderPacing.cameraParked && !renderPacing.meterActive && !renderPacing.overhead) return;
      const rate = dragging
        ? RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES
        : RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      if (waterMirror && waterMirror.refreshRate !== rate) waterMirror.refreshRate = rate;
      // THE SHADOW MAP IS NOT ON THE MIRROR'S CADENCE HERE.
      //
      // A drag is a camera move, which the shadow map is blind to — but it is
      // not ONLY that: the golfer turns to face the new aim, so their shadow
      // does change and the map cannot simply stay frozen. What it does not
      // need is the mirror's every-other-frame rate. The one thing moving is a
      // single figure rotating slowly, so a coarse cadence tracks it with no
      // perceptible lag at a quarter of the cost, and the drag ends with the
      // usual single fresh capture.
      //
      // A tier that bakes the shadow map once stays baked through the drag.
      const shadowRate = quality.staticShadows
        ? RenderTargetTexture.REFRESHRATE_RENDER_ONCE
        : dragging
          ? DRAG_SHADOW_FRAMES
          : RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      const sm = shadows.getShadowMap();
      if (sm && sm.refreshRate !== shadowRate) sm.refreshRate = shadowRate;
    },
    occlusionCandidates: (): Array<{ x: number; y: number; r: number; parts: number }> =>
      canopyOcclusion.map((c) => ({ x: c.x, y: c.y, r: c.r, parts: c.insts.length }))
  };
}
