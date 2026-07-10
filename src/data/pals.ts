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
export type PalKey = 'fox' | 'dragon';

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

export const PALS: PalDef[] = [def('fox', 'Foxy', 2.4, '🦊'), def('dragon', 'Ember', 3.0, '🐉')];

export function palByKey(key: string | undefined): PalDef | undefined {
  return PALS.find((p) => p.key === key);
}
