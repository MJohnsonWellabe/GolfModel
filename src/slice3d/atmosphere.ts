import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3
} from '@babylonjs/core';
import { isFrozen } from '../core/debugFlags';
import { hash2 } from '../systems/treeField';

/**
 * Ambient course life (V2 Phase 4 — see docs/content/COURSE_ATMOSPHERE_BIBLE.md).
 *
 * Every mover follows the proven gull/cloud pattern: a billboard quad with a
 * small DynamicTexture silhouette, advanced in place inside one
 * onBeforeRenderObservable — alloc-free per frame, looping so the sky is
 * never left empty, frozen for screenshot captures, and disposed with the
 * scene. Mesh names (bird…, butterfly…, hawk…, mist…) match none of the
 * water reflection render-list patterns, so ambient motion can never force
 * a mirror redraw while the camera is parked (parked-RTT safety).
 *
 * Budgets (bible): ≤6 movers, ≤3 small textures, 1 observer per hole.
 * The caller gates on the `atmosphere` feature flag and resolves the kind
 * from the course theme.
 */

export type AtmosphereKind = 'coastal' | 'forest' | 'alpine' | 'none';

interface Anchor {
  tee: { x: number; y: number };
  pin: { x: number; y: number };
}

/** World→Babylon converter, passed in from course3d to avoid an import cycle. */
type W2B = (x: number, y: number, h?: number) => Vector3;

/** A silhouette painted onto a small alpha texture + unlit billboard material. */
function billboardMat(
  scene: Scene,
  name: string,
  size: { w: number; h: number },
  tint: Color3,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): StandardMaterial {
  const tex = new DynamicTexture(`${name}Tex`, { width: size.w, height: size.h }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size.w, size.h);
  paint(ctx, size.w, size.h);
  tex.update(false);
  tex.hasAlpha = true;
  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.disableLighting = true;
  mat.emissiveColor = tint;
  mat.backFaceCulling = false;
  return mat;
}

/** The gull/hawk "M": two shallow wing arcs. Shared by every flier. */
function paintWings(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  ctx.strokeStyle = `rgba(44,52,64,${alpha})`;
  ctx.lineWidth = Math.max(2, w * 0.047);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w * 0.125, h * 0.63);
  ctx.quadraticCurveTo(w * 0.31, h * 0.28, w * 0.5, h * 0.56);
  ctx.quadraticCurveTo(w * 0.69, h * 0.28, w * 0.875, h * 0.63);
  ctx.stroke();
}

/** Coastal gulls — the shipped Sable Bay / Port Johnson flock. */
function buildGulls(scene: Scene, anchor: Anchor, w2b: W2B): void {
  const mat = billboardMat(scene, 'bird', { w: 64, h: 32 }, new Color3(0.17, 0.2, 0.26), (ctx, w, h) =>
    paintWings(ctx, w, h, 0.8)
  );
  const birds: Array<{ mesh: Mesh; v: number; x0: number; baseY: number; ph: number; bob: number }> = [];
  const BIRDS = 4;
  for (let i = 0; i < BIRDS; i++) {
    const j = hash2(i * 9.7, i * 3.3);
    const b = MeshBuilder.CreatePlane(`bird${i}`, { width: 26, height: 13 }, scene);
    b.material = mat;
    b.billboardMode = Mesh.BILLBOARDMODE_ALL;
    b.applyFog = false;
    const pos = w2b(
      anchor.tee.x - 1300 + i * (2600 / BIRDS) + j * 260,
      anchor.tee.y - 1400 - (i % 3) * 240,
      600 + ((i * 53) % 3) * 90 + j * 70
    );
    b.position = pos;
    birds.push({ mesh: b, v: 7 + j * 5, x0: pos.x, baseY: pos.y, ph: j * Math.PI * 2, bob: 4 + j * 3 });
  }
  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    if (isFrozen()) return;
    const dt = scene.getEngine().getDeltaTime() / 1000;
    t += dt;
    for (const b of birds) {
      b.mesh.position.x += dt * b.v;
      // Loop the flock back so the sky is never left empty on a longer hover.
      if (b.mesh.position.x - b.x0 > 2600) b.mesh.position.x = b.x0 - 200;
      b.mesh.position.y = b.baseY + Math.sin(t * 0.8 + b.ph) * b.bob;
    }
  });
}

