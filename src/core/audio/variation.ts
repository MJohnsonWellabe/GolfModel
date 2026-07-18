/**
 * Controlled SFX variation (V2 Phase 5) — pure math, no audio imports.
 *
 * Each varied key gets a small playback-rate and gain jitter so repeated
 * impacts stop sounding byte-identical without ever reading as a different
 * sound. Keys absent from the table play EXACTLY as before (rate 1, gain 1)
 * — celebration/status sounds (hole, chime, fire) stay canonical.
 */

export interface VariationSpec {
  /** Max playback-rate deviation, e.g. 0.07 → rate in [0.93, 1.07]. */
  rate: number;
  /** Max gain multiplier deviation, e.g. 0.12 → gain in [0.88, 1.12]. */
  gain: number;
}

export const SFX_VARIATION: Record<string, VariationSpec> = {
  'impact-driver': { rate: 0.07, gain: 0.12 },
  'impact-iron': { rate: 0.07, gain: 0.1 },
  'impact-wedge': { rate: 0.07, gain: 0.1 },
  putt: { rate: 0.05, gain: 0.1 },
  swing: { rate: 0.04, gain: 0.08 },
  hit: { rate: 0.08, gain: 0.12 }
};

export interface VariedParams {
  rate: number;
  gainMult: number;
}

/** Draw the varied playback params for a key. `rnd` is injectable for tests. */
export function variedParams(key: string, rnd: () => number = Math.random): VariedParams {
  const spec = SFX_VARIATION[key];
  if (!spec) return { rate: 1, gainMult: 1 };
  return {
    rate: 1 + (rnd() * 2 - 1) * spec.rate,
    gainMult: 1 + (rnd() * 2 - 1) * spec.gain
  };
}

/** Surface-shaped landing thump parameters (played on the shared 'hit'
 *  sample): brighter/quieter on short grass, darker/deeper in sand. */
export const LANDING_THUMP: Record<string, { volume: number; rate: number; lowpassHz?: number }> = {
  green: { volume: 0.16, rate: 1.15 },
  fringe: { volume: 0.18, rate: 1.1 },
  fairway: { volume: 0.24, rate: 1.0 },
  rough: { volume: 0.3, rate: 0.85, lowpassHz: 1400 },
  sand: { volume: 0.34, rate: 0.7, lowpassHz: 750 }
};
