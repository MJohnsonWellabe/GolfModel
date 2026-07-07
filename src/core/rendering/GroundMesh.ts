import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config';
import { TEXTURE_PAD } from './CourseTexture';
import { Projection } from './Projection';

/** Camera-space depth of the nearest ground row (just past the near plane). */
const NEAR_D = 7;
/** Depth of the farthest ground row (beyond this the haze owns the pixels). */
const FAR_D = 3200;
/** Grid resolution: depth rows × lateral columns. */
const ROWS = 34;
const COLS = 22;

/**
 * The textured ground: a Phaser Mesh in orthographic mode whose vertices are
 * placed in *screen space* by the game's own `Projection` — the same math
 * that positions balls, trees and the flag, so everything stays aligned.
 *
 * The grid is frustum-shaped: rows sit at harmonically spaced camera depths
 * (≈ uniform screen rows, dense near the camera), columns fan out with
 * distance. UVs sample the baked course texture by world position.
 */
export class GroundMesh {
  readonly mesh: Phaser.GameObjects.Mesh;
  private positions: number[];
  private uvs: number[];
  private worldW: number;
  private worldH: number;

  constructor(scene: Phaser.Scene, textureKey: string, worldW: number, worldH: number) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.mesh = scene.add.mesh(GAME_WIDTH / 2, GAME_HEIGHT / 2, textureKey);
    this.mesh.setOrtho(GAME_WIDTH, GAME_HEIGHT);
    const quadCount = ROWS * COLS;
    this.positions = new Array(quadCount * 12).fill(0);
    this.uvs = new Array(quadCount * 12).fill(0);
  }

  /** Reproject every grid vertex through the current camera and rebuild. */
  update(proj: Projection): void {
    const cam = proj.cam;
    const fx = Math.cos(cam.yaw);
    const fy = Math.sin(cam.yaw);
    // Right vector matching Projection.toView's convention
    const rx = -fy;
    const ry = fx;
    const halfW = GAME_WIDTH / 2 + 90;

    // Grid corner buffers: (ROWS+1) x (COLS+1)
    const nx: number[] = [];
    const ny: number[] = [];
    const nu: number[] = [];
    const nv: number[] = [];
    for (let r = 0; r <= ROWS; r++) {
      // Harmonic depth spacing = roughly uniform screen rows
      const t = r / ROWS;
      const d = 1 / ((1 - t) / NEAR_D + t / FAR_D);
      const sHalf = (halfW * d) / cam.focal;
      const scale = cam.focal / d;
      const sy = cam.horizonY + cam.height * scale;
      for (let c = 0; c <= COLS; c++) {
        const s = ((c / COLS) * 2 - 1) * sHalf;
        const wx = cam.x + fx * d + rx * s;
        const wy = cam.y + fy * d + ry * s;
        const sx = cam.centerX + s * scale;
        const i = r * (COLS + 1) + c;
        // Model space: origin at screen center, y up
        nx[i] = sx - GAME_WIDTH / 2;
        ny[i] = GAME_HEIGHT / 2 - sy;
        nu[i] = (wx + TEXTURE_PAD) / (this.worldW + TEXTURE_PAD * 2);
        nv[i] = (wy + TEXTURE_PAD) / (this.worldH + TEXTURE_PAD * 2);
      }
    }

    // Two triangles per quad
    const P = this.positions;
    const U = this.uvs;
    let o = 0;
    const clampUV = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r * (COLS + 1) + c;
        const b = a + 1;
        const d2 = a + (COLS + 1);
        const e = d2 + 1;
        for (const idx of [a, d2, b, b, d2, e]) {
          P[o * 2] = nx[idx];
          P[o * 2 + 1] = ny[idx];
          U[o * 2] = clampUV(nu[idx]);
          U[o * 2 + 1] = clampUV(nv[idx]);
          o++;
        }
      }
    }

    this.mesh.clear();
    this.mesh.addVertices(this.positions, this.uvs);
  }

  setVisible(v: boolean): void {
    this.mesh.setVisible(v);
  }

  destroy(): void {
    this.mesh.destroy();
  }
}