/** Forest life (Wildwood): butterflies low over the rough margins + two
 *  small songbirds crossing high. Butterflies wander around fixed anchors
 *  OFFSET off the tee→pin corridor so they never cross the aim line low. */
function buildForestLife(scene: Scene, anchor: Anchor, w2b: W2B): void {
  // Butterfly: two wing ellipses in a bloom color (Wildwood's azalea palette).
  const WING_COLORS: Array<[string, Color3]> = [
    ['rgba(255,244,250,0.95)', new Color3(1, 0.92, 0.97)],
    ['rgba(255,190,215,0.95)', new Color3(1, 0.72, 0.85)],
    ['rgba(255,214,140,0.95)', new Color3(1, 0.85, 0.55)]
  ];
  // The corridor's left normal, to push anchors off the play line.
  const dirX = anchor.pin.x - anchor.tee.x;
  const dirY = anchor.pin.y - anchor.tee.y;
  const len = Math.hypot(dirX, dirY) || 1;
  const nx = -dirY / len;
  const ny = dirX / len;
  const flutters: Array<{ mesh: Mesh; cx: number; cy: number; r: number; ph: number; rate: number; h: number }> = [];
  for (let i = 0; i < 3; i++) {
    const [fill, tint] = WING_COLORS[i];
    const mat = billboardMat(scene, `butterflySkin${i}`, { w: 32, h: 32 }, tint, (ctx, w, h) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(w * 0.36, h * 0.5, w * 0.17, h * 0.3, -0.35, 0, Math.PI * 2);
      ctx.ellipse(w * 0.64, h * 0.5, w * 0.17, h * 0.3, 0.35, 0, Math.PI * 2);
      ctx.fill();
    });
    const j = hash2(i * 5.3 + 1, i * 8.1);
    const m = MeshBuilder.CreatePlane(`butterfly${i}`, { width: 4.6, height: 4.6 }, scene);
    m.material = mat;
    m.billboardMode = Mesh.BILLBOARDMODE_ALL;
    m.applyFog = false;
    // Anchor beside the corridor: 55–75% of the way down the hole, pushed
    // 260–380px off the line (alternating sides), fluttering 6–14 units up.
    const along = 0.55 + i * 0.1;
    const side = i % 2 === 0 ? 1 : -1;
    const off = (260 + j * 120) * side;
    flutters.push({
      mesh: m,
      cx: anchor.tee.x + dirX * along + nx * off,
      cy: anchor.tee.y + dirY * along + ny * off,
      r: 40 + j * 50,
      ph: j * Math.PI * 2,
      rate: 0.5 + j * 0.35,
      h: 6 + j * 8
    });
  }
  // Songbirds: the shared wing silhouette, smaller and lighter, crossing high.
  const birdMat = billboardMat(scene, 'birdSong', { w: 64, h: 32 }, new Color3(0.24, 0.27, 0.33), (ctx, w, h) =>
    paintWings(ctx, w, h, 0.7)
  );
  const birds: Array<{ mesh: Mesh; v: number; x0: number; baseY: number; ph: number }> = [];
  for (let i = 0; i < 2; i++) {
    const j = hash2(i * 3.9 + 7, i * 6.2);
    const b = MeshBuilder.CreatePlane(`birdF${i}`, { width: 15, height: 7.5 }, scene);
    b.material = birdMat;
    b.billboardMode = Mesh.BILLBOARDMODE_ALL;
    b.applyFog = false;
    const pos = w2b(anchor.tee.x - 1100 + i * 1300 + j * 300, anchor.tee.y - 1100 - i * 350, 480 + j * 120);
    b.position = pos;
    birds.push({ mesh: b, v: 9 + j * 6, x0: pos.x, baseY: pos.y, ph: j * Math.PI * 2 });
  }
  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    if (isFrozen()) return;
    const dt = scene.getEngine().getDeltaTime() / 1000;
    t += dt;
    for (const f of flutters) {
      // A slow circular wander + a quick shallow flutter bob.
      const a = t * f.rate + f.ph;
      const p = f.mesh.position;
      const target = w2b(f.cx + Math.cos(a) * f.r, f.cy + Math.sin(a * 0.8) * f.r, 0);
      p.x = target.x;
      p.z = target.z;
      p.y = target.y + f.h + Math.sin(t * 6 + f.ph) * 0.9;
    }
    for (const b of birds) {
      b.mesh.position.x += dt * b.v;
      if (b.mesh.position.x - b.x0 > 2400) b.mesh.position.x = b.x0 - 200;
      b.mesh.position.y = b.baseY + Math.sin(t * 1.1 + b.ph) * 5;
    }
  });
}

