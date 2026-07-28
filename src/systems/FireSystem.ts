import { FIRE, SWING } from '../config';
import { SwingResult } from '../core/types';

/**
 * "Catch fire" streak system, shared by the player and the AI.
 * Two all-perfect swings in a row ignite it; any missed band puts it out.
 *
 * FIRE DOES EXACTLY ONE THING: it widens the swing meter's perfect and good
 * bands ({@link FireSystem.perfectZoneMultiplier}). It used to ALSO add +5 to
 * driving power and accuracy, which quietly bought a player who was already
 * striking it perfectly more carry and tighter dispersion on top of an easier
 * target — three rewards for one achievement, only one of which the player
 * could see. Owner: "that's enough of a boost. we don't also need it to
 * increase distance, reduce dispersion, etc."
 *
 * So the stat boost is gone, and with it the `fireBoost` parameter that used to
 * be threaded through statsForClub / effectiveCarryYards / every launch. A shot
 * on fire now flies exactly as far as the same shot cold — which is also what
 * makes the aim ring honest, since it no longer jumps the moment you ignite.
 */
export class FireSystem {
  private streak = 0;
  private onFire = false;

  get isOnFire(): boolean {
    return this.onFire;
  }

  get currentStreak(): number {
    return this.streak;
  }

  /** Multiplier applied to the swing meter's perfect zone width. */
  get perfectZoneMultiplier(): number {
    return this.onFire ? SWING.firePerfectMult : 1;
  }

  /**
   * Feed a completed swing into the streak.
   * Returns true if this swing just ignited the fire.
   */
  recordSwing(result: SwingResult): boolean {
    // ONLY an all-perfect swing keeps the fire alive (owner): anything less than
    // perfect-perfect — a "good" band on either click, or a miss — puts it out.
    // Fire is a reward for a flawless run, not a merely-decent one.
    if (result.powerQuality !== 'perfect' || result.accuracyQuality !== 'perfect') {
      this.streak = 0;
      this.onFire = false;
      return false;
    }
    this.streak += 1;
    if (!this.onFire && this.streak >= FIRE.streakToIgnite) {
      this.onFire = true;
      return true;
    }
    return false;
  }

  reset(): void {
    this.streak = 0;
    this.onFire = false;
  }

  /** Serialize the streak so it can survive a hole change (the per-hole
   *  HoleScene, and its FireSystems, are disposed and rebuilt each hole — the
   *  streak must persist within a round, ending only on a missed band). */
  snapshot(): { streak: number; onFire: boolean } {
    return { streak: this.streak, onFire: this.onFire };
  }

  restore(state: { streak: number; onFire: boolean } | undefined): void {
    if (!state) return;
    this.streak = state.streak;
    this.onFire = state.onFire;
  }
}
