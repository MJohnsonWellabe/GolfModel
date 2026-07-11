import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  ParticleSystem,
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
import { FRINGE_MARGIN, PhysicsEngine } from '../systems/PhysicsEngine';
import { HoleData } from '../core/types';
import { buildBreakDots } from './breakDots';
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
  /** Flagstick meshes — hidden while putting, like the pulled pin in EG. */
  pin: Mesh[];
  /** Translucent contour grid over the green, shown only while putting. */
  puttGrid: Mesh;
  /** Soft highlight ring around the green complex, shown while aiming full shots. */
  greenRing: Mesh;
  /**
   * Cosmetic ground height (world units) at a world point — the raised green
   * plateau and tee platform. Physics stays flat; ball/golfer/aim visuals add
   * this so they sit on the built surfaces. Stage B replaces the flat interior
   * with a real heightfield behind this same seam.
   */
  groundHeightAt: (x: number, y: number) => number;
}

/** Visual raise of the green plateau and the tee platform top (world units). */
const GREEN_RAISE = 0.55;
const TEE_TOP = 1.15;

/** Ellipse "radius factor" — <=1 inside, grows outward; rotation-aware. */
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
  return Math.sqrt(dx * dx + dy * dy);
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

  const courseCanvas = renderCourseCanvas(hole, theme, engine, 2);
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
      const lx = Math.cos(theta) * rxx;
      const ly = Math.sin(theta) * ryy;
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

  // ------------------------------------------------------------ bunker lips
  // Raised sand lips trace each bunker outline so traps read as dug features,
  // not painted patches (full dished terrain arrives with the heightfield).
  {
    // Sculpted courses (sandSculpt > 0) get a slimmer, warmer sun-dried crest
    // that hugs the ripple-textured sand instead of reading as bright piping;
    // the flat painted-disc courses keep the historical light-sand tube.
    const sculpted = (theme.sandSculpt ?? 0) > 0;
    const lipTint = sculpted ? theme.sandDark : shade(theme.sand, 1.12);
    const lipMat = mat(scene, 'bunkerLip', lipTint, { spec: 0.05 });
    let bi = 0;
    for (const hz of hole.hazards) {
      if (hz.type !== 'bunker') continue;
      const path = [...hz.polygon, hz.polygon[0]].map(([x, y]) =>
        w2b(x, y, (sculpted ? 0.1 : 0.18) + Math.max(engine.groundAt(x, y), greenLift(x, y, hole)))
      );
      const lip = MeshBuilder.CreateTube(
        `bunkerLip${bi++}`,
        { path, radius: sculpted ? 0.62 : 1.0, tessellation: 8 },
        scene
      );
      lip.material = lipMat;
      lip.receiveShadows = true;
    }
  }

  // ------------------------------------------------------------------ water
  // Art bible: water should be "one of the prettiest parts of every course" —
  // depth-tinted toward the middle, soft shore blend, animated wavelets
  // (scrolling normal map), and a fresnel sky sheen. All StandardMaterial +
  // vertex colors: no RTT reflections, mobile-safe.
  const waterNormalTex = makeWaterNormalTexture(scene);
  let wi = 0;
  for (const hz of hole.hazards) {
    if (hz.type !== 'water') continue;
    const level = hz.level ?? 0.35;
    const cx = hz.polygon.reduce((a, p) => a + p[0], 0) / hz.polygon.length;
    const cy = hz.polygon.reduce((a, p) => a + p[1], 0) / hz.polygon.length;
    // Fan: deep center + shore ring + a mid ring for the depth gradient
    const positions: number[] = [cx, level, -cy];
    const colors: number[] = [];
    const uvs: number[] = [cx / 90, cy / 90];
    const deep = c3(theme.waterDeep);
    const shore = c3(shade(theme.water, 1.35));
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
      colors.push(shore.r, shore.g, shore.b, 0.45); // soft shore fade
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
    wm.emissiveColor = c3(shade(theme.waterDeep, 0.45));
    wm.specularColor = new Color3(0.75, 0.85, 0.95);
    wm.specularPower = 110;
    wm.alpha = 0.95;
    wm.bumpTexture = waterNormalTex;
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
      ...(theme.flowerKeys ?? FLOWER_KEYS)
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

  if (theme.cloudKeys) {
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
    // Low sandy dune line so the course doesn't end in a hard edge
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
  } else {
    // Championship parkland: layered ridge line + a Fuji-like feature peak
    const ridgeMat = mat(scene, 'ridge', shade(theme.skyTop, 1.1), { emissive: shade(theme.skyTop, 0.55) });
    for (let i = -3; i <= 3; i++) {
      const m = MeshBuilder.CreateCylinder(
        `ridge${i}`,
        { diameterTop: 0, diameterBottom: 700 + Math.abs(i) * 160, height: 260 + ((i * 37) % 90), tessellation: 5 },
        scene
      );
      m.material = ridgeMat;
      m.position = w2b(hole.pin.x + i * 620 + 140, hole.pin.y - peakDist - Math.abs(i) * 240, 90);
    }
    const peak = MeshBuilder.CreateCylinder('peak', { diameterTop: 0, diameterBottom: 1750, height: 680, tessellation: 7 }, scene);
    peak.material = mat(scene, 'peakMat', shade(theme.skyTop, 0.52), { emissive: shade(theme.skyTop, 0.24) });
    peak.position = w2b(hole.pin.x + 380, hole.pin.y - peakDist - 780, 210);
    const cap = MeshBuilder.CreateCylinder('peakCap', { diameterTop: 0, diameterBottom: 800, height: 315, tessellation: 7 }, scene);
    cap.material = mat(scene, 'capMat', 0xf4f8fb, { emissive: 0xdfe9f0 });
    cap.position = peak.position.add(new Vector3(0, 335, 0));
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
    // Trees do NOT cast dynamic shadows: their drop shadows are already baked
    // into the course texture (collectTreeBlobs), and adding the native-scale
    // prototypes as shadow casters would blow up the directional light's
    // shadow-map frustum and darken the whole (shadow-receiving) terrain.

    let n = 0;
    const placeProto = (proto: NatureProto, x: number, y: number, targetH: number, tint?: Color4): void => {
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
        // Per-tuft tint (lush grass only; the buffer is registered on grass
        // prototypes in natureModels when grassLit) breaks the flat one-color read.
        if (tint) inst.instancedBuffers.color = tint;
      }
    };
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
    for (const b of collectTreeBlobs(hole, theme.blossomChance, true)) plantTree(b);

    // Backdrop woods (scenery only — never on a playable surface): a wall of
    // trees behind the green and deep bands down both outer margins. Forest
    // themes tighten the grid via backdropTreeStep for a denser wall.
    const bStep = theme.backdropTreeStep;
    const bands = [
      { x0: 40, x1: 860, y0: -190, y1: 180, step: bStep ?? 60 },
      { x0: -180, x1: 160, y0: 140, y1: h + 80, step: bStep ? Math.round(bStep * 1.23) : 74 },
      { x0: 740, x1: 1080, y0: 140, y1: h + 80, step: bStep ? Math.round(bStep * 1.23) : 74 }
    ];
    for (const band of bands) {
      for (let yy = band.y0; yy < band.y1; yy += band.step) {
        for (let xx = band.x0; xx < band.x1; xx += band.step) {
          if (blobHash(xx + 13, yy + 29) < 0.25) continue; // organic gaps
          const jx = xx + (blobHash(xx, yy) - 0.5) * 44;
          const jy = yy + (blobHash(yy, xx) - 0.5) * 44;
          const s = engine.surfaceAt(jx, jy);
          if (s === 'green' || s === 'fringe' || s === 'fairway' || s === 'sand' || s === 'water') continue;
          if (Math.hypot(jx - hole.pin.x, jy - hole.pin.y) < 130) continue;
          plantTree({ x: jx, y: jy, r: 15 + blobHash(xx + 7, yy + 3) * 12, kind: 0, tint: 1 });
        }
      }
    }

    // Ground detail encodes grass LENGTH by surface: tall, sparse tufts +
    // stones/bushes on the rough; short, dense tufts on the fairway; nothing on
    // the green (mown smooth) — so fairway/rough/green read differently up close.
    // tuftDensity 1 keeps the exact historical 34-unit grid (hash-stable).
    const tuftStep = 34 / Math.sqrt(theme.tuftDensity);
    for (let yy = 0; yy < h; yy += tuftStep) {
      for (let xx = 0; xx < w; xx += tuftStep) {
        const surf = engine.surfaceAt(xx, yy);
        if (surf !== 'rough' && surf !== 'fairway') continue;
        if (Math.hypot(xx - hole.pin.x, yy - hole.pin.y) < 110) continue;
        // Keep tall grass off the mown tee pad (it reads as short, clean turf)
        // and out of the tee approach — a tuft right in front of the camera
        // reads huge at address.
        if (inTeePad(hole, xx, yy)) continue;
        if (Math.hypot(xx - hole.tee.x, yy - hole.tee.y) < 55) continue;
        const jx = xx + (hash2(xx, yy) - 0.5) * 26;
        const jy = yy + (hash2(yy + 5, xx) - 0.5) * 26;
        if (engine.surfaceAt(jx, jy) !== surf) continue;
        const roll = hash2(xx + 91, yy + 47);
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
          // Longer rough grass, plus the occasional bush/flower — knee-high
          // at most (the golfer is ~6 units; tufts must never read as walls).
          // Hard cap: tufts stay knee-high whatever the theme multiplier —
          // the golfer is ~6 units, tufts "must never read as walls".
          const cap = lush ? 4.6 : 3.4;
          if (roll < 0.5) place(grasses, jx, jy, Math.min(cap, (2.0 + hash2(jx, jy) * 1.2) * theme.roughTuftHeight), 3, tint);
          else if (roll < 0.55 && bushSet.length) {
            // Same proto-choice hash place() used (jitter 7) so the classic
            // bush_a/b courses keep their exact historical layout. Low
            // sprawlers (juniper: 1.5x0.9 footprint) get a knee-high target —
            // height-scaling a wide-low mesh to bush height reads as a
            // fairway-swallowing blob.
            const e = bushSet[Math.floor(hash2(jx + 7, jy - 7) * bushSet.length) % bushSet.length];
            const bh = e.key === 'bush_juniper' ? 1.5 + hash2(jy, jx) * 0.7 : 3.2 + hash2(jy, jx) * 1.6;
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
    }

    // Weathered stones ring each bunker's outside edge (theme.bunkerStones):
    // sparse, on the surrounding rough only (never sand/fairway/green), so a
    // trap reads as dug into the terrain rather than laid onto it.
    if (theme.bunkerStones) {
      const stones = pickKeyed(STONE_KEYS);
      for (const hz of hole.hazards) {
        if (!stones.length) break;
        if (hz.type !== 'bunker') continue;
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
    }
  });

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

  // Aim-mode highlight: a soft ring around the whole green complex so the
  // target reads from any distance in the setup/aerial views.
  const greenRing = MeshBuilder.CreateTorus('greenRing', { diameter: 2, thickness: 0.055, tessellation: 64 }, scene);
  greenRing.scaling = new Vector3(hole.green.rx + FRINGE_MARGIN + 9, 18, hole.green.ry + FRINGE_MARGIN + 9);
  if (hole.green.rot) greenRing.rotation.y = hole.green.rot;
  greenRing.position = w2b(
    hole.green.cx,
    hole.green.cy,
    GREEN_RAISE + 0.4 + engine.groundAt(hole.green.cx, hole.green.cy)
  );
  const ringMat = new StandardMaterial('greenRingMat', scene);
  ringMat.emissiveColor = new Color3(1, 0.93, 0.55);
  ringMat.disableLighting = true;
  ringMat.alpha = 0.5;
  greenRing.material = ringMat;
  scene.onBeforeRenderObservable.add(() => {
    if (!greenRing.isEnabled()) return;
    ringMat.alpha = 0.38 + 0.16 * Math.sin(animTime() * 2.2);
  });
  greenRing.setEnabled(false);

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
  // EG-signature reading aid: a soft white grid clipped to the green ellipse
  const g = hole.green;
  const gridW = g.rx * 2 + 12;
  const gridH = g.ry * 2 + 12;
  const texW = 1024;
  const texH = Math.max(256, Math.round((texW * gridH) / gridW));
  const gridTex = new DynamicTexture('puttGridTex', { width: texW, height: texH }, scene, true);
  const gtx = gridTex.getContext() as CanvasRenderingContext2D;
  gtx.clearRect(0, 0, texW, texH);
  gtx.save();
  gtx.beginPath();
  gtx.ellipse(texW / 2, texH / 2, (g.rx / gridW) * 2 * texW * 0.5, (g.ry / gridH) * 2 * texH * 0.5, 0, 0, Math.PI * 2);
  gtx.clip();
  gtx.strokeStyle = 'rgba(255,255,255,0.42)';
  gtx.lineWidth = 1.5;
  const stepPx = (4 / gridW) * texW; // one cell ≈ 2 yards
  for (let x = 0; x <= texW; x += stepPx) {
    gtx.beginPath();
    gtx.moveTo(x, 0);
    gtx.lineTo(x, texH);
    gtx.stroke();
  }
  for (let y = 0; y <= texH; y += stepPx) {
    gtx.beginPath();
    gtx.moveTo(0, y);
    gtx.lineTo(texW, y);
    gtx.stroke();
  }
  gtx.restore();
  gridTex.update(false);
  gridTex.hasAlpha = true;
  const puttGrid = MeshBuilder.CreateGround('puttGrid', { width: gridW, height: gridH, subdivisions: 24, updatable: true }, scene);
  puttGrid.position = new Vector3(g.cx, 0, -g.cy);
  // Match an angled (kidney/oval) green so the clipped grid tracks its shape.
  if (g.rot) puttGrid.rotation.y = g.rot;
  {
    // Conform the grid to the contoured green surface: each vertex floats a
    // constant skin above groundHeight (terrain + plateau) at its WORLD spot.
    const rotC = Math.cos(g.rot ?? 0);
    const rotS = Math.sin(g.rot ?? 0);
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
  }
  const gridMat = new StandardMaterial('puttGridMat', scene);
  gridMat.emissiveTexture = gridTex;
  gridMat.opacityTexture = gridTex;
  gridMat.disableLighting = true;
  gridMat.alpha = 0.45;
  puttGrid.material = gridMat;
  puttGrid.setEnabled(false);

  // Break-dot flow field: every dot drifts along the LOCAL breakAccel (the
  // same field the roll integrator uses), speed ∝ break magnitude — so the
  // aid always agrees with the actual putt. See breakDots.ts.
  buildBreakDots(scene, hole, engine, puttGrid, (x, y) => engine.groundAt(x, y) + greenLift(x, y, hole));
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
  cupRing.parent = puttGrid;
  {
    // Counter-rotate the world offset into the (possibly rotated) grid frame
    const rotC = Math.cos(g.rot ?? 0);
    const rotS = Math.sin(g.rot ?? 0);
    const dx = hole.pin.x - g.cx;
    const dzW = -(hole.pin.y - g.cy);
    cupRing.position = new Vector3(rotC * dx - rotS * dzW, pinBaseH + 0.1, rotS * dx + rotC * dzW);
  }

  return {
    sun,
    shadows,
    pin: [pole, flag],
    puttGrid,
    greenRing,
    groundHeightAt: (x: number, y: number): number =>
      engine.groundAt(x, y) + (onTeePlatform(x, y, hole) ? TEE_TOP : greenLift(x, y, hole))
  };
}
