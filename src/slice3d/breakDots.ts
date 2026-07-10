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
import { HoleData } from '../core/types';
import { PhysicsEngine } from '../systems/PhysicsEngine';
import { hash2 } from './natureModels';

/**
 * Break dots — the putting read aid. The dots live ON the putt-grid lines
 * and slide ALONG them: each dot rides one grid line and its velocity is the
 * component of the local break (PhysicsEngine.breakAccel — the same field
 * the roll integrator uses) along that line's axis. Break-right slides the
 * x-line dots right; an uphill putt slides the y-line dots toward the
 * golfer; the harder the break, the faster the slide; a dead-flat green
 * sits still. Dots on lines aligned with the break also glow brighter.
 *
 * The grid frame is the green's frame: rotated by g.rot about the green
 * centre, lines every CELL(=4) world units spanning (2rx+12)x(2ry+12) —
 * mirroring the puttGrid texture in course3d.ts. Dots are positioned in
 * WORLD space each frame (world y -> Babylon -z), so they sit exactly on
 * the drawn lines without being parented to the rotated grid mesh.
 */

/** Grid cell size in world units — must match the puttGrid texture step. */
export const CELL = 4;

/** Dot slide speed (world px/s) for a break-accel magnitude (px/s²). */
export function dotSpeed(mag: number): number {
  return 2 + 7 * Math.min(1, mag / 60);
}

/** Snap a 0..1 hash to a grid-line coordinate `-half + CELL·k`, k ≥ 1, inside ±half. */
export function lineLattice(half: number, u: number): number {
  const lines = Math.max(1, Math.floor((half * 2) / CELL) - 1);
  const k = 1 + Math.min(lines - 1, Math.floor(u * lines));
  return -half + k * CELL;
}

/** Rotate a world-space break vector into the grid's local frame. */
export function localBreak(rot: number, ax: number, ay: number): { x: number; y: number } {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: c * ax + s * ay, y: -s * ax + c * ay };
}

/** Break magnitudes below this (px/s²) read as dead flat — dots hold still. */
const EPS = 1;
/** Seconds a dot lives before respawning (keeps line coverage uniform). */
const LIFE = 6;

export function buildBreakDots(
  scene: Scene,
  hole: HoleData,
  engine: PhysicsEngine,
  puttGrid: Mesh,
  groundH: (x: number, y: number) => number
): void {
  const g = hole.green;
  const rot = g.rot ?? 0;
  const rotC = Math.cos(rot);
  const rotS = Math.sin(rot);
  const halfW = g.rx + 6; // grid spans 2rx+12 x 2ry+12, like the texture
  const halfH = g.ry + 6;
  const count = Math.max(150, Math.min(350, Math.round((Math.PI * g.rx * g.ry) / 40)));

  // Ellipse chord half-length along the FREE axis at a fixed line coordinate,
  // pulled slightly inside the fringe edge. Grid frame == green frame, so the
  // ellipse is axis-aligned here.
  const chord = (fixed: number, fixedR: number, freeR: number): number => {
    const t = fixed / fixedR;
    return t * t >= 1 ? 0 : (freeR - 2) * Math.sqrt(1 - t * t);
  };

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

  // Per-dot state in GRID-LOCAL coords. Even indices ride x-parallel lines
  // (fixed local y, slide along x); odd indices ride y-parallel lines.
  const fixed = new Float32Array(count); // the line coordinate (on the lattice)
  const free = new Float32Array(count); // position along the line
  const phase = new Float32Array(count);
  const spawn = (i: number, seq: number): void => {
    const onX = i % 2 === 0;
    const lineCoord = lineLattice(onX ? halfH : halfW, hash2(seq * 12.9 + i, i * 3.7));
    const c = chord(lineCoord, onX ? g.ry : g.rx, onX ? g.rx : g.ry);
    fixed[i] = lineCoord;
    free[i] = (hash2(i * 7.1, seq * 5.3 + i) * 2 - 1) * c;
  };
  for (let i = 0; i < count; i++) {
    spawn(i, 0);
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
      const onX = i % 2 === 0;
      const lx = onX ? free[i] : fixed[i];
      const ly = onX ? fixed[i] : free[i];
      const wx = g.cx + rotC * lx - rotS * ly;
      const wy = g.cy + rotS * lx + rotC * ly;
      const a = engine.breakAccel(wx, wy);
      const m = Math.hypot(a.ax, a.ay);
      let align = 0;
      if (m > EPS) {
        const lb = localBreak(rot, a.ax, a.ay);
        const comp = onX ? lb.x : lb.y;
        align = Math.abs(comp) / m;
        // Slide along the line at the break's projection onto this axis —
        // full dotSpeed when the line is aligned with the break, still when
        // the break runs perpendicular to it.
        free[i] += (comp / m) * dotSpeed(m) * dt;
      }
      phase[i] += dt;
      const bound = chord(fixed[i], onX ? g.ry : g.rx, onX ? g.rx : g.ry);
      if (phase[i] >= LIFE || bound === 0 || Math.abs(free[i]) > bound) {
        spawn(i, respawnSeq++);
        phase[i] = 0;
      }
      const plx = onX ? free[i] : fixed[i];
      const ply = onX ? fixed[i] : free[i];
      const pwx = g.cx + rotC * plx - rotS * ply;
      const pwy = g.cy + rotS * plx + rotC * ply;
      const dot = sps.particles[i];
      dot.position.set(pwx, groundH(pwx, pwy) + 0.18, -pwy);
      // 20% fade in/out over the dot's life so respawns never pop; lines
      // aligned with the break glow, perpendicular ones stay faint.
      const t = phase[i] / LIFE;
      const alpha = (0.25 + 0.55 * align) * Math.min(1, 5 * Math.min(t, 1 - t));
      (dot.color ?? (dot.color = new Color4(1, 1, 1, 1))).a = alpha;
    }
    sps.setParticles();
    primed = isFrozen();
  });
}
