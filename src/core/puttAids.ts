import { Surface } from './types';

/** Distance (yards) inside which a greenside chip shows the putting-read grid. */
export const CHIP_GRID_YDS = 14;

/**
 * Whether the putting-read grid should be visible for the current shot. Always
 * on for a putt; for a human's short greenside chip — not from the tee, and
 * within CHIP_GRID_YDS of the pin — the grid helps read the roll of the coming
 * chip (playtest: "when chipping from really close I want the putting grid").
 * The AI never needs the aid.
 */
export function shouldShowPuttGrid(opts: {
  isPutting: boolean;
  isAI: boolean;
  lie: Surface;
  toPinYds: number;
}): boolean {
  if (opts.isPutting) return true;
  return !opts.isAI && opts.lie !== 'tee' && opts.toPinYds <= CHIP_GRID_YDS;
}
