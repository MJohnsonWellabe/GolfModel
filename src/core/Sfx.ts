import Phaser from 'phaser';

/**
 * Best-effort sound playback. The shipped SFX are silent placeholders,
 * so every call is wrapped: a missing or undecodable file never breaks play.
 */
export function safePlay(scene: Phaser.Scene, key: string): void {
  try {
    if (scene.cache.audio.exists(key)) {
      scene.sound.play(key, { volume: 0.8 });
    }
  } catch {
    // Placeholder audio — ignore.
  }
}

export function preloadSfx(scene: Phaser.Scene): void {
  scene.load.on('loaderror', () => {
    // Silent placeholder assets may fail to decode on some browsers; that's fine.
  });
  scene.load.audio('swing', 'sfx/swing.wav');
  scene.load.audio('hit', 'sfx/hit.wav');
  scene.load.audio('hole', 'sfx/hole.wav');
  scene.load.audio('splash', 'sfx/splash.wav');
  scene.load.audio('fire', 'sfx/fire.wav');
}
