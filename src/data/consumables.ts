/**
 * Consumables — single-use items spent instantly on tap (season-pass
 * rewards). Contrast with perks.ts: a perk is equipped for a whole round and
 * consumed at round-end; a consumable is spent the moment it's used. Never
 * buyable with coins — season-pass claim only (data/seasonPass.ts).
 */

export interface ConsumableDef {
  id: string;
  /** Card label, e.g. "True Vision". */
  name: string;
  /** Emoji shown on the reward card / in-round button. */
  icon: string;
}

/** Reveals the exact line (with real green break) a putt will follow into
 *  the hole, as a red dashed line, until the putt is struck. Pace/distance
 *  is still up to the player — only the aim line is revealed. */
export const TRUE_VISION: ConsumableDef = { id: 'true_vision', name: 'True Vision', icon: '👁️' };

const ALL: ConsumableDef[] = [TRUE_VISION];

export function consumableById(id: string): ConsumableDef | undefined {
  return ALL.find((c) => c.id === id);
}
