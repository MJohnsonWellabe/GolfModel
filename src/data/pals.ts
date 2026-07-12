/**
 * Pals — companion pets that follow the player around the course and settle
 * off to the side of the ball while they hit. Purely decorative: no gameplay
 * effect, so nothing outside the renderer ever branches on which pal is
 * equipped. Models are the uploaded pets converted by scripts/convert-pals.mjs
 * into assets/models/pals/.
 *
 * The starter pair is free and owned by default; future pals arrive as priced
 * `pal` items in the store catalog.
 */
export type PalKey = 'fox' | 'dragon' | 'gecko' | 'trex' | 'crab' | 'pug' | 'cat' | 'foxorange';

export interface PalDef {
  key: PalKey;
  /** Label shown on the Pals screen and store cards. */
  name: string;
  /** glb path, relative (no leading slash) for the GitHub Pages subpath. */
  file: string;
  /** World-unit height the model is normalized to (golfers stand 5.2). */
  targetHeight: number;
  /** Emoji stand-in shown on menu cards (pals ship no portrait renders). */
  icon: string;
}

const def = (key: PalKey, name: string, targetHeight: number, icon: string): PalDef => ({
  key,
  name,
  file: `models/pals/${key}.glb`,
  targetHeight,
  icon
});

// Sizes bumped +50% (playtest — pals read too small next to the golfer): fox
// 2.4 -> 3.6, dragon 3.0 -> 4.5 (golfers stand 5.2). setSizeMult keeps the
// putting-view shrink proportional. Gecko/trex/crab sized the same way —
// low-slung critters shorter, the trex the tallest pal in the roster.
export const PALS: PalDef[] = [
  def('fox', 'Foxy', 3.6, '🦊'),
  def('dragon', 'Ember', 4.5, '🐉'),
  def('gecko', 'Zippy', 2.6, '🦎'),
  def('trex', 'Rexy', 4.8, '🦖'),
  def('crab', 'Clawdia', 2.4, '🦀'),
  def('pug', 'Pugsley', 2.6, '🐶'),
  def('cat', 'Whiskers', 2.9, '🐱'),
  // A warm red-fox recolor of the arctic fox (same mesh, coat re-chroma'd to
  // orange at convert time → its own foxorange.glb) — a second fox option
  // alongside the original, not a replacement.
  def('foxorange', 'Rusty', 3.6, '🦊')
];

export function palByKey(key: string | undefined): PalDef | undefined {
  return PALS.find((p) => p.key === key);
}
