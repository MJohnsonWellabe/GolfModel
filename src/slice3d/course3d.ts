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
import { blobHash, collectTreeBlobs, renderCourseCanvas, TEXTURE_PAD, TreeBlob } from '../core/rendering/CourseTexture';
import { CourseTheme, shade } from '../core/rendering/Theme';
import { PhysicsEngine } from '../systems/PhysicsEngine';
import { HoleData } from '../core/types';

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
  courseTex.getContext().drawImage(courseCanvas, 0, 0);
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
      const t = performance.now() / 1000;
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
    const dt = scene.getEngine().getDeltaTime() / 1000;
    for (const cl of clouds) cl.position.x += dt * 6;
  });

  // -------------------------------------------------------------- mountains
  const ridgeMat = mat(scene, 'ridge', shade(theme.skyTop, 1.1), { emissive: shade(theme.skyTop, 0.55) });
  const peakDist = 2500;
  for (let i = -3; i <= 3; i++) {
    const m = MeshBuilder.CreateCylinder(
      `ridge${i}`,
      { diameterTop: 0, diameterBottom: 700 + Math.abs(i) * 160, height: 260 + ((i * 37) % 90), tessellation: 5 },
      scene
    );
    m.material = ridgeMat;
    m.position = w2b(hole.pin.x + i * 620 + 140, hole.pin.y - peakDist - Math.abs(i) * 240, 90);
  }
  // Feature peak: broad Fuji-like cone with a generous snow cap
  const peak = MeshBuilder.CreateCylinder('peak', { diameterTop: 0, diameterBottom: 1750, height: 680, tessellation: 7 }, scene);
  peak.material = mat(scene, 'peakMat', shade(theme.skyTop, 0.52), { emissive: shade(theme.skyTop, 0.24) });
  peak.position = w2b(hole.pin.x + 380, hole.pin.y - peakDist - 780, 210);
  const cap = MeshBuilder.CreateCylinder('peakCap', { diameterTop: 0, diameterBottom: 800, height: 315, tessellation: 7 }, scene);
  cap.material = mat(scene, 'capMat', 0xf4f8fb, { emissive: 0xdfe9f0 });
  cap.position = peak.position.add(new Vector3(0, 335, 0));

  // ------------------------------------------------------------------ trees
  const trunkProto = MeshBuilder.CreateCylinder('trunkP', { diameter: 2.6, height: 9, tessellation: 6 }, scene);
  trunkProto.material = mat(scene, 'trunkMat', theme.treeTrunk);
  trunkProto.position.y = -800; // parked prototype; instances render on their own
  const canopyMats = {
    dark: mat(scene, 'canDark', shade(theme.treeCanopy, 0.9)),
    mid: mat(scene, 'canMid', theme.treeCanopyLight),
    light: mat(scene, 'canLight', shade(theme.treeCanopyLight, 1.18)),
    blossom: mat(scene, 'canBlossom', 0xdd96bd),
    blossomLight: mat(scene, 'canBlossomL', 0xefb6d2)
  };
  const canopyProtos: Record<string, Mesh> = {};
  for (const [k, m] of Object.entries(canopyMats)) {
    const p = MeshBuilder.CreateSphere(`can-${k}`, { diameter: 16, segments: 5 }, scene);
    p.material = m;
    p.position.y = -800; // parked prototype
    canopyProtos[k] = p;
  }
  const treeRoot = new TransformNode('trees', scene);
  const plant = (b: TreeBlob): void => {
    const r = b.r * 0.7;
    const trunkH = b.kind === 1 ? r * 1.7 : r * 1.1;
    const base = w2b(b.x, b.y, heightAt(b.x, b.y));
    const trunk = trunkProto.createInstance(`t${b.x}`);
    trunk.scaling = new Vector3(r / 9, trunkH / 9, r / 9);
    trunk.position = base.add(new Vector3(0, trunkH / 2, 0));
    trunk.parent = treeRoot;
    const isBlossom = b.kind === 3;
    const mainKey = isBlossom ? 'blossom' : b.tint > 1 ? 'light' : b.tint > 0.92 ? 'mid' : 'dark';
    const hiKey = isBlossom ? 'blossomLight' : 'light';
    const lobes: Array<[number, number, number, number]> =
      b.kind === 1
        ? [[0, trunkH + r * 0.9, 0, r * 0.66], [0, trunkH + r * 1.5, 0, r * 0.5]]
        : b.kind === 2
          ? [[-r * 0.5, trunkH + r * 0.55, 0, r * 0.62], [r * 0.5, trunkH + r * 0.6, 0, r * 0.66], [0, trunkH + r * 1.0, 0, r * 0.58]]
          : [[0, trunkH + r * 0.7, 0, r * 0.8], [-r * 0.45, trunkH + r * 0.5, r * 0.2, r * 0.5], [r * 0.4, trunkH + r * 0.95, -r * 0.15, r * 0.45]];
    lobes.forEach(([ox, oy, oz, lr], li) => {
      const key = li === lobes.length - 1 ? hiKey : mainKey;
      const inst = canopyProtos[key].createInstance(`c${b.x}-${li}`);
      inst.scaling = new Vector3((lr * 2) / 16, (lr * 1.7) / 16, (lr * 2) / 16);
      inst.position = base.add(new Vector3(ox, oy, -oz));
      inst.parent = treeRoot;
    });
  };
  for (const b of collectTreeBlobs(hole, theme.blossomChance)) plant(b);

  // Backdrop woods (scenery only — never on a playable surface, so the 2D
  // physics and course data stay untouched): an azalea-heavy wall behind the
  // green and deep tree bands along both outer margins, like the references.
  const bands = [
    { x0: 40, x1: 860, y0: -190, y1: 180, step: 58, blossom: Math.max(theme.blossomChance, 0.35) },
    { x0: -180, x1: 160, y0: 140, y1: h + 80, step: 72, blossom: theme.blossomChance },
    { x0: 740, x1: 1080, y0: 140, y1: h + 80, step: 72, blossom: theme.blossomChance }
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
        const k = blobHash(xx + 31, yy + 17);
        plant({
          x: jx,
          y: jy,
          r: 15 + blobHash(xx + 7, yy + 3) * 12,
          kind: k < band.blossom ? 3 : Math.floor(((k - band.blossom) / (1 - band.blossom)) * 3),
          tint: 0.82 + blobHash(xx + 3, yy + 11) * 0.32
        });
      }
    }
  }

  // -------------------------------------------------------------------- pin
  const pole = MeshBuilder.CreateCylinder('pole', { diameter: 0.55, height: 12, tessellation: 8 }, scene);
  pole.material = mat(scene, 'poleMat', 0xf5f5f0, { emissive: 0x555550 });
  pole.position = w2b(hole.pin.x, hole.pin.y, 6);
  const flag = MeshBuilder.CreatePlane('flag', { width: 5.4, height: 3.2 }, scene);
  const flagMat = mat(scene, 'flagMat', 0xd23c3c, { emissive: 0x7c1f1f, spec: 0.1 });
  flagMat.backFaceCulling = false;
  flag.material = flagMat;
  flag.position = w2b(hole.pin.x + 2.7, hole.pin.y, 10.2);
  scene.onBeforeRenderObservable.add(() => {
    const t = performance.now() / 1000;
    flag.rotation.y = Math.sin(t * 3.1) * 0.28;
    flag.rotation.z = Math.sin(t * 5.3) * 0.06;
  });
  shadows.addShadowCaster(pole);
  shadows.addShadowCaster(flag);

  // Cup: small dark disc at the pin
  const cup = MeshBuilder.CreateDisc('cup', { radius: 1.15, tessellation: 20 }, scene);
  cup.rotation.x = Math.PI / 2;
  cup.material = mat(scene, 'cupMat', 0x0c2410, { emissive: 0x081a0b });
  cup.position = w2b(hole.pin.x, hole.pin.y, 0.06);

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
  petals.start();
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
  puttGrid.position = new Vector3(g.cx, 0.14, -g.cy);
  const gridMat = new StandardMaterial('puttGridMat', scene);
  gridMat.emissiveTexture = gridTex;
  gridMat.opacityTexture = gridTex;
  gridMat.disableLighting = true;
  gridMat.alpha = 0.45;
  puttGrid.material = gridMat;
  puttGrid.setEnabled(false);
  // White ring marks the open cup while the pin is pulled
  const cupRing = MeshBuilder.CreateTorus('cupRing', { diameter: 3.1, thickness: 0.2, tessellation: 24 }, scene);
  const cupRingM = new StandardMaterial('cupRingM', scene);
  cupRingM.emissiveColor = new Color3(0.95, 0.98, 0.95);
  cupRingM.disableLighting = true;
  cupRing.material = cupRingM;
  cupRing.scaling.y = 0.05; // squashed flat: reads as painted on the green
  cupRing.parent = puttGrid;
  cupRing.position = new Vector3(hole.pin.x - g.cx, -0.02, -(hole.pin.y - g.cy));

  return { sun, shadows, pin: [pole, flag], puttGrid };
}
