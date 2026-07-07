import Phaser from 'phaser';

/** Per-sound playback volume — conservative, per the art direction. */
const VOLUME: Record<string, number> = {
  swing: 0.5,
  'impact-driver': 0.9,
  'impact-iron': 0.8,
  'impact-wedge': 0.7,
  putt: 0.7,
  hit: 0.8,
  hole: 0.9,
  splash: 0.8,
  fire: 0.7,
  chime: 0.75,
  ui: 0.4,
  ambience: 0.22
};

const KEYS = Object.keys(VOLUME);

/**
 * Best-effort sound playback — a missing or undecodable file never breaks
 * play (e.g. very old browsers without WAV decode).
 */
export function safePlay(scene: Phaser.Scene, key: string): void {
  try {
    if (scene.cache.audio.exists(key)) {
      scene.sound.play(key, { volume: VOLUME[key] ?? 0.8 });
    }
  } catch {
    // Audio is polish, never a blocker.
  }
}

/** The impact sound for a club: crack for woods, strike for irons, etc. */
export function impactKey(clubId: string): string {
  if (clubId === 'putter') return 'putt';
  if (clubId === 'driver' || clubId === '3w' || clubId === '5w') return 'impact-driver';
  if (clubId === 'pw' || clubId === 'sw') return 'impact-wedge';
  return 'impact-iron';
}

/** Start the looping course ambience (birds + breeze) once per game. */
export function startAmbience(scene: Phaser.Scene): void {
  try {
    if (!scene.cache.audio.exists('ambience')) return;
    const existing = scene.sound.get('ambience');
    if (existing?.isPlaying) return;
    scene.sound.play('ambience', { volume: VOLUME.ambience, loop: true });
  } catch {
    // Ambience is optional.
  }
}

export function preloadSfx(scene: Phaser.Scene): void {
  scene.load.on('loaderror', () => {
    // A failed decode on some browser just means silence for that cue.
  });
  for (const key of KEYS) {
    scene.load.audio(key, `sfx/${key}.wav`);
  }
}
