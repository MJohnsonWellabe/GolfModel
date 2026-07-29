/**
 * PLAYER DIFFICULTY — one knob, and it only ever moves the swing zones.
 *
 * Owner rule: "what we have current settings as should be Pro". So Pro is
 * defined as 1.0 — the game exactly as it shipped, with no compensating tweak
 * anywhere else — and the other three are pure multipliers on the perfect AND
 * good bands of the swing meter. Nothing else moves: not carry, not dispersion,
 * not wind, not the pin, not the AI field. A difficulty must never become a
 * different GAME, only a different-sized target, for the same reason a render
 * quality tier must never become a difficulty (see core/rendering/quality.ts).
 *
 * The multipliers:
 *
 *   Beginner  1.4x  — the same width the Fire streak grants (SWING.firePerfectMult
 *                     is 1.4), so a beginner swings at "always on fire" width.
 *   Amateur   1.2x  — the default once the lesson is behind you.
 *   Pro       1.0x  — the shipped game. The bar every course record is set at.
 *   Expert    0.8x  — for players who find Pro too forgiving.
 *
 * They multiply, they do not replace: a Beginner who catches fire is at
 * 1.4 x 1.4, and club upgrades / perks stack on top exactly as before. The
 * whole product lands in `SwingCtx.perfectMult` (systems/swingModel.ts), which
 * already scales both the perfect and the good half-widths together.
 *
 * DEFAULTS. A player who has never chosen gets Beginner while the lesson is
 * still ahead of them and Amateur once it is behind them — see
 * {@link defaultDifficulty}. Choosing anything in Settings makes it explicit and
 * the defaults stop applying.
 *
 * RECORDS. A wider band is a real scoring advantage, so a course record can only
 * be set at Pro or harder ({@link recordsAllowed}). Everything else about an
 * easier round is unchanged — it still pays coins and XP, still counts toward
 * the season pass, still fills the career.
 *
 * Pure: no DOM, no storage, no engine. The profile stores the choice, the round
 * locks one in at the tee (main.ts), and shared seasons carry the host's choice
 * so everyone in one is playing the same game.
 */

export type Difficulty = 'beginner' | 'amateur' | 'pro' | 'expert';

/** Easiest to hardest. The settings screen renders them in this order. */
export const DIFFICULTIES: readonly Difficulty[] = ['beginner', 'amateur', 'pro', 'expert'];

export interface DifficultyProfile {
  id: Difficulty;
  /** Player-facing name. */
  label: string;
  /**
   * Multiplier on the swing meter's perfect AND good half-widths. 1.0 is the
   * game as shipped; above 1 is wider (easier), below 1 narrower.
   */
  zoneMult: number;
  /**
   * One line saying what this difficulty actually changes.
   *
   * Written for somebody who has played one hole: it appears in Settings AND on
   * the tutorial's after-the-hole card. It must not lean on vocabulary the game
   * has not taught yet — the first draft said Beginner was "the same width the
   * Fire streak gives you", which is meaningless to a player who has never
   * caught fire (owner: "don't say it's the same as fire, that won't mean
   * anything to them").
   */
  blurb: string;
  /** True when a round at this difficulty may set a course record. */
  ranked: boolean;
}

const PROFILES: Readonly<Record<Difficulty, DifficultyProfile>> = {
  beginner: {
    id: 'beginner',
    label: 'Beginner',
    zoneMult: 1.4,
    blurb: 'The widest green band on the swing bar — the most room to flush a shot.',
    ranked: false
  },
  amateur: {
    id: 'amateur',
    label: 'Amateur',
    zoneMult: 1.2,
    blurb: 'A little more room on the swing bar than the real thing.',
    ranked: false
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    zoneMult: 1,
    blurb: 'The real thing — the band the game is built around. Course records need Pro or Expert.',
    ranked: true
  },
  expert: {
    id: 'expert',
    label: 'Expert',
    zoneMult: 0.8,
    blurb: 'A narrower band than Pro. Flushing one has to be earned.',
    ranked: true
  }
};

/** The difficulty a player who has never chosen one gets BEFORE the lesson. */
export const TUTORIAL_DIFFICULTY: Difficulty = 'beginner';
/** ...and after it. */
export const DEFAULT_DIFFICULTY: Difficulty = 'amateur';

export function difficultyProfile(id: Difficulty): DifficultyProfile {
  return PROFILES[id];
}

/**
 * Coerce untrusted input (stored profile, synced doc, URL) to a Difficulty,
 * or `undefined` when there is nothing valid there.
 *
 * Deliberately NOT defaulting: "absent" and "chose Amateur" are different facts.
 * Absent means the defaults in {@link defaultDifficulty} still apply, so a
 * player who finishes the lesson moves up on their own; a stored 'amateur'
 * means they said so and nothing moves it again.
 */
export function asDifficulty(v: unknown): Difficulty | undefined {
  return typeof v === 'string' && (DIFFICULTIES as readonly string[]).includes(v) ? (v as Difficulty) : undefined;
}

/**
 * What a player who has never opened the setting plays at.
 *
 * Owner rule: "the default for the tutorial should be beginner. for any round
 * after that default should be amateur." The lesson's own completion flag is
 * device-local (DeviceSettings.tutorialDone), which is the right scope for it:
 * the question being asked is "has whoever is holding this phone been taught
 * yet", not "does this account own a lesson".
 */
export function defaultDifficulty(tutorialDone: boolean): Difficulty {
  return tutorialDone ? DEFAULT_DIFFICULTY : TUTORIAL_DIFFICULTY;
}

/** The stored choice if there is one, else the default for this device. */
export function effectiveDifficulty(chosen: unknown, tutorialDone: boolean): Difficulty {
  return asDifficulty(chosen) ?? defaultDifficulty(tutorialDone);
}

/** Multiplier this difficulty applies to the perfect + good swing zones. */
export function zoneMultFor(id: Difficulty): number {
  return PROFILES[id].zoneMult;
}

/** True when a round played at `id` may set a course record. */
export function recordsAllowed(id: Difficulty): boolean {
  return PROFILES[id].ranked;
}

/** Why records are off, in the player's terms. Never a silent no-op. */
export const UNRANKED_RECORDS_MSG = 'Course records are only set on Pro or Expert.';
