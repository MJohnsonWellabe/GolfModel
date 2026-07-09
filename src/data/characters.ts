/**
 * Selectable character avatars — the cosmetic half of a golfer's identity
 * (the gameplay half is the Archetype in ./archetypes.ts). The full roster of
 * 25 rigged chibi models from the purchased "Cute Characters 4" pack (ithappy,
 * f_1–f_12 + m_1–m_13), each a self-contained glb under
 * assets/models/characters/ with the pack's animation clips baked in
 * (Idle / Win / Sad drive the in-game golfer — see slice3d/characterModels.ts).
 *
 * Choosing a character is purely visual: any character can be paired with any
 * archetype, so gameplay code never branches on which avatar is selected.
 */
export type CharacterKey =
  | 'chip'
  | 'dez'
  | 'rio'
  | 'kuro'
  | 'beat'
  | 'rose'
  | 'sunny'
  | 'lily'
  | 'jade'
  | 'nova'
  | 'theo'
  | 'milo'
  | 'finn'
  | 'cole'
  | 'reid'
  | 'enzo'
  | 'dash'
  | 'knox'
  | 'bree'
  | 'coco'
  | 'wren'
  | 'ivy'
  | 'pia'
  | 'zuri'
  | 'remi';

export interface CharacterDef {
  key: CharacterKey;
  /** Short label shown under the avatar on the select screen. */
  name: string;
  /** glb path, relative (no leading slash) for the GitHub Pages subpath. */
  file: string;
}

const model = (key: CharacterKey): string => `models/characters/${key}.glb`;
const def = (key: CharacterKey, name: string): CharacterDef => ({ key, name, file: model(key) });

export const CHARACTERS: CharacterDef[] = [
  def('chip', 'Chip'),
  def('rose', 'Rose'),
  def('rio', 'Rio'),
  def('sunny', 'Sunny'),
  def('theo', 'Theo'),
  def('dez', 'Dez'),
  def('beat', 'Beat'),
  def('kuro', 'Kuro'),
  def('lily', 'Lily'),
  def('jade', 'Jade'),
  def('nova', 'Nova'),
  def('milo', 'Milo'),
  def('finn', 'Finn'),
  def('cole', 'Cole'),
  def('reid', 'Reid'),
  def('enzo', 'Enzo'),
  def('dash', 'Dash'),
  def('knox', 'Knox'),
  def('bree', 'Bree'),
  def('coco', 'Coco'),
  def('wren', 'Wren'),
  def('ivy', 'Ivy'),
  def('pia', 'Pia'),
  def('zuri', 'Zuri'),
  def('remi', 'Remi')
];

const BY_KEY = new Map(CHARACTERS.map((c) => [c.key, c]));

export function characterByKey(key: string): CharacterDef | undefined {
  return BY_KEY.get(key as CharacterKey);
}
