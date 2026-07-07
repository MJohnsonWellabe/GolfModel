import Phaser from 'phaser';

const FADE_MS = 180;

/** Fade the camera out, then start the target scene (no hard cuts). */
export function fadeToScene(scene: Phaser.Scene, key: string): void {
  const cam = scene.cameras.main;
  if (!cam) {
    scene.scene.start(key);
    return;
  }
  cam.fadeOut(FADE_MS, 0, 0, 0);
  cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
    scene.scene.start(key);
  });
}

/** Call from create(): fades the scene in from black. */
export function fadeIn(scene: Phaser.Scene): void {
  scene.cameras.main?.fadeIn(220, 0, 0, 0);
}
