import {
  AbstractMesh,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  FresnelParameters,
  HemisphericLight,
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
} from '@babylonjs/core';
import { PHYSICS } from '../config';
import { animTime, isFrozen } from '../core/debugFlags';
import {
  blobHash,
  collectTreeBlobs,
  inTeePad,
  renderCourseCanvas,
  renderGreenPatch,
  TEXTURE_PAD,
  TreeBlob
} from '../core/rendering/CourseTexture';
import { CHECKER_ROTATION, mowCheckerboard } from '../core/rendering/mowPattern';
import { CourseTheme, shade } from '../core/rendering/Theme';
import { greenBoundaryScale, pointInPolygon } from '../utils/Geometry';
import { FRINGE_MARGIN, PhysicsEngine } from '../systems/PhysicsEngine';
import { WALL_DEPTH } from '../systems/HeightField';
import { HoleData } from '../core/types';
import { buildBreakDots } from './breakDots';
import { renderPacing } from './renderPacing';
import {
  BUSH_KEYS,
  CONIFER_KEYS,
  FLOWER_KEYS,
  GRASS_KEYS,
  hash2,
  loadNaturePrototypes,
  NaturePalette,
  NatureProto,
  STONE_KEYS,
  TREE_KEYS
} from './natureModels';

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

/** Smooth two-octave noise for cosmetic terrain undulation. */
function smoothNoise(x: number, y: number): number {
  return (
    Math.sin(x * 0.011 + Math.sin(y * 0.017) * 2) * 0.6 +
    Math.sin(y * 0.023 + Math.sin(x * 0.009) * 3) * 0.4
  );
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
  const heightAtPx = (x: number, y: number): number =>
    Math.sin(x * 0.35 + Math.sin(y * 0.3) * 2.6) * 0.6 +
    Math.sin((x * 0.5 - y * 0.42) * 0.7) * 0.4 +
    Math.sin((x + y * 1.7) * 0.21) * 0.3;
  const tex = new DynamicTexture('waterNormal', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = heightAtPx(x - 1, y) - heightAtPx(x + 1, y);
      const ny = heightAtPx(x, y - 1) - heightAtPx(x, y + 1);
      const len = Math.hypot(nx, ny, 1.2);
      const i = (y * size + x) * 4;
      img.data[i] = 128 + (nx / len) * 120;
      img.data[i + 1] = 128 + (ny / len) * 120;
      img.data[i + 2] = 128 + (1.2 / len) * 120;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = 3;
  tex.vScale = 3;
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
}

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

/** Green plateau lift profile shared by the plateau mesh and groundHeightAt. */
function greenLift(x: number, y: number, hole: HoleData): number {
  const f = ellipseFactor(x, y, hole.green);
  if (f <= 1) return GREEN_RAISE;
  // Approximate world distance beyond the green edge, smooth over the fringe
  const beyond = (f - 1) * Math.min(hole.green.rx, hole.green.ry);
  const s = Math.min(1, beyond / FRINGE_MARGIN);
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
export function buildCourse(
  scene: Scene,
  hole: HoleData,
  theme: CourseTheme,
  engine: PhysicsEngine
): Course3D {
  const pad = TEXTURE_PAD;
  const w = hole.world.width;
  const h = hole.world.height;

  // ----------------------------------------------------------- lights & fog
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.62;
  hemi.groundColor = c3(shade(theme.rough, 0.9));
  const sunFromRight = theme.sunX > 360;
  const sun = new DirectionalLight(
    'sun',
    new Vector3(sunFromRight ? -0.45 : 0.45, -1, -0.35).normalize(),
    scene
  );
  sun.intensity = 0.78;
  sun.position = w2b(hole.tee.x, hole.tee.y - 400, 600);
  const shadows = new ShadowGenerator(1024, sun);
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
  const heightAt = (wx: number, wy: number): number => {
    // Playable interior: the authored heightfield (the SAME terrain physics
    // rolls on — engine.groundAt), plus scenery mounds that ramp up smoothly
    // beyond the world edge only.
    const dx = Math.max(-30 - wx, wx - (w + 30), 0);
    const dy = Math.max(-30 - wy, wy - (h + 30), 0);
    const out = Math.hypot(dx, dy);
    const terrain = engine.groundAt(wx, wy);
    if (out <= 0) return terrain;
    // A sea-backdrop course must NOT raise a scenery mound beyond the world edge:
    // that ramp reads as a false shore ("a little green like it's land" behind an
    // island green). Keep the out-of-bounds ground flat so the extended ocean +
    // backdrop sea are all that shows on the horizon.
    if (theme.backdrop === 'sea') return terrain;
    const t = Math.min(1, out / 140);
    return terrain + t * (6 + smoothNoise(wx * 0.6, wy * 0.6) * 2.5 + smoothNoise(wx, wy) * 2.2);
  };
  ground.updateMeshPositions((positions) => {
    for (let i = 0; i < positions.length; i += 3) {
      const wx = positions[i] + w / 2;
      const wy = -(positions[i + 2] - h / 2) ;
      positions[i + 1] = heightAt(wx, wy);
    }
  }, true);
  ground.receiveShadows = true;

  // Adaptive bake resolution: the ground albedo bake is synchronous, so its
  // cost scales with the padded world area × scale². Capping the texel budget
  // keeps the per-hole build (the between-holes freeze) bounded even for a big
  // world — a wide links hole or a long par 5 — and, crucially, lets the
  // polished per-texel turf grain run on EVERY course without every hole
  // stalling like Timberline used to. Small holes still bake near the historical
  // scale 2; large ones ease down toward ~1.3. Near-field crispness is
  // unaffected: the green wears its own scale-6 patch and the ground carries
  // tiling detail + normal maps at gameplay-camera distance.
  const bakeArea = (w + pad * 2) * (h + pad * 2);
  const BAKE_TEXEL_BUDGET = 4_000_000;
  const bakeScale = Math.max(1, Math.min(2, Math.sqrt(BAKE_TEXEL_BUDGET / bakeArea)));
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

  // ----------------------------------------------------- green complex mesh
  // The putting surface is BUILT, not painted: a gently raised plateau with a
  // fringe-collar skirt, wearing its own high-resolution texture patch so the
  // green stays crisp at putting-camera distance. Physics remains flat — the
  // ball/golfer add groundHeightAt() when rendered.
  {
    const g = hole.green;
    const ANG = 56;
    // Ring radii factors: flat top out to the green edge, then skirt rings
    // stepping across the fringe down to ground level (slightly below to tuck)
    const topT = [0, 0.45, 0.8, 1];
    const skirtS = [0.18, 0.45, 0.72, 1, 1.18];
    const patch = renderGreenPatch(hole, theme, engine, FRINGE_MARGIN + 8, 6);
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const pushVert = (wx: number, wy: number, hgt: number): void => {
      positions.push(wx, hgt + engine.groundAt(wx, wy), -wy);
      uvs.push((wx - patch.x0) / patch.w, (wy - patch.y0) / patch.h);
    };
    const ringPoint = (theta: number, rxx: number, ryy: number): [number, number] => {
      // Scale the ring radius by the shared boundary wobble at the point's ACTUAL
      // local angle so the plateau/skirt mesh traces the same irregular edge the
      // physics test and albedo bake use (star-convex ⇒ the scale cancels out of
      // the angle, so mesh and point-in-green agree exactly).
      const lx0 = Math.cos(theta) * rxx;
      const ly0 = Math.sin(theta) * ryy;
      const w = greenBoundaryScale(Math.atan2(ly0, lx0), g);
      const lx = lx0 * w;
      const ly = ly0 * w;
      const c = Math.cos(g.rot ?? 0);
      const s = Math.sin(g.rot ?? 0);
      return [g.cx + lx * c - ly * s, g.cy + lx * s + ly * c];
    };
    // Center vertex + top rings at full raise
    pushVert(g.cx, g.cy, GREEN_RAISE);
    const rings: Array<{ rx: number; ry: number; h: number }> = [];
    for (const t of topT.slice(1)) rings.push({ rx: g.rx * t, ry: g.ry * t, h: GREEN_RAISE });
    for (const s of skirtS) {
      const beyond = s * FRINGE_MARGIN;
      const tt = Math.min(1, s);
      const fall = 1 - tt * tt * (3 - 2 * tt);
      rings.push({
        rx: g.rx + beyond,
        ry: g.ry + beyond,
        h: s >= 1.15 ? -0.25 : GREEN_RAISE * fall
      });
    }
    rings.forEach((ring) => {
      for (let a = 0; a < ANG; a++) {
        const [wx, wy] = ringPoint((a / ANG) * Math.PI * 2, ring.rx, ring.ry);
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
    const greenMesh = new Mesh('greenComplex', scene);
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
    const patchTex = new DynamicTexture('greenPatch', { width: patch.canvas.width, height: patch.canvas.height }, scene, true);
    patchTex.getContext().drawImage(patch.canvas, 0, 0);
    patchTex.update(false);
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
    greenMesh.material = gm;
    greenMesh.receiveShadows = true;
  }

  // ----------------------------------------------------------- tee platform
  {
    const p = teePlatform(hole);
    const baseH = engine.groundAt(hole.tee.x, hole.tee.y);
    // Babylon Y-rotation for a world-space axis direction (w2b flips world y)
    const rotY = Math.atan2(p.ay, p.ax);
    const base = MeshBuilder.CreateBox('teeBase', { width: p.w, depth: p.d, height: TEE_TOP - 0.22 }, scene);
    base.material = mat(scene, 'teeBaseMat', shade(theme.fairway, 0.5));
    base.position = w2b(p.cx, p.cy, baseH + (TEE_TOP - 0.22) / 2);
    base.rotation.y = rotY;
    const top = MeshBuilder.CreateBox('teeTop', { width: p.w + 1.2, depth: p.d + 1.2, height: 0.24 }, scene);
    top.material = mat(scene, 'teeTopMat', shade(theme.fairway, 1.12));
    top.position = w2b(p.cx, p.cy, baseH + TEE_TOP - 0.12);
    top.rotation.y = rotY;
    top.receiveShadows = true;
    shadows.addShadowCaster(base);
    // Tee markers at the front corners of the pad
    const markerMat = mat(scene, 'teeMarkerMat', 0xf2efe4, { emissive: 0x4a4638, spec: 0.2 });
    for (const side of [-1, 1]) {
      const mx = hole.tee.x - p.ay * side * (p.w / 2 - 2.4);
      const my = hole.tee.y + p.ax * side * (p.w / 2 - 2.4);
      const marker = MeshBuilder.CreateSphere(`teeMarker${side}`, { diameter: 1.5, segments: 10 }, scene);
      marker.material = markerMat;
      marker.position = w2b(mx, my, baseH + TEE_TOP + 0.5);
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
  let waterMirror: MirrorTexture | null = null;
  let wi = 0;
  for (const hz of hole.hazards) {
    if (hz.type !== 'water') continue;
    const level = hz.level ?? 0.35;
    if (theme.waterReflect && !waterMirror) {
      waterMirror = new MirrorTexture('waterMirror', { ratio: 0.35 }, scene, false);
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
        return (
          nm === 'sky' ||
          nm.startsWith('peak') ||
          nm.startsWith('cloud') ||
          nm.startsWith('cumulus') ||
          nm.startsWith('cirrus') ||
          (nm.startsWith('nat') && !nm.startsWith('natProto'))
        );
      };
      let lastCount = -1;
      let stable = 0;
      const fill = scene.onBeforeRenderObservable.add(() => {
        if (!waterMirror) return;
        // The mirror is frozen while the meter is live (see perf pacing below),
        // so don't spend a per-frame scene.meshes.filter + array alloc rebuilding
        // a render list nothing will draw until the shot goes.
        if (renderPacing.meterActive) return;
        const list = scene.meshes.filter(isReflectable);
        if (list.length === lastCount) {
          // Instances arrive in one synchronous burst after the glb resolves;
          // once the count holds for a few frames the forest is fully planted.
          if (++stable > 4 && lastCount > 0) scene.onBeforeRenderObservable.remove(fill);
          return;
        }
        lastCount = list.length;
        stable = 0;
        waterMirror.renderList = list;
      });
    }
    const cx = hz.polygon.reduce((a, p) => a + p[0], 0) / hz.polygon.length;
    const cy = hz.polygon.reduce((a, p) => a + p[1], 0) / hz.polygon.length;
    // Fan: deep center + shore ring + a mid ring for the depth gradient
    const positions: number[] = [cx, level, -cy];
    const colors: number[] = [];
    const uvs: number[] = [cx / 90, cy / 90];
    const deep = c3(theme.waterDeep);
    // Shore edge: a subtly DARKER, more opaque band (like the bank shadow real
    // water carries at its edge), not the old lightened translucent ring that
    // read as a weird light-blue halo on narrow creeks (Wildwood h1).
    const shore = c3(shade(theme.water, 0.9));
    colors.push(deep.r, deep.g, deep.b, 0.94);
    const ring = hz.polygon;
    const n = ring.length;
    for (const [x, y] of ring) {
      // mid ring vertex (60% toward shore): main body color
      const mx = cx + (x - cx) * 0.6;
      const my = cy + (y - cy) * 0.6;
      positions.push(mx, level, -my);
      uvs.push(mx / 90, my / 90);
      const body = c3(theme.water);
      colors.push(body.r, body.g, body.b, 0.88);
    }
    for (const [x, y] of ring) {
      positions.push(x, level, -y);
      uvs.push(x / 90, y / 90);
      colors.push(shore.r, shore.g, shore.b, 0.72); // firm, slightly-darker shoreline
    }
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      // center fan to mid ring
      indices.push(0, 1 + i2, 1 + i);
      // mid ring to shore ring quads
      indices.push(1 + i, 1 + n + i2, 1 + n + i);
      indices.push(1 + i, 1 + i2, 1 + n + i2);
    }
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
    wm.emissiveColor = c3(shade(theme.waterDeep, waterMirror ? 0.3 : 0.45));
    wm.specularColor = new Color3(0.75, 0.85, 0.95);
    wm.specularPower = 110;
    wm.alpha = 0.95;
    wm.bumpTexture = waterNormalTex;
    if (waterMirror) {
      // Fresnel: near-grazing (distant) water reads as a bright mirror; looked at
      // steeply (close) the reflection fades so the depth-tinted body shows —
      // how the reference ponds behave. The scrolling bump map ripples the mirror
      // so highlights shimmer instead of reading as a flat mirror sheet.
      wm.reflectionTexture = waterMirror;
      const fr = new FresnelParameters();
      fr.bias = 0.18;
      fr.power = 2;
      fr.leftColor = new Color3(reflectStrength, reflectStrength, reflectStrength);
      const dim = reflectStrength * 0.22;
      fr.rightColor = new Color3(dim, dim, dim);
      wm.reflectionFresnelParameters = fr;
    }
    waterMesh.material = wm;
    scene.onBeforeRenderObservable.add(() => {
      const t = animTime();
      waterNormalTex.uOffset = t * 0.018;
      waterNormalTex.vOffset = t * 0.011 + Math.sin(t * 0.4) * 0.02;
      wm.emissiveColor = c3(shade(theme.waterDeep, 0.42 + Math.sin(t * 1.3) * 0.06));
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
    stone: 0x7e7c72,
    grassLit: theme.lushGrass
  };
  // Only download the props this course's theme actually places (about half
  // the catalog) — both loadNaturePrototypes calls MUST share this set since
  // the loader caches per scene on the first call.
  const natKeys = [
    ...new Set<string>([
      ...(theme.treeKeys ?? TREE_KEYS),
      ...(theme.accentTreeKeys ?? []),
      ...(theme.scatterKeys ?? []),
      ...(theme.bushKeys ?? BUSH_KEYS),
      ...(theme.cloudKeys ?? []),
      ...STONE_KEYS,
      ...(theme.grassKeys ?? GRASS_KEYS),
      ...(theme.flowerKeys ?? FLOWER_KEYS),
      ...(theme.heatherKeys ?? []),
      ...(theme.sandPlantKeys ?? []),
      // Blooms a hand-placed garden bed uses beyond the theme's ambient set.
      ...(hole.gardens ?? []).flatMap((g) => g.flowerKeys ?? [])
    ])
  ];

  // -------------------------------------------------------------------- sky
  const sky = MeshBuilder.CreateSphere('sky', { diameter: 9000, sideOrientation: Mesh.BACKSIDE }, scene);
  sky.position = new Vector3(w / 2, 0, -h / 2);
  const skyTex = new DynamicTexture('skyTex', { width: 8, height: 256 }, scene, true);
  const sctx = skyTex.getContext();
  const grad = (sctx as CanvasRenderingContext2D).createLinearGradient(0, 0, 0, 256);
  const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
  if (theme.horizonTint !== undefined) {
    // Richer dome: an extra mid stop smooths the zenith falloff and a warm
    // band glows just above the treeline before dissolving into the haze.
    grad.addColorStop(0, hex(theme.skyTop));
    grad.addColorStop(0.3, hex(shade(theme.skyTop, 1.16)));
    grad.addColorStop(0.55, hex(shade(theme.skyTop, 1.35)));
    grad.addColorStop(0.76, hex(theme.skyBottom));
    grad.addColorStop(0.88, hex(theme.horizonTint));
    grad.addColorStop(1, hex(theme.haze));
  } else {
    grad.addColorStop(0, hex(theme.skyTop));
    grad.addColorStop(0.55, hex(shade(theme.skyTop, 1.35)));
    grad.addColorStop(0.8, hex(theme.skyBottom));
    grad.addColorStop(1, hex(theme.haze));
  }
  (sctx as CanvasRenderingContext2D).fillStyle = grad;
  sctx.fillRect(0, 0, 8, 256);
  skyTex.update(false);
  const skyMat = new StandardMaterial('skyMat', scene);
  skyMat.emissiveTexture = skyTex;
  skyMat.disableLighting = true;
  skyMat.backFaceCulling = false;
  sky.material = skyMat;
  sky.applyFog = false;
  sky.infiniteDistance = false;

  // Sun disc + clouds: emissive billboards high in the sky
  const sunBillboard = MeshBuilder.CreatePlane('sunDisc', { size: 260 }, scene);
  const sunTex = new DynamicTexture('sunTex', { width: 128, height: 128 }, scene, true);
  const suctx = sunTex.getContext() as CanvasRenderingContext2D;
  const rg = suctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,252,220,1)');
  rg.addColorStop(0.35, 'rgba(255,243,196,0.85)');
  rg.addColorStop(1, 'rgba(255,243,196,0)');
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

  if (theme.cloudStyle === 'wispy') {
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
    const softCloudTex = (name: string, tw: number, th: number, paint: (ctx: CanvasRenderingContext2D) => void): DynamicTexture => {
      const tex = new DynamicTexture(name, { width: tw, height: th }, scene, true);
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, tw, th);
      paint(ctx);
      tex.update(false);
      tex.hasAlpha = true;
      return tex;
    };
    // Puffy cumulus: a rounded cauliflower mound — near-circular bumps all the
    // way around (domed crown on top, bumpy base below, shoulders on the sides)
    // so there's no flat top line and the whole silhouette reads soft & round.
    const cumulusTex = softCloudTex('cumulusTex', 512, 320, (ctx) => {
      const blobs: Array<[number, number, number, number, number]> = [
        [0, 0, 120, 104, 0.85], // core
        [-42, -60, 76, 70, 0.8], [42, -66, 80, 72, 0.82], [0, -86, 68, 62, 0.78], // domed crown
        [-98, -18, 88, 80, 0.8], [98, -20, 90, 80, 0.8], // upper flanks
        [-142, 22, 78, 70, 0.72], [142, 24, 80, 68, 0.72], // shoulders
        [-70, 58, 84, 68, 0.7], [72, 60, 86, 66, 0.7], [0, 70, 92, 64, 0.74] // rounded base bumps
      ];
      for (const [dx, dy, rx, ry, a] of blobs) puff(ctx, 256 + dx, 180 + dy, rx, ry, a);
    });
    // Cirrus: a thin feathered streak that fades in and out along its length.
    const cirrusTex = softCloudTex('cirrusTex', 512, 96, (ctx) => {
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
    });
    const cloudMat = (name: string, tex: DynamicTexture): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.emissiveTexture = tex;
      m.opacityTexture = tex;
      m.disableLighting = true;
      m.backFaceCulling = false;
      return m;
    };
    const cumulusMat = cloudMat('cumulusMat', cumulusTex);
    const cirrusMat = cloudMat('cirrusMat', cirrusTex);

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
    for (let i = 0; i < 6; i++) {
      // Rounded cumulus mounds at varied heights (no flat band). Smaller and a
      // touch firmer than the softest pass so they read as real clouds.
      const j = hash2(i * 12.1, i * 4.7);
      const pw = 520 + j * 340;
      place(cumulusMat, pw, pw * 0.625, hole.tee.x - 2000 + i * (4000 / 6) + j * 260, hole.tee.y - 2600 - (i % 3) * 260, 430 + (i % 3) * 130 + j * 240, 0.8, 5 + j * 2.5, `cumulus${i}`);
    }
    for (let i = 0; i < 10; i++) {
      // Thin cirrus streaks — more of them, wide across the dome at varied
      // heights, kept low-opacity so they stay airy waves.
      const j = hash2(i * 7.9 + 2, i * 9.3);
      const pw = 860 + j * 540;
      place(cirrusMat, pw, pw * 0.1875, hole.tee.x - 3200 + i * (6400 / 10) + j * 280, hole.tee.y - 2900 - (i % 3) * 300, 780 + (i % 4) * 160 + j * 170, 0.5, 3.2 + j * 1.8, `cirrus${i}`);
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
    const count = Math.min(10, 4 + keys.length);
    void loadNaturePrototypes(scene, natPalette, natKeys).then((protos) => {
      for (let i = 0; i < count; i++) {
        const proto = protos.get(keys[i % keys.length]);
        if (!proto) continue;
        const jitter = hash2(i * 17.3, i * 5.1);
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

  // ------------------------------------------------------------ backdrop
  const peakDist = 2500;
  if (theme.backdrop === 'sea') {
    // Links course: a broad sea plane meeting the sky at a low horizon,
    // with animated sparkle instead of a mountain range
    const sea = MeshBuilder.CreateGround('sea', { width: 14000, height: 8000, subdivisions: 1 }, scene);
    sea.position = w2b(hole.pin.x, hole.pin.y - peakDist - 1400, -8);
    const seaMat = new StandardMaterial('seaMat', scene);
    seaMat.diffuseColor = c3(theme.water);
    seaMat.emissiveColor = c3(shade(theme.waterDeep, 0.7));
    seaMat.specularColor = new Color3(0.5, 0.6, 0.7);
    seaMat.specularPower = 64;
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
    // Decorative sailboats on the open sea behind the green (hole.sailboats). A
    // dark low hull, a thin mast, and a double-sided triangular sail — sized to
    // read as distant boats, parked a few hundred yards past the pin on the water.
    if (hole.sailboats && hole.sailboats > 0) {
      const hullMat = mat(scene, 'boatHull', 0x3a4756, { emissive: 0x1c2530 });
      const sailMat = mat(scene, 'boatSail', 0xf3f1e8, { emissive: 0xb9c0c8 });
      const mastMat = mat(scene, 'boatMast', 0x8a6a45);
      for (let i = 0; i < hole.sailboats; i++) {
        const t = hole.sailboats > 1 ? i / (hole.sailboats - 1) : 0.5;
        const sc = 34 + ((i * 37) % 12); // sail height in world units (~34-46)
        // Keep the pair near the green's line (the tee/approach view is portrait,
        // so its horizontal field is narrow) but just off the island so they read
        // as boats sitting on the open sea a short way behind the green.
        const bx = hole.pin.x + (t - 0.5) * 170 + ((i * 53) % 60) - 30;
        const by = hole.pin.y - 205 - ((i * 71) % 150); // behind the green, on the sea
        const yaw = (((i * 41) % 100) / 100) * Math.PI * 2;
        const boat = new TransformNode(`boat${i}`, scene);
        boat.position = w2b(bx, by, 0.35);
        boat.rotation = new Vector3(0, yaw, 0);
        const hull = MeshBuilder.CreateBox(
          `boatHull${i}`,
          { width: 0.95 * sc, height: 0.18 * sc, depth: 0.34 * sc },
          scene
        );
        hull.material = hullMat;
        hull.position = new Vector3(0, 0.09 * sc, 0);
        hull.parent = boat;
        const mast = MeshBuilder.CreateCylinder(
          `boatMast${i}`,
          { diameter: 0.035 * sc, height: 1.08 * sc, tessellation: 5 },
          scene
        );
        mast.material = mastMat;
        mast.position = new Vector3(0, 0.6 * sc, 0);
        mast.parent = boat;
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
      }
    }
  } else if (theme.backdrop === 'none') {
    // No backdrop scenery: the dense conifer wall (backdropTreeStep) plus open
    // sky is the horizon — deliberately no ridges or feature peak (Timberline).
  } else {
    // Soft, ROUNDED low hills on the far horizon — the old pointed cone "ridge"
    // + Fuji peak read as hard triangle mountains, which playtest wanted gone.
    // Flattened, haze-tinted domes sit low behind the treeline so the horizon
    // reads as gentle rolling land, never a spiky range.
    const hillMat = mat(scene, 'hill', shade(theme.skyTop, 1.06), { emissive: shade(theme.skyTop, 0.62) });
    for (let i = -3; i <= 3; i++) {
      const dome = MeshBuilder.CreateSphere(`hill${i}`, { diameter: 1400 + Math.abs(i) * 260, segments: 10 }, scene);
      dome.material = hillMat;
      // Very flat (wide, low) so it's a soft swell, not a peak; parked far back.
      dome.scaling = new Vector3(1.4, 0.16 + ((Math.abs(i) * 7) % 5) * 0.01, 1);
      dome.position = w2b(hole.pin.x + i * 660 + 120, hole.pin.y - peakDist - 200 - Math.abs(i) * 120, -60);
    }
  }

  // ------------------------------------------------------------------ trees
  // Real prop meshes from the purchased Fantastic Nature pack replace the old
  // procedural cylinders/spheres. Loading is async (glb), so instances plant a
  // moment after the hole builds — like the character models. Positions come
  // from the same collectTreeBlobs() the baked texture drops shadows for, so
  // trunks land on their shadows. (Palette defined above the sky section.)
  const treeRoot = new TransformNode('nature', scene);
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
    const trees = pickKeyed(theme.treeKeys ?? TREE_KEYS);
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
    const placeProto = (proto: NatureProto, x: number, y: number, targetH: number, tint?: Color4): void => {
      plantQueue.push(() => {
        const s = targetH / proto.height;
        const pos = w2b(x, y, heightAt(x, y));
        const rotY = hash2(y, x) * Math.PI * 2;
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
          if (tint && (part as Mesh & { tintable?: boolean }).tintable) inst.instancedBuffers.color = tint;
          // Scenery never moves: freeze the world matrix (thousands of static
          // instances otherwise recompute matrices EVERY frame — the real
          // steady-state cost behind "the meter doesn't move smoothly"), skip
          // bounding-info resyncs, and opt out of pointer picking.
          inst.computeWorldMatrix(true);
          inst.freezeWorldMatrix();
          inst.doNotSyncBoundingInfo = true;
          inst.isPickable = false;
        }
      });
    };
    // Time-sliced drain: run placement rows first (they enqueue instance thunks),
    // then the instances, all bounded to BUDGET_MS/frame so nothing the scatter
    // does can ever block a frame long enough to hitch the meter. Index cursors
    // (not shift()) keep the walk O(n). Fills in over ~1–2s of flyover.
    const BUDGET_MS = 3.5;
    // While the meter is live the camera is parked and the heavy per-frame GPU
    // costs (water mirror + shadow map) are frozen below, so the frame has ample
    // headroom — keep trickling scenery in on a small budget instead of a hard
    // pause. This fills scenery during the long aim window (fixes "nothing loads
    // left/right of the hole") without the drain ever hitching the bar.
    const AIM_BUDGET_MS = 1.0;
    const drain = scene.onBeforeRenderObservable.add(() => {
      const budget = renderPacing.meterActive ? AIM_BUDGET_MS : BUDGET_MS;
      const t0 = performance.now();
      for (;;) {
        let batch = 32; // amortize the performance.now() cost over a small batch
        while (batch-- > 0) {
          if (popHead < popQueue.length) popQueue[popHead++]();
          else if (plantHead < plantQueue.length) plantQueue[plantHead++]();
          else {
            scene.onBeforeRenderObservable.remove(drain);
            return;
          }
        }
        if (performance.now() - t0 >= budget) return;
      }
    });
    // ---------------------------------------------- parked-camera perf pacing
    // The swing-meter stutter on the water holes (Timberline h1/h3, Wildwood h3,
    // Port Johnson h3) was never the scatter drain — it is the two dominant
    // per-frame GPU costs: the planar water-reflection RTT (re-renders every
    // scatter instance) and the 1024² shadow map (full regen every frame). While
    // the meter is live the camera is parked at address and the only animating
    // thing is the 2D bar, so freeze both — each captures one fresh frame
    // (REFRESHRATE_RENDER_ONCE) then holds — and restore their live cadence the
    // instant the ball is struck and the flight camera takes over.
    const shadowMap = shadows.getShadowMap();
    let pacingFrozen = false;
    scene.onBeforeRenderObservable.add(() => {
      if (renderPacing.meterActive === pacingFrozen) return;
      pacingFrozen = renderPacing.meterActive;
      if (waterMirror) {
        waterMirror.refreshRate = pacingFrozen
          ? RenderTargetTexture.REFRESHRATE_RENDER_ONCE
          : RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES;
      }
      if (shadowMap) {
        shadowMap.refreshRate = pacingFrozen
          ? RenderTargetTexture.REFRESHRATE_RENDER_ONCE
          : RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
      }
    });
    // Deterministic per-tuft grass tint: vary brightness and nudge some tufts
    // warmer (yellow-green) so the field reads as varied blades, not flat green.
    const grassTint = (x: number, y: number): Color4 => {
      const lum = 0.72 + hash2(x * 1.7, y * 0.7) * 0.6; // 0.72..1.32
      const warm = hash2(x + 13, y - 9); // 0..1
      return new Color4(lum * (1 + warm * 0.2), lum, lum * (1 - warm * 0.12), 1);
    };
    // Fairway checkerboard tint (theme.mowPattern==='checker'): the tuft carpet
    // follows the SAME two-tone grid the ground bake paints, so the grass
    // reinforces the cells instead of speckling random brightness over them and
    // washing the pattern out. Light cell brighter, dark cell darker, with a
    // whisper of per-tuft jitter so cells aren't dead flat.
    const checkerAxis = Math.atan2(hole.pin.y - hole.tee.y, hole.pin.x - hole.tee.x) + CHECKER_ROTATION;
    const cax = Math.cos(checkerAxis);
    const cay = Math.sin(checkerAxis);
    const mowTile = theme.mowTile ?? 30;
    const fairwayTint = (x: number, y: number): Color4 => {
      const band = mowCheckerboard(x * cax + y * cay, -x * cay + y * cax, mowTile);
      // Light cells brighten fully; dark cells only dip a little so the fairway
      // carpet stays clearly above the rough in grayscale (matches the biased
      // ground bake in CourseTexture).
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
    const plantTree = (b: TreeBlob): void => {
      // Accent species (e.g. birch among Timberline's pines) on ~15% of trees.
      const set = accents.length && hash2(b.x * 1.7, b.y * 0.9) < 0.15 ? accents : trees;
      if (!set.length) return;
      const e = set[Math.floor(hash2(b.x, b.y) * set.length) % set.length];
      // Conifer silhouettes are tall and narrow; at broadleaf target heights
      // they read squat, so they grow taller from the same canopy radius —
      // with per-tree jitter so a pine wall gets a ragged natural skyline.
      const hMul = conifers.has(e.key) ? 2.3 + hash2(b.x * 1.3, b.y * 2.1) * 0.7 : 2.0;
      placeProto(e.proto, b.x, b.y, Math.max(24, b.r * hMul));
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
        for (let j = start; j < Math.min(start + 40, treeBlobs.length); j++) plantTree(treeBlobs[j]);
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
    const tuftStep = 34 / Math.sqrt(theme.tuftDensity);
    for (let yy = 0; yy < h; yy += tuftStep) {
      const yRow = yy;
      popQueue.push(() => {
      for (let xx = 0; xx < w; xx += tuftStep) {
        const surf = engine.surfaceAt(xx, yRow);
        if (surf !== 'rough' && surf !== 'fairway') continue;
        if (Math.hypot(xx - hole.pin.x, yRow - hole.pin.y) < 110) continue;
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
          // When the theme mows a checkerboard, the fairway carpet follows it so
          // the tufts read as the same two tones instead of random speckle.
          const fTint = lush ? (theme.mowPattern === 'checker' ? fairwayTint(jx, jy) : tint) : undefined;
          if (roll < (lush ? 0.9 : 0.62)) place(grasses, jx, jy, 0.85 + hash2(jx, jy) * 0.6, 3, fTint);
        } else {
          // Longer rough grass, plus the occasional bush/flower — knee-high at
          // most (the golfer is ~6 units; tufts must never read as walls). Cap
          // kept low (grass cards read as flat "2D blocks" the taller they get,
          // playtest) — the 3D bushes/flowers carry the visual interest instead.
          const cap = lush ? 3.4 : 3.0;
          if (roll < 0.5) place(grasses, jx, jy, Math.min(cap, (2.0 + hash2(jx, jy) * 1.2) * theme.roughTuftHeight), 3, tint);
          else if (roll < 0.55 && bushSet.length) {
            // The tall leafy plant (bush_kenney_b) stands a touch higher than the
            // rounded shrub; both stay knee-to-waist so they never read as walls.
            const e = bushSet[Math.floor(hash2(jx + 7, jy - 7) * bushSet.length) % bushSet.length];
            const bh = 3.2 + (e.key === 'bush_kenney_b' ? 1.0 : 0) + hash2(jy, jx) * 1.6;
            placeProto(e.proto, jx, jy, bh, lush ? bushTint(jx, jy) : undefined);
          }
          // Flowers: multi-colored + a wider band when lush (patchier bloom).
          else if (roll < (lush ? 0.64 : 0.59))
            place(flowers, jx, jy, 1.6 + hash2(jx + 3, jy) * 0.9, 13, lush ? flowerTint(jx, jy) : undefined);
          // Forest-floor props (ferns/stumps/logs/deadwood) where the theme
          // asks for them — rare, visual only (never physics). Heights are
          // keyed: a fallen trunk is height-scaled from its LYING pose (big
          // height = huge length), a broken snag should tower like a dead
          // spar, everything else stays knee-high.
          else if (scatter.length && roll < (lush ? 0.68 : 0.625)) {
            const e = scatter[Math.floor(hash2(jx + 17, jy - 17) * scatter.length) % scatter.length];
            const sh =
              e.key === 'tree_broken'
                ? 5.5 + hash2(jx, jy + 9) * 2.5
                : e.key === 'tree_fallen'
                  ? 1.6 + hash2(jx, jy + 9) * 0.6
                  : e.key.startsWith('stone')
                    ? 0.8 + hash2(jx, jy + 9) * 0.9
                    : 2.4 + hash2(jx + 7, jy) * 1.1;
            placeProto(e.proto, jx, jy, sh);
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
      const tgStep = 40 / Math.sqrt(Math.max(0.15, density));
      // Photo-textured heather / links-fescue cards (theme.heatherKeys) are the
      // preferred field content — real fescue + purple heather imagery, planted
      // untinted so the photo (incl. the purple bloom) reads true. Absent that,
      // fall back to the theme grass cards mixed with 3D tussock clumps.
      const heatherSet = pick(theme.heatherKeys ?? []);
      const clump3d = pick(['fern_kenney', 'bush_kenney_b']);
      for (let yy = 0; yy < h; yy += tgStep) {
        const yRow = yy;
        popQueue.push(() => {
        for (let xx = 0; xx < w; xx += tgStep) {
          if (engine.surfaceAt(xx, yRow) !== 'rough') continue;
          if (inTeePad(hole, xx, yRow)) continue;
          if (Math.hypot(xx - hole.tee.x, yRow - hole.tee.y) < 70) continue;
          if (Math.hypot(xx - hole.pin.x, yRow - hole.pin.y) < 90) continue;
          const jx = xx + (hash2(xx + 13, yRow) - 0.5) * tgStep * 0.9;
          const jy = yRow + (hash2(yRow + 13, xx) - 0.5) * tgStep * 0.9;
          if (engine.surfaceAt(jx, jy) !== 'rough') continue;
          const tall = cap * (0.6 + hash2(jx + 2, jy - 2) * 0.4);
          if (heatherSet.length) {
            place(heatherSet, jx, jy, tall);
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
                if (!pointInPolygon(jx, jy, hz.polygon)) continue;
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

    // Native plants scattered ON the sand (Pinehurst No. 2 waste look): sparse,
    // low wiregrass/bush clumps rising out of the exposed sand so a giant beach
    // reads as vegetated links waste rather than bare sand. Visual only; kept off
    // the tee/pin and thinned to occasional clumps so it never becomes a carpet.
    if (sandPlants.length) {
      // Waste-plant density is per-course: a Pinehurst waste can be sparse
      // accent clumps (default) or a dense aloe-dotted expanse (Sable Bay wants
      // "way more"). sandPlantStep = grid pitch (smaller = denser), sandPlantKeep
      // = fraction of cells kept (higher = denser).
      const sandStep = theme.sandPlantStep ?? 82;
      const keep = theme.sandPlantKeep ?? 0.5;
      for (let yy = 0; yy < h; yy += sandStep) {
        const yRow = yy;
        popQueue.push(() => {
          for (let xx = 0; xx < w; xx += sandStep) {
            if (engine.surfaceAt(xx, yRow) !== 'sand') continue;
            if (Math.hypot(xx - hole.pin.x, yRow - hole.pin.y) < 110) continue;
            if (Math.hypot(xx - hole.tee.x, yRow - hole.tee.y) < 60) continue;
            if (hash2(xx + 41, yRow + 19) > keep) continue; // thin to clumps
            const jx = xx + (hash2(xx, yRow) - 0.5) * sandStep * 0.7;
            const jy = yRow + (hash2(yRow + 3, xx) - 0.5) * sandStep * 0.7;
            if (engine.surfaceAt(jx, jy) !== 'sand') continue;
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
      // A bed can override the rainbow with its OWN colorway (e.g. white + pink
      // by every Wildwood green) — cycled across the bed with no species
      // preference so any bloom mesh takes the color.
      const bands: Array<{ hue: Color4; prefer: string[] }> =
        g.colors && g.colors.length
          ? g.colors.map((c) => ({ hue: Color4.FromColor3(c3(parseInt(c.replace('#', ''), 16))), prefer: [] }))
          : BANDS;
      // Species that only belong in their own band (never scattered generically).
      const banded = new Set(bands.flatMap((b) => b.prefer));
      const generic = bedFlowers.filter((e) => !banded.has(e.k));
      const step = tuftStep / Math.sqrt(g.density ?? 1);
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
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera;
    if (!cam) return;
    const fwd = cam.getDirection(Vector3.Forward());
    (petals.emitter as Vector3).copyFrom(cam.position.add(fwd.scale(55)));
    (petals.emitter as Vector3).y = Math.max(20, cam.position.y + 14);
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
  const maxR = Math.max(g.rx, g.ry);
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
  gtx.strokeStyle = 'rgba(255,255,255,0.42)';
  gtx.lineWidth = 1.5;
  const stepPx = (4 / side) * texW; // one cell ≈ 2 yards
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
  gtx.restore();
  gridTex.update(false);
  gridTex.hasAlpha = true;
  const puttGrid = MeshBuilder.CreateGround('puttGrid', { width: side, height: side, subdivisions: 24, updatable: true }, scene);
  puttGrid.position = new Vector3(g.cx, 0, -g.cy);
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
        const wx = g.cx + rotC * lx + rotS * lz;
        const wzOff = -rotS * lx + rotC * lz;
        const wy = g.cy - wzOff;
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
    const dx = hole.pin.x - g.cx;
    const dzW = -(hole.pin.y - g.cy);
    cupRing.position = new Vector3(rotC * dx - rotS * dzW, pinBaseH + 0.1, rotS * dx + rotC * dzW);
    cupBeacon.position = new Vector3(rotC * dx - rotS * dzW, pinBaseH + 0.12, rotS * dx + rotC * dzW);
  };
  placeCupRing(puttAids.rot);

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
      engine.groundAt(x, y) + (onTeePlatform(x, y, hole) ? TEE_TOP : greenLift(x, y, hole))
  };
}
