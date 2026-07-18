/**
 * WebAudio engine (V2 Phase 5 — docs/23_V2_AUDIO_IDENTITY.md).
 *
 * One lazy AudioContext with a master gain per category. Everything here is
 * failure-tolerant by contract: any unavailability (no WebAudio, autoplay
 * restriction, decode error) returns null/false so callers fall back to the
 * proven HTMLAudio path. The context is only ever created from call sites
 * that run inside user-gesture handlers (the same guarantee the existing
 * startAmbience() relies on), so autoplay policy is never violated.
 *
 * Constitution rule 14: both categories hang off the profile's existing
 * sound/ambience preferences — this module adds NO new preference store.
 */

let ctx: AudioContext | null = null;
let failed = false;
let sfxMaster: GainNode | null = null;
let ambienceMaster: GainNode | null = null;

/** The shared context, or null where WebAudio is unavailable. */
export function audioContext(): AudioContext | null {
  if (failed) return null;
  if (!ctx) {
    try {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        failed = true;
        return null;
      }
      ctx = new Ctor();
      sfxMaster = ctx.createGain();
      sfxMaster.connect(ctx.destination);
      ambienceMaster = ctx.createGain();
      ambienceMaster.connect(ctx.destination);
    } catch {
      failed = true;
      return null;
    }
  }
  // A context created outside a gesture starts suspended; gesture-driven
  // callers nudge it live. resume() is idempotent and cheap when running.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

/** SFX master bus (final per-play volume is still computed at the call site,
 *  preserving the "muted player does zero work" guard). */
export function sfxBus(): GainNode | null {
  return audioContext() ? sfxMaster : null;
}

/** Ambience master bus — its gain IS the ambience slider. */
export function ambienceBus(): GainNode | null {
  return audioContext() ? ambienceMaster : null;
}

/** Push the ambience preference (0..1) onto the master gain. */
export function setAmbienceMasterVolume(v: number): void {
  if (ambienceMaster) ambienceMaster.gain.value = Math.max(0, Math.min(1, v));
}