/** Alpine life (Timberline): two hawks soaring slow circles very high, and
 *  three translucent mist wisps drifting along the treetops far from play. */
function buildAlpineLife(scene: Scene, anchor: Anchor, w2b: W2B): void {
  const hawkMat = billboardMat(scene, 'hawk', { w: 64, h: 32 }, new Color3(0.2, 0.16, 0.12), (ctx, w, h) =>
    paintWings(ctx, w, h, 0.85)
  );
  const hawks: Array<{ mesh: Mesh; cx: number; cy: number; r: number; ph: number; rate: number; alt: number }> = [];
  for (let i = 0; i < 2; i++) {
    const j = hash2(i * 11.3 + 3, i * 2.7);
    const m = MeshBuilder.CreatePlane(`hawk${i}`, { width: 22, height: 11 }, scene);
    m.material = hawkMat;
    m.billboardMode = Mesh.BILLBOARDMODE_ALL;
    m.applyFog = false;
    hawks.push({
      mesh: m,
      cx: (anchor.tee.x + anchor.pin.x) / 2 + (j - 0.5) * 900,
      cy: (anchor.tee.y + anchor.pin.y) / 2 - 900 - i * 500,
      r: 260 + j * 160,
      ph: j * Math.PI * 2,
      rate: 0.1 + j * 0.05,
      alt: 640 + i * 110 + j * 60
    });
  }
  // Mist wisps: soft radial blobs, barely-there alpha, gliding along the
  // backdrop treetops. They take fog so they melt into the haze.
  const mistMat = billboardMat(scene, 'mist', { w: 128, h: 64 }, new Color3(0.92, 0.95, 0.98), (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  mistMat.alpha = 0.5;
  const wisps: Array<{ mesh: Mesh; v: number; x0: number; ph: number; baseY: number }> = [];
  for (let i = 0; i < 3; i++) {
    const j = hash2(i * 6.1 + 9, i * 4.4);
    const m = MeshBuilder.CreatePlane(`mist${i}`, { width: 240 + j * 120, height: 60 + j * 30 }, scene);
    m.material = mistMat;
    m.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const pos = w2b(anchor.tee.x - 1500 + i * 1000 + j * 380, anchor.tee.y - 1500 - (i % 2) * 420, 150 + j * 80);
    m.position = pos;
    wisps.push({ mesh: m, v: 3 + j * 2.5, x0: pos.x, ph: j * Math.PI * 2, baseY: pos.y });
  }
  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    if (isFrozen()) return;
    const dt = scene.getEngine().getDeltaTime() / 1000;
    t += dt;
    for (const hk of hawks) {
      const a = t * hk.rate * Math.PI * 2 + hk.ph;
      const p = hk.mesh.position;
      const target = w2b(hk.cx + Math.cos(a) * hk.r, hk.cy + Math.sin(a) * hk.r, 0);
      p.x = target.x;
      p.z = target.z;
      p.y = target.y + hk.alt + Math.sin(t * 0.5 + hk.ph) * 8;
    }
    for (const w of wisps) {
      w.mesh.position.x += dt * w.v;
      if (w.mesh.position.x - w.x0 > 3000) w.mesh.position.x = w.x0 - 300;
      w.mesh.position.y = w.baseY + Math.sin(t * 0.3 + w.ph) * 3;
    }
  });
}

/**
 * Build the ambient life for a hole. The caller resolves `kind` from the
 * course theme and gates on the `atmosphere` feature flag; 'none' is a no-op.
 */
export function buildAtmosphere(scene: Scene, kind: AtmosphereKind, anchor: Anchor, w2b: W2B): void {
  if (kind === 'coastal') buildGulls(scene, anchor, w2b);
  else if (kind === 'forest') buildForestLife(scene, anchor, w2b);
  else if (kind === 'alpine') buildAlpineLife(scene, anchor, w2b);
}
