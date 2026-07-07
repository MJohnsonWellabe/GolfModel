import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  HemisphericLight,
  Mesh,
  MeshBuilder,
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
  hemi.intensity = 0.55;
  hemi.groundColor = c3(shade(theme.rough, 0.9));
  const sunFromRight = theme.sunX > 360;
  const sun = new DirectionalLight(
    'sun',
    new Vector3(sunFromRight ? -0.45 : 0.45, -1, -0.35).normalize(),
    scene
  );
  sun.intensity = 0.72;
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
    // Cosmetic elevation only where a ball can't play from
    let roughFrac = 0;
    for (const [dx, dy] of [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40]]) {
      const s = engine.surfaceAt(wx + dx, wy + dy);
      if (s === 'rough' || s === 'trees') roughFrac += 0.2;
    }
    const inWorld = wx > -30 && wx < w + 30 && wy > -30 && wy < h + 30;
    const base = inWorld ? 0 : 5 + smoothNoise(wx * 0.6, wy * 0.6) * 2.5;
    return base + roughFrac * (2.5 + smoothNoise(wx, wy) * 2.2);
  };
  ground.updateMeshPositions((positions) => {
    for (let i = 0; i < positions.length; i += 3) {
      const wx = positions[i] + w / 2;
      const wy = -(positions[i + 2] - h / 2) ;
      positions[i + 1] = heightAt(wx, wy);
    }
  }, true);
  ground.receiveShadows = true;

  const courseCanvas = renderCourseCanvas(hole, theme, engine, 1.5);
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
    waterMesh.material = wm;
    scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
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
  // Feature peak with a snow cap
  const peak = MeshBuilder.CreateCylinder('peak', { diameterTop: 0, diameterBottom: 1250, height: 620, tessellation: 6 }, scene);
  peak.material = mat(scene, 'peakMat', shade(theme.skyTop, 0.85), { emissive: shade(theme.skyTop, 0.4) });
  peak.position = w2b(hole.pin.x + 420, hole.pin.y - peakDist - 700, 200);
  const cap = MeshBuilder.CreateCylinder('peakCap', { diameterTop: 0, diameterBottom: 560, height: 280, tessellation: 6 }, scene);
  cap.material = mat(scene, 'capMat', 0xf4f8fb, { emissive: 0xdfe9f0 });
  cap.position = peak.position.add(new Vector3(0, 320, 0));

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
  const pole = MeshBuilder.CreateCylinder('pole', { diameter: 0.5, height: 9, tessellation: 8 }, scene);
  pole.material = mat(scene, 'poleMat', 0xf5f5f0, { emissive: 0x555550 });
  pole.position = w2b(hole.pin.x, hole.pin.y, 4.5);
  const flag = MeshBuilder.CreatePlane('flag', { width: 4.6, height: 2.8 }, scene);
  const flagMat = mat(scene, 'flagMat', 0xd23c3c, { emissive: 0x7c1f1f, spec: 0.1 });
  flagMat.backFaceCulling = false;
  flag.material = flagMat;
  flag.position = w2b(hole.pin.x + 2.3, hole.pin.y, 7.4);
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

  return { sun, shadows };
}
