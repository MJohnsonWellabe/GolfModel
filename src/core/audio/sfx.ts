/**
 * WebAudio SFX playback with per-key buffer caching (V2 Phase 5).
 *
 * fetch + decodeAudioData once per key, then cheap BufferSource plays with
 * optional rate variation and a lowpass shaping filter. `playBuffer` returns
 * `false` whenever it cannot play RIGHT NOW — WebAudio unavailable, or the
 * buffer still decoding (it primes the decode and lets the caller's
 * HTMLAudio fallback carry that one play). This module must never be the
 * reason a sound is missing.
 */

import { audioContext, sfxBus } from './engine';

/** Decoded, ready-to-play buffers. */
const ready = new Map<string, AudioBuffer>();
/** In-flight decodes (also the retry gate: failures clear the entry). */
const pending = new Map<string, Promise<void>>();

function prime(key: string): void {
  const ctx = audioContext();
  if (!ctx || ready.has(key) || pending.has(key)) return;
  const p = fetch(`sfx/${key}.wav`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((ab) => ctx.decodeAudioData(ab))
    .then((buf) => {
      ready.set(key, buf);
      pending.delete(key);
    })
    .catch(() => {
      pending.delete(key); // transient failure → a later play retries
    });
  pending.set(key, p);
}

export interface PlayOpts {
  /** Playback rate (1 = natural). */
  rate?: number;
  /** Optional lowpass cutoff for surface shaping. */
  lowpassHz?: number;
}

/**
 * Play `key` at `volume` (final, caller-computed). Returns true only when a
 * source actually started; false lets the caller fall back to HTMLAudio
 * (which also covers the first, still-decoding play of each key).
 */
export function playBuffer(key: string, volume: number, opts: PlayOpts = {}): boolean {
  const ctx = audioContext();
  const bus = sfxBus();
  if (!ctx || !bus || volume <= 0) return false;
  const buf = ready.get(key);
  if (!buf) {
    prime(key);
    return false;
  }
  try {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (opts.rate && opts.rate !== 1) src.playbackRate.value = opts.rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    if (opts.lowpassHz) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.lowpassHz;
      src.connect(lp);
      lp.connect(gain);
    } else {
      src.connect(gain);
    }
    gain.connect(bus);
    // One-shot sources end themselves; disconnect the tail so the graph
    // never accumulates nodes across a long session.
    src.onended = () => {
      try {
        gain.disconnect();
      } catch {
        /* already gone */
      }
    };
    src.start();
    return true;
  } catch {
    return false;
  }
}
