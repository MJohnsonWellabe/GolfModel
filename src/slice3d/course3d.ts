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
import { CourseTheme, shade } from '../core/rendering/Theme';
import { FRINGE_MARGIN, PhysicsEngine } from '../systems/PhysicsEngine';
import { HoleData } from '../core/types';
import {
  BUSH_KEYS,
  FLOWER_KEYS,
  GRASS_KEYS,
  hash2,
  loadNaturePrototypes,
  NaturePalette,
  NatureProto,
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
  scene.fogDensity = 0.00042;
  scene.fogColor = c3(theme.haze);

  // ---------------------------------------------------------------- terrain
  const ground = MeshBuilder.CreateGround(
    'ground',
    { width: w + pad * 2, height: h + pad * 2, subdivisions: 140, updatable: true },
    scene
  );
  ground.position = new Vector3(w / 2, 0, -h / 2);
  const heightAt = (wx: number, wy: number): number => {
    // The playable interior stays perfectly flat so the 2D physics ball
    // always sits on the visible turf; scenery mounds ramp up smoothly
    // beyond the world edge only.
    const dx = Math.max(-30 - wx, wx - (w + 30), 0);
    const dy = Math.max(-30 - wy, wy - (h + 30), 0);
    const out = Math.hypot(dx, dy);
    if (out <= 0) return 0;
    const t = Math.min(1, out / 140);
    return t * (6 + smoothNoise(wx * 0.6, wy * 0.6) * 2.5 + smoothNoise(wx, wy) * 2.2);
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
  // Tiling neutral-noise detail map keeps near-field turf crisp where the
  // baked albedo alone would blur under magnification
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
      positions.push(wx, hgt, -wy);
      uvs.push((wx - patch.x0) / patch.w, 1 - (wy - patch.y0) / patch.h);
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
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
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
    greenMesh.material = gm;
    greenMesh.receiveShadows = true;
  }

  // ----------------------------------------------------------- tee platform
  {
    const p = teePlatform(hole);
    // Babylon Y-rotation for a world-space axis direction (w2b flips world y)
    const rotY = Math.atan2(p.ay, p.ax);
    const base = MeshBuilder.CreateBox('teeBase', { width: p.w, depth: p.d, height: TEE_TOP - 0.22 }, scene);
    base.material = mat(scene, 'teeBaseMat', shade(theme.fairway, 0.5));
    base.position = w2b(p.cx, p.cy, (TEE_TOP - 0.22) / 2);
    base.rotation.y = rotY;
    const top = MeshBuilder.CreateBox('teeTop', { width: p.w + 1.2, depth: p.d + 1.2, height: 0.24 }, scene);
    top.material = mat(scene, 'teeTopMat', shade(theme.fairway, 1.12));
    top.position = w2b(p.cx, p.cy, TEE_TOP - 0.12);
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
      marker.position = w2b(mx, my, TEE_TOP + 0.5);
      shadows.addShadowCaster(marker);
    }
  }

  // ------------------------------------------------------------ bunker lips
  // Raised sand lips trace each bunker outline so traps read as dug features,
  // not painted patches (full dished terrain arrives with the heightfield).
  {
    const lipMat = mat(scene, 'bunkerLip', shade(theme.sand, 1.12), { spec: 0.05 });
    let bi = 0;
    for (const hz of hole.hazards) {
      if (hz.type !== 'bunker') continue;
      const path = [...hz.polygon, hz.polygon[0]].map(([x, y]) => w2b(x, y, 0.18));
      const lip = MeshBuilder.CreateTube(`bunkerLip${bi++}`, { path, radius: 1.0, tessellation: 8 }, scene);
      lip.material = lipMat;
      lip.receiveShadows = true;
    }
  }

  // ------------------------------------------------------------------ water
  for (const hz of hole.hazards) {
    if (hz.type !== 'water') continue;
    // Triangle fan from the centroid (pond polygons are convex enough)
    const cx = hz.polygon.reduce((a, p) => a + p[0], 0) / hz.polygon.length;
    const cy = hz.polygon.reduce((a, p) => a + p[1], 0) / hz.polygon.length;
    const positions: number[] = [cx, 0.35, -cy];
    const indices: number[] = [];
    hz.polygon.forEach(([x, y]) => positions.push(x, 0.35, -y));
    for (let i = 1; i <= hz.polygon.length; i++) {
      const j = i === hz.polygon.length ? 1 : i + 1;
      indices.push(0, j, i);
    }
    const waterMesh = new Mesh('water', scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    vd.applyToMesh(waterMesh);
    const wm = new StandardMaterial('waterMat', scene);
    wm.diffuseColor = c3(theme.water);
    wm.emissiveColor = c3(shade(theme.waterDeep, 0.55));
    wm.specularColor = new Color3(0.6, 0.7, 0.8);
    wm.specularPower = 96;
    wm.alpha = 0.82;
    // Drifting sparkle highlights sell the "small waves" the art bible asks for
    const sparkTex = new DynamicTexture('waterSpark', { width: 128, height: 128 }, scene, true);
    const sctx2 = sparkTex.getContext() as CanvasRenderingContext2D;
    sctx2.fillStyle = '#0b0e10';
    sctx2.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 26; i++) {
      const sx = (i * 47) % 128;
      const sy = (i * 83 + 31) % 128;
      const gl = sctx2.createRadialGradient(sx, sy, 0, sx, sy, 5);
      gl.addColorStop(0, 'rgba(235,246,255,0.9)');
      gl.addColorStop(1, 'rgba(235,246,255,0)');
      sctx2.fillStyle = gl;
      sctx2.fillRect(sx - 6, sy - 6, 12, 12);
    }
    sparkTex.update(false);
    sparkTex.wrapU = Texture.WRAP_ADDRESSMODE;
    sparkTex.wrapV = Texture.WRAP_ADDRESSMODE;
    sparkTex.uScale = 4;
    sparkTex.vScale = 4;
    wm.emissiveTexture = sparkTex;
    waterMesh.material = wm;
    scene.onBeforeRenderObservable.add(() => {
      const t = animTime();
      sparkTex.uOffset = t * 0.015;
      sparkTex.vOffset = Math.sin(t * 0.35) * 0.03;
      wm.emissiveColor = c3(shade(theme.waterDeep, 0.5 + Math.sin(t * 1.3) * 0.08));
    });
  }

  // -------------------------------------------------------------------- sky
  const sky = MeshBuilder.CreateSphere('sky', { diameter: 9000, sideOrientation: Mesh.BACKSIDE }, scene);
  sky.position = new Vector3(w / 2, 0, -h / 2);
  const skyTex = new DynamicTexture('skyTex', { width: 8, height: 256 }, scene, true);
  const sctx = skyTex.getContext();
  const grad = (sctx as CanvasRenderingContext2D).createLinearGradient(0, 0, 0, 256);
  const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
  grad.addColorStop(0, hex(theme.skyTop));
  grad.addColorStop(0.55, hex(shade(theme.skyTop, 1.35)));
  grad.addColorStop(0.8, hex(theme.skyBottom));
  grad.addColorStop(1, hex(theme.haze));
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
  // trunks land on their shadows.
  const natPalette: NaturePalette = {
    bark: theme.treeTrunk,
    foliage: theme.treeCanopy,
    foliageLight: theme.treeCanopyLight,
    grass: shade(theme.rough, 1.1),
    stone: 0x7e7c72
  };
  const treeRoot = new TransformNode('nature', scene);
  void loadNaturePrototypes(scene, natPalette).then((protos) => {
    const pick = (keys: readonly string[]): NatureProto[] =>
      keys.map((k) => protos.get(k)).filter((p): p is NatureProto => !!p);
    const trees = pick(TREE_KEYS);
    const bushes = pick(BUSH_KEYS);
    const grasses = pick(GRASS_KEYS);
    const flowers = pick(FLOWER_KEYS);
    // Trees do NOT cast dynamic shadows: their drop shadows are already baked
    // into the course texture (collectTreeBlobs), and adding the native-scale
    // prototypes as shadow casters would blow up the directional light's
    // shadow-map frustum and darken the whole (shadow-receiving) terrain.

    let n = 0;
    const place = (set: NatureProto[], x: number, y: number, targetH: number, jitter = 0): void => {
      if (!set.length) return;
      const proto = set[Math.floor(hash2(x + jitter, y - jitter) * set.length) % set.length];
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
      }
    };
    const plantTree = (b: TreeBlob): void => place(trees, b.x, b.y, Math.max(24, b.r * 2.0));

    for (const b of collectTreeBlobs(hole, theme.blossomChance)) plantTree(b);

    // Backdrop woods (scenery only — never on a playable surface): a wall of
    // trees behind the green and deep bands down both outer margins.
    const bands = [
      { x0: 40, x1: 860, y0: -190, y1: 180, step: 60 },
      { x0: -180, x1: 160, y0: 140, y1: h + 80, step: 74 },
      { x0: 740, x1: 1080, y0: 140, y1: h + 80, step: 74 }
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
    for (let yy = 0; yy < h; yy += 34) {
      for (let xx = 0; xx < w; xx += 34) {
        const surf = engine.surfaceAt(xx, yy);
        if (surf !== 'rough' && surf !== 'fairway') continue;
        if (Math.hypot(xx - hole.pin.x, yy - hole.pin.y) < 110) continue;
        // Keep tall grass off the mown tee pad (it reads as short, clean turf).
        if (inTeePad(hole, xx, yy)) continue;
        const jx = xx + (hash2(xx, yy) - 0.5) * 26;
        const jy = yy + (hash2(yy + 5, xx) - 0.5) * 26;
        if (engine.surfaceAt(jx, jy) !== surf) continue;
        const roll = hash2(xx + 91, yy + 47);
        if (surf === 'fairway') {
          // Short, dense mown tufts (kept low so they never block the ball read).
          if (roll < 0.62) place(grasses, jx, jy, 1.3 + hash2(jx, jy) * 0.9, 3);
        } else {
          // Longer rough grass, plus the occasional bush/stone/flower.
          if (roll < 0.5) place(grasses, jx, jy, 4.0 + hash2(jx, jy) * 2.6, 3);
          else if (roll < 0.55) place(bushes, jx, jy, 4.6 + hash2(jy, jx) * 2.2, 7);
          else if (roll < 0.59) place(flowers, jx, jy, 2.6 + hash2(jx + 3, jy) * 1.4, 13);
        }
      }
    }
  });

  // -------------------------------------------------------------------- pin
  // The pin lives on a root node that scales with camera distance (with a
  // minimum on-screen size), so the flag stays findable even on a 560yd tee
  // shot — the Tiger-Woods-style "always visible target".
  const pinBaseH = greenLift(hole.pin.x, hole.pin.y, hole);
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

  // Cup: small dark disc at the pin, sitting on the green plateau
  const cup = MeshBuilder.CreateDisc('cup', { radius: 1.15, tessellation: 20 }, scene);
  cup.rotation.x = Math.PI / 2;
  cup.material = mat(scene, 'cupMat', 0x0c2410, { emissive: 0x081a0b });
  cup.position = w2b(hole.pin.x, hole.pin.y, pinBaseH + 0.06);

  // Aim-mode highlight: a soft ring around the whole green complex so the
  // target reads from any distance in the setup/aerial views.
  const greenRing = MeshBuilder.CreateTorus('greenRing', { diameter: 2, thickness: 0.055, tessellation: 64 }, scene);
  greenRing.scaling = new Vector3(hole.green.rx + FRINGE_MARGIN + 9, 18, hole.green.ry + FRINGE_MARGIN + 9);
  if (hole.green.rot) greenRing.rotation.y = hole.green.rot;
  greenRing.position = w2b(hole.green.cx, hole.green.cy, GREEN_RAISE + 0.4);
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
  const puttGrid = MeshBuilder.CreateGround('puttGrid', { width: gridW, height: gridH, subdivisions: 1 }, scene);
  puttGrid.position = new Vector3(g.cx, GREEN_RAISE + 0.14, -g.cy);
  // Match an angled (kidney/oval) green so the clipped grid tracks its shape.
  if (g.rot) puttGrid.rotation.y = g.rot;
  const gridMat = new StandardMaterial('puttGridMat', scene);
  gridMat.emissiveTexture = gridTex;
  gridMat.opacityTexture = gridTex;
  gridMat.disableLighting = true;
  gridMat.alpha = 0.45;
  puttGrid.material = gridMat;
  puttGrid.setEnabled(false);

  // Break flow: crawling dots drifting downhill (speed ∝ slope strength) so
  // the break direction reads at a glance, like EG's putting aid
  const flowTex = new DynamicTexture('flowTex', { width: 64, height: 64 }, scene, true);
  const ftx = flowTex.getContext() as CanvasRenderingContext2D;
  ftx.clearRect(0, 0, 64, 64);
  for (const [fx, fy] of [[16, 18], [48, 44], [36, 6]]) {
    const fg = ftx.createRadialGradient(fx, fy, 0, fx, fy, 4.5);
    fg.addColorStop(0, 'rgba(255,255,255,0.95)');
    fg.addColorStop(1, 'rgba(255,255,255,0)');
    ftx.fillStyle = fg;
    ftx.fillRect(fx - 6, fy - 6, 12, 12);
  }
  flowTex.update(false);
  flowTex.hasAlpha = true;
  flowTex.wrapU = Texture.WRAP_ADDRESSMODE;
  flowTex.wrapV = Texture.WRAP_ADDRESSMODE;
  flowTex.uScale = (g.rx * 2 + 6) / 15;
  flowTex.vScale = (g.ry * 2 + 6) / 15;
  const flow = MeshBuilder.CreateDisc('puttFlow', { radius: 1, tessellation: 40 }, scene);
  flow.rotation.x = Math.PI / 2;
  flow.scaling = new Vector3(g.rx + 3, g.ry + 3, 1);
  flow.position = new Vector3(0, 0.05, 0);
  const flowMat = new StandardMaterial('puttFlowMat', scene);
  flowMat.emissiveTexture = flowTex;
  flowMat.opacityTexture = flowTex;
  flowMat.disableLighting = true;
  flowMat.alpha = 0.6;
  flow.material = flowMat;
  flow.parent = puttGrid;
  const slope = hole.slope;
  scene.onBeforeRenderObservable.add(() => {
    if (!flow.isEnabled() || isFrozen()) return;
    const fdt = scene.getEngine().getDeltaTime() / 1000;
    const rate = 0.28 * (0.35 + slope.strength) * fdt;
    flowTex.uOffset -= Math.cos(slope.angle) * rate;
    flowTex.vOffset += Math.sin(slope.angle) * rate;
  });
  // White ring marks the open cup while the pin is pulled
  const cupRing = MeshBuilder.CreateTorus('cupRing', { diameter: 3.1, thickness: 0.2, tessellation: 24 }, scene);
  const cupRingM = new StandardMaterial('cupRingM', scene);
  cupRingM.emissiveColor = new Color3(0.95, 0.98, 0.95);
  cupRingM.disableLighting = true;
  cupRing.material = cupRingM;
  cupRing.scaling.y = 0.05; // squashed flat: reads as painted on the green
  cupRing.parent = puttGrid;
  cupRing.position = new Vector3(hole.pin.x - g.cx, -0.02, -(hole.pin.y - g.cy));

  return {
    sun,
    shadows,
    pin: [pole, flag],
    puttGrid,
    greenRing,
    groundHeightAt: (x: number, y: number): number =>
      onTeePlatform(x, y, hole) ? TEE_TOP : Math.max(greenLift(x, y, hole), heightAt(x, y))
  };
}
