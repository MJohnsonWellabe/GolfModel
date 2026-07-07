import { CourseData, GameMode } from '../core/types';

export const SCORE_NAMES: Record<number, string> = {
  [-3]: 'Albatross!',
  [-2]: 'Eagle!',
  [-1]: 'Birdie!',
  0: 'Par',
  1: 'Bogey',
  2: 'Double Bogey',
  3: 'Triple Bogey'
};

export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in One!';
  const diff = strokes - par;
  return SCORE_NAMES[diff] ?? `+${diff}`;
}

export function formatToPar(total: number, parTotal: number): string {
  const diff = total - parTotal;
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

/**
 * Tracks strokes per hole per player, and derives stroke-play and
 * Ryder Cup match-play results.
 */
export class Scoring {
  /** strokes[playerIndex][holeIndex] */
  readonly strokes: number[][];

  constructor(
    readonly mode: GameMode,
    readonly course: CourseData,
    readonly playerCount: number
  ) {
    this.strokes = Array.from({ length: playerCount }, () =>
      new Array(course.holes.length).fill(0)
    );
  }

  recordHole(playerIndex: number, holeIndex: number, strokeCount: number): void {
    this.strokes[playerIndex][holeIndex] = strokeCount;
  }

  totalStrokes(playerIndex: number): number {
    return this.strokes[playerIndex].reduce((a, b) => a + b, 0);
  }

  /** Total relative to par over holes actually completed. */
  totalToPar(playerIndex: number, throughHole: number): number {
    let diff = 0;
    for (let h = 0; h <= throughHole && h < this.course.holes.length; h++) {
      const s = this.strokes[playerIndex][h];
      if (s > 0) diff += s - this.course.holes[h].par;
    }
    return diff;
  }
}
