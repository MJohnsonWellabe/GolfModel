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
