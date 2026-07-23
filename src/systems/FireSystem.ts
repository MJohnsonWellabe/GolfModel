import { FIRE, SWING } from '../config';
import { SwingResult } from '../core/types';

/**
 * "Catch fire" streak system, shared by the player and the AI.
 * Two all-perfect swings in a row ignite it; any missed band puts it out.
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

  /** Temporary stat boost applied to the relevant category while on fire. */
  get statBoost(): number {
    return this.onFire ? FIRE.statBoost : 0;
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
    if (result.powerQuality === 'miss' || result.accuracyQuality === 'miss') {
      this.streak = 0;
      this.onFire = false;
      return false;
    }
    if (result.powerQuality === 'perfect' && result.accuracyQuality === 'perfect') {
      this.streak += 1;
      if (!this.onFire && this.streak >= FIRE.streakToIgnite) {
        this.onFire = true;
        return true;
      }
    }
    // A merely "good" swing keeps the fire but does not extend the streak.
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
