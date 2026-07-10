import {
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Scene,
  SolidParticleSystem,
  StandardMaterial
} from '@babylonjs/core';
import { isFrozen } from '../core/debugFlags';
import { EllipseArea, HoleData } from '../core/types';
import { PhysicsEngine } from '../systems/PhysicsEngine';
import { pointInEllipse } from '../utils/Geometry';
import { hash2 } from './natureModels';

/**
 * Break-dot flow field — the putting read aid. A cloud of soft dots on the
 * green, each drifting along the LOCAL break direction at a speed
 * proportional to the break magnitude, driven by the very same
 * PhysicsEngine.breakAccel the roll integrator uses. So what the dots show is
 * exactly what the ball will do: downhill-away = dots recede, uphill = dots
 * approach, break-right = dots drift right, and a dead-flat green sits still.
 *
 * Replaces the old single-direction scrolling texture, which sampled the
 * slope once at the green centre and drifted the whole overlay uniformly.
 *
 * Dots live in WORLD space (never parented to the g.rot-rotated puttGrid), so
 * breakAccel's world vector maps straight through the w2b convention
 * (world y → Babylon −z) with no axis mismatch. Visibility follows
 * puttGrid.isEnabled() inside the per-frame observer, so the existing
 * setEnabled call sites keep working untouched.
 */

/** Dot drift speed (world px/s) for a break-accel magnitude (px/s²). */
export function dotSpeed(mag: number): number {
  return 2 + 7 * Math.min(1, mag / 60);
}

/** Uniform random point inside the (possibly rotated) green ellipse. */
export function sampleGreenPoint(g: EllipseArea, u: number, v: number): { x: number; y: number } {
  const rho = Math.sqrt(u) * 0.97; // stay just inside the edge
  const th = v * Math.PI * 2;
  const lx = rho * g.rx * Math.cos(th);
  const ly = rho * g.ry * Math.sin(th);
  const c = Math.cos(g.rot ?? 0);
  const s = Math.sin(g.rot ?? 0);
  return { x: g.cx + c * lx - s * ly, y: g.cy + s * lx + c * ly };
}

/** Break magnitudes below this (px/s²) read as dead flat — dots hold still. */
const EPS = 1;
/** Seconds a dot lives before respawning (keeps density uniform). */
const LIFE = 6;

export function buildBreakDots(
  scene: Scene,
  hole: HoleData,
  engine: PhysicsEngine,
  puttGrid: Mesh,
  groundH: (x: number, y: number) => number
): void {
  const g = hole.green;
  const count = Math.max(150, Math.min(350, Math.round((Math.PI * g.rx * g.ry) / 40)));

  // Soft round sprite shared by every dot.
  const tex = new DynamicTexture('breakDotTex', { width: 32, height: 32 }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 32, 32);
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  tex.update(false);
  tex.hasAlpha = true;
  const mat = new StandardMaterial('breakDotMat', scene);
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.disableLighting = true;
  mat.backFaceCulling = false;

  const sps = new SolidParticleSystem('breakDots', scene, { updatable: true });
  // Small enough that a dot never reads as the ball (ball ⌀ ≈ 1 world unit).
  const proto = MeshBuilder.CreatePlane('breakDotProto', { size: 0.6 }, scene);
  sps.addShape(proto, count);
  proto.dispose();
  const mesh = sps.buildMesh();
  mesh.material = mat;
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  // The SPS bounding box is computed at build time with every particle at the
  // origin; once the dots move to the green's world coords the stale bounds
  // would frustum-cull the whole cloud. It's a few hundred quads — always draw.
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.setEnabled(false);
  sps.billboard = true;
  sps.computeParticleRotation = false;

  // World-space dot state. Deterministic seeding so freeze-frame captures are
  // reproducible; staggered phases so the frozen frame shows mixed alphas.
  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const p = sampleGreenPoint(g, hash2(i * 12.9, i * 3.7), hash2(i * 7.1, i * 5.3));
    px[i] = p.x;
    py[i] = p.y;
    phase[i] = hash2(i, 7) * LIFE;
  }
  let respawnSeq = 1;
  let primed = false;

  scene.onBeforeRenderObservable.add(() => {
    const on = puttGrid.isEnabled();
    if (mesh.isEnabled() !== on) mesh.setEnabled(on);
    if (!on) return;
    if (isFrozen() && primed) return;
    const dt = isFrozen() ? 0 : scene.getEngine().getDeltaTime() / 1000;
    for (let i = 0; i < count; i++) {
      const a = engine.breakAccel(px[i], py[i]);
      const m = Math.hypot(a.ax, a.ay);
      if (m > EPS) {
        const v = (dotSpeed(m) * dt) / m;
        px[i] += a.ax * v;
        py[i] += a.ay * v;
      }
      phase[i] += dt;
      if (phase[i] >= LIFE || !pointInEllipse(px[i], py[i], g, -2)) {
        const p = sampleGreenPoint(g, hash2(respawnSeq, i), hash2(i, respawnSeq));
        respawnSeq++;
        px[i] = p.x;
        py[i] = p.y;
        phase[i] = 0;
      }
      const dot = sps.particles[i];
      dot.position.set(px[i], groundH(px[i], py[i]) + 0.18, -py[i]);
      // 20% fade in/out over the dot's life so respawns never pop.
      const t = phase[i] / LIFE;
      const alpha = 0.6 * Math.min(1, 5 * Math.min(t, 1 - t));
      (dot.color ?? (dot.color = new Color4(1, 1, 1, 1))).a = alpha;
    }
    sps.setParticles();
    primed = isFrozen();
  });
}
