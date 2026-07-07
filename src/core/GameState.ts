import { FireSystem } from './FireSystem';
import { Scoring } from './Scoring';
import { CourseData, GameMode, Golfer, Point, Surface, Wind } from './types';

/**
 * Global game state, carried across scenes.
 * Selection scenes fill it in; GameScene reads and updates it during play.
 */
export class GameState {
  golfer: Golfer | null = null;
  opponent: Golfer | null = null;
  mode: GameMode = 'solo';
  course: CourseData | null = null;
  holeIndex = 0;
  scoring: Scoring | null = null;
  /** Fire state per player index (0 = human, 1 = AI). */
  fire: FireSystem[] = [];
  /** Convenience mirror of the human player's streak, for HUD display. */
  streak = 0;
  ballPosition: Point = { x: 0, y: 0 };
  lie: Surface = 'tee';
  wind: Wind = { angle: 0, speed: 0 };
  club = 'driver';
  /** Guards against saving the same finished round to history twice. */
  roundSaved = false;

  /** Golfers on the course (scramble = you + a partner). */
  get playerCount(): number {
    return this.mode === 'solo' ? 1 : 2;
  }

  /** Rows on the scorecard (a scramble team scores as one). */
  get scoringRows(): number {
    return this.mode === '1v1' ? 2 : 1;
  }

  /** Set up scoring + fire systems for a fresh round. */
  startRound(): void {
    if (!this.course) throw new Error('No course selected');
    this.holeIndex = 0;
    this.scoring = new Scoring(this.mode, this.course, this.scoringRows);
    this.fire = Array.from({ length: this.playerCount }, () => new FireSystem());
    this.streak = 0;
    this.roundSaved = false;
  }
}

/** The one shared instance. */
export const state = new GameState();
