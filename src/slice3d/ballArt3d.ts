/**
 * The Babylon half of ball art: wrap `core/rendering/ballArt`'s canvas painting
 * in a `DynamicTexture`. Same split as the course art (`CourseTexture` paints,
 * `course3d` uploads) so the pattern maths never depends on an engine.
 *
 * Ownership: the texture is created against the scene, so `scene.dispose()`
 * (HoleScene.dispose) frees it with the rest of the hole. The caller also hooks
 * the ball material's dispose, so a material replaced mid-scene takes its
 * texture with it rather than leaving one behind (CLAUDE.md rule 13).
 */

import { DynamicTexture, Scene, Texture } from '../core/rendering/babylon';
import { BALL_ART_H, BALL_ART_W, BallArt, paintBallArt } from '../core/rendering/ballArt';

export function makeBallArtTexture(scene: Scene, name: string, art: BallArt): DynamicTexture {
  const tex = new DynamicTexture(name, { width: BALL_ART_W, height: BALL_ART_H }, scene, true);
  paintBallArt(tex.getContext() as CanvasRenderingContext2D, BALL_ART_W, BALL_ART_H, art);
  tex.update(false);
  // u wraps a full turn (the pattern must meet itself at the seam); v runs
  // pole to pole and must not.
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}
