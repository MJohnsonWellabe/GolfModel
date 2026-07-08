/**
 * Selectable character avatars — the cosmetic half of a golfer's identity
 * (the gameplay half is the Archetype in ./archetypes.ts). Ten rigged chibi
 * models curated from the purchased "Cute Characters 4" pack (ithappy), each
 * exported to a self-contained glb under assets/models/characters/ with the
 * pack's animation clips baked in (Idle / Win / Sad drive the in-game golfer —
 * see slice3d/characterModels.ts).
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
  | 'nova';

export interface CharacterDef {
  key: CharacterKey;
  /** Short label shown under the avatar on the select screen. */
  name: string;
  /** glb path, relative (no leading slash) for the GitHub Pages subpath. */
  file: string;
}

const model = (key: CharacterKey): string => `models/characters/${key}.glb`;

export const CHARACTERS: CharacterDef[] = [
  { key: 'chip', name: 'Chip', file: model('chip') },
  { key: 'dez', name: 'Dez', file: model('dez') },
  { key: 'rio', name: 'Rio', file: model('rio') },
  { key: 'kuro', name: 'Kuro', file: model('kuro') },
  { key: 'beat', name: 'Beat', file: model('beat') },
  { key: 'rose', name: 'Rose', file: model('rose') },
  { key: 'sunny', name: 'Sunny', file: model('sunny') },
  { key: 'lily', name: 'Lily', file: model('lily') },
  { key: 'jade', name: 'Jade', file: model('jade') },
  { key: 'nova', name: 'Nova', file: model('nova') }
];

const BY_KEY = new Map(CHARACTERS.map((c) => [c.key, c]));

export function characterByKey(key: string): CharacterDef | undefined {
  return BY_KEY.get(key as CharacterKey);
}
