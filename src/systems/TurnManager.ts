import { RULES } from '../config';
import { dist } from '../utils/Geometry';
import { GameMode, Point, ShotOutcome, Surface } from '../core/types';

/** The slice of a player TurnManager needs — GameScene's runtime players satisfy it. */
export interface TurnPlayer {
  ball: Point;
  lie: Surface;
  strokes: number;
  holed: boolean;
  isAI: boolean;
}

/** Hysteresis (world px) before "farthest from the pin" switches players. */
const FARTHEST_SLACK = 24;

/**
 * Turn order and hole-completion rules for every mode.
 *
 * Stroke play (solo / 1v1): farthest ball from the pin plays next; a player
 * at the stroke cap picks up.
 *
 * Scramble (best ball): both teammates play from the shared team ball, then
 * the better result becomes the new team ball at the cost of one stroke.
 * TurnManager owns the team state; the scene owns presentation and timing.
 */
export class TurnManager {
  // Scramble team state
  teamBall: Point = { x: 0, y: 0 };
  teamLie: Surface = 'tee';
  teamStrokes = 0;
  teamHoled = false;
  private phase = 0;
  private outcomes: Array<ShotOutcome | null> = [null, null];

  constructor(
    private readonly mode: GameMode,
    private readonly pin: Point,
    tee: Point
  ) {
    this.teamBall = { ...tee };
  }

  get isScramble(): boolean {
    return this.mode === 'scramble';
  }

  get scramblePhase(): number {
    return this.phase;
  }

  /**
   * Stroke play: mark players at the stroke cap as picked up.
   * Returns the indices that just picked up (for feedback messages).
   */
  applyPickups(players: TurnPlayer[]): number[] {
    const pickedUp: number[] = [];
    players.forEach((p, i) => {
      if (!p.holed && p.strokes >= RULES.maxStrokes) {
        p.holed = true;
        pickedUp.push(i);
      }
    });
    return pickedUp;
  }

  /**
   * Stroke play: index of the next player to hit (farthest from the pin,
   * with slack so near-ties don't flip-flop), or null when the hole is over.
   */
  nextPlayer(players: TurnPlayer[]): number | null {
    let idx = -1;
    let far = -1;
    players.forEach((p, i) => {
      if (p.holed) return;
      const d = dist(p.ball, this.pin);
      if (d > far + FARTHEST_SLACK) {
        far = d;
        idx = i;
      } else if (idx === -1) {
        idx = i;
      }
    });
    return idx === -1 ? null : idx;
  }

  /** Scramble: the team is done when it holed out or hit the stroke cap. */
  get scrambleFinished(): boolean {
    return this.teamHoled || this.teamStrokes >= RULES.maxStrokes;
  }

  /**
   * Scramble: start the current teammate's attempt from the team ball.
   * Returns the player index to put on the tee.
   */
  beginScrambleShot(players: TurnPlayer[]): number {
    const idx = this.phase;
    const p = players[idx];
    p.ball = { ...this.teamBall };
    p.lie = this.teamLie;
    return idx;
  }

  /** Scramble: record an attempt; true when both teammates have hit. */
  recordScrambleOutcome(outcome: ShotOutcome): boolean {
    this.outcomes[this.phase] = outcome;
    if (this.phase === 0) {
      this.phase = 1;
      return false;
    }
    return true;
  }

  /**
   * Scramble: pick the better ball, advance the team state, and reset for
   * the next cycle. Every player's ball moves to the chosen spot.
   */
  resolveScramble(players: TurnPlayer[]): { chooserIdx: number; chosen: ShotOutcome } {
    const [a, b] = this.outcomes;
    if (!a || !b) throw new Error('resolveScramble called before both outcomes');
    const score = (o: ShotOutcome): number => {
      if (o.holed) return -1;
      return dist(o.finalPos, this.pin) + (o.waterPenalty || o.obPenalty ? 100000 : 0);
    };
    const chooseA = score(a) <= score(b);
    const chosen = chooseA ? a : b;

    this.teamStrokes += 1 + (chosen.waterPenalty ? 1 : 0) + (chosen.obPenalty ? 1 : 0);
    this.teamBall = { ...chosen.finalPos };
    this.teamLie = chosen.surface;
    if (chosen.holed) this.teamHoled = true;
    this.outcomes = [null, null];
    this.phase = 0;

    for (const p of players) {
      p.ball = { ...this.teamBall };
    }
    return { chooserIdx: chooseA ? 0 : 1, chosen };
  }
}
