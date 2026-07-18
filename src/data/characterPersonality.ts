/**
 * Character personality parameters (V2 Phase 3) — the data half of
 * `docs/content/CHARACTER_PERSONALITY_BIBLE.md`. That document is the
 * authority on who each character IS; this module is the authority on the
 * numbers that express it.
 *
 * Personality is cosmetic only (constitution rules 8/13): every parameter is
 * a playback rate or amplitude multiplier on animation that already exists.
 * Nothing here may influence swing, meter, physics, or navigation timing —
 * `clampPersonality` enforces the documented safe ranges so no data edit can
 * create a broken pose or a reaction that outlasts the post-hole window.
 */

import { CharacterKey } from './characters';

export type PersonalityArchetype = 'showman' | 'cool' | 'rookie' | 'steady' | 'fiery' | 'sunny';

export interface PersonalityParams {
  /** Idle clip playback rate (procedural bodies map it onto sway rate). */
  idleSpeed: number;
  /** Pre-shot club waggle amplitude multiplier while aiming. */
  waggleAmp: number;
  /** Pre-shot club waggle frequency multiplier while aiming. */
  waggleRate: number;
  /** Clip for an ordinary celebrate-worthy score. */
  celebrateClip: 'win' | 'song';
  /** Clip for the epic (eagle+/special hole-out) moment. The Cool Customer
   *  keeps 'win' even here — underreacting to an ace IS the personality. */
  epicClip: 'win' | 'song';
  /** Celebrate hop height multiplier. */
  hopAmp: number;
  /** Celebrate hop frequency multiplier (the Rookie's rapid triple hop). */
  hopRate: number;
  /** Dejection slump depth multiplier. */
  dejectDepth: number;
  /** Seconds a reaction holds before returning to idle. */
  reactionHold: number;
}

/** Documented safe ranges (bible: "Parameter glossary"). reactionHold's cap
 *  keeps every reaction comfortably inside the 2.4 s post-hole delay. */
export const PERSONALITY_LIMITS = {
  idleSpeed: [0.85, 1.25],
  waggleAmp: [0.6, 1.5],
  waggleRate: [0.7, 1.4],
  hopAmp: [0.4, 1.4],
  hopRate: [0.8, 1.6],
  dejectDepth: [0.35, 1.3],
  reactionHold: [1.2, 2.0]
} as const;

/** Neutral parameters — EXACTLY today's shared behavior. The personality
 *  layer off (flag, or no character) must be indistinguishable from V1. */
export const NEUTRAL_PERSONALITY: PersonalityParams = Object.freeze({
  idleSpeed: 1.0,
  waggleAmp: 1.0,
  waggleRate: 1.0,
  celebrateClip: 'win',
  epicClip: 'song',
  hopAmp: 1.0,
  hopRate: 1.0,
  dejectDepth: 1.0,
  reactionHold: 1.6
});

/** One parameter set per archetype (bible: "The archetype system"). */
export const PERSONALITY_ARCHETYPES: Record<PersonalityArchetype, PersonalityParams> = {
  showman: {
    idleSpeed: 1.15,
    waggleAmp: 1.35,
    waggleRate: 0.85,
    celebrateClip: 'song',
    epicClip: 'song',
    hopAmp: 1.3,
    hopRate: 1.0,
    dejectDepth: 1.3,
    reactionHold: 2.0
  },
  cool: {
    idleSpeed: 0.85,
    waggleAmp: 0.6,
    waggleRate: 0.8,
    celebrateClip: 'win',
    epicClip: 'win',
    hopAmp: 0.45,
    hopRate: 0.8,
    dejectDepth: 0.4,
    reactionHold: 1.2
  },
  rookie: {
    idleSpeed: 1.25,
    waggleAmp: 1.2,
    waggleRate: 1.4,
    celebrateClip: 'win',
    epicClip: 'song',
    hopAmp: 1.1,
    hopRate: 1.6,
    dejectDepth: 0.7,
    reactionHold: 1.4
  },
  steady: { ...NEUTRAL_PERSONALITY },
  fiery: {
    idleSpeed: 1.1,
    waggleAmp: 0.9,
    waggleRate: 1.3,
    celebrateClip: 'win',
    epicClip: 'song',
    hopAmp: 1.25,
    hopRate: 1.3,
    dejectDepth: 1.25,
    reactionHold: 1.8
  },
  sunny: {
    idleSpeed: 0.95,
    waggleAmp: 1.1,
    waggleRate: 0.9,
    celebrateClip: 'win',
    epicClip: 'song',
    hopAmp: 0.9,
    hopRate: 0.9,
    dejectDepth: 0.35,
    reactionHold: 1.5
  }
};

/** Every roster character's archetype (bible: "The roster"). */
export const CHARACTER_PERSONALITY: Record<CharacterKey, PersonalityArchetype> = {
  chip: 'rookie',
  rose: 'steady',
  rio: 'fiery',
  sunny: 'sunny',
  theo: 'steady',
  dez: 'showman',
  beat: 'showman',
  kuro: 'cool',
  lily: 'sunny',
  jade: 'cool',
  nova: 'fiery',
  milo: 'rookie',
  finn: 'sunny',
  cole: 'steady',
  reid: 'cool',
  enzo: 'showman',
  dash: 'rookie',
  knox: 'fiery',
  bree: 'sunny',
  coco: 'rookie',
  wren: 'cool',
  ivy: 'steady',
  pia: 'rookie',
  zuri: 'fiery',
  remi: 'sunny'
};

const clamp = (v: number, [lo, hi]: readonly [number, number]): number =>
  Math.min(hi, Math.max(lo, v));

/** Clamp a parameter set into the documented safe ranges. */
export function clampPersonality(p: PersonalityParams): PersonalityParams {
  return {
    idleSpeed: clamp(p.idleSpeed, PERSONALITY_LIMITS.idleSpeed),
    waggleAmp: clamp(p.waggleAmp, PERSONALITY_LIMITS.waggleAmp),
    waggleRate: clamp(p.waggleRate, PERSONALITY_LIMITS.waggleRate),
    celebrateClip: p.celebrateClip === 'song' ? 'song' : 'win',
    epicClip: p.epicClip === 'win' ? 'win' : 'song',
    hopAmp: clamp(p.hopAmp, PERSONALITY_LIMITS.hopAmp),
    hopRate: clamp(p.hopRate, PERSONALITY_LIMITS.hopRate),
    dejectDepth: clamp(p.dejectDepth, PERSONALITY_LIMITS.dejectDepth),
    reactionHold: clamp(p.reactionHold, PERSONALITY_LIMITS.reactionHold)
  };
}

/**
 * The personality for a character key. Unknown/undefined keys (procedural
 * fallback golfers, future characters not yet mapped) get the neutral set —
 * a golfer must never be MORE animated just because it is unmapped.
 */
export function personalityFor(key: string | undefined): PersonalityParams {
  const arche = key ? CHARACTER_PERSONALITY[key as CharacterKey] : undefined;
  return clampPersonality(arche ? PERSONALITY_ARCHETYPES[arche] : NEUTRAL_PERSONALITY);
}
