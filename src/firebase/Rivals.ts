/**
 * Friend rivals — the daily fixture between two named people.
 *
 * A house rival needs no network: their rounds are synthesised locally
 * (`systems/RivalRound.ts`). A FRIEND rival does, and for a reason a share link
 * cannot solve: the fixture is a new hole every day, so a link that carried one
 * round would be stale by tomorrow. What has to travel is a channel — a place
 * both sides post today's round to and read the other's from.
 *
 * THE SHAPE. `/rivals/{pairId}/{dateKey}/{playerId}` — one small doc per person
 * per day, holding the round they played as INPUTS (`RoundRecording`), which is
 * what lets their ghost be re-flown exactly as they hit it rather than
 * approximated from a score. A day's fixture settles when both entries exist.
 *
 * TRUST. Same friends-tier model as Tournaments/Weekly/Challenges, and
 * documented as such: writes are unauthenticated and a determined person could
 * post a round they did not play. The recording makes this materially harder
 * than the honour system it replaces — a fabricated entry has to be a
 * physically valid round that replays to its claimed score, which is exactly
 * what `verifyRound` checks server-side when `verifiedScores` is deployed. A
 * rivalry is between friends; this is proportionate.
 *
 * COST. One bounded read when the daily card paints and one write when the
 * attempt is booked. Both are fire-and-forget and neither is on an input path.
 */

import { LEADERBOARD_URL } from '../config';
import { isValidRecording, RoundRecording } from '../systems/RoundRecording';

/** Pair ids and player ids are opaque and go straight into a URL path. */
const PAIR_ID = /^[A-Za-z0-9_-]{6,40}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface RivalEntry {
  /** Opaque player id (uid or guest id) — never an email or real identity. */
  playerId: string;
  name: string;
  /** Strokes on the day's hole. */
  total: number;
  /** The round as inputs, so the other side can fly it as a ghost. Absent on a
   *  round that could not be recorded (a resumed round, an older client). */
  rec?: RoundRecording;
  at: number;
}

/**
 * A rivalry's channel id, derived from both player ids so the pair agree on it
 * without negotiating. Order-independent — either side computes the same id —
 * and hashed rather than concatenated so the node name does not leak either
 * player's id to anyone reading the tree.
 */
export function pairId(a: string, b: string): string {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  let h1 = 2166136261;
  let h2 = 0x811c9dc5;
  const s = `${lo}|${hi}`;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 + s.charCodeAt(i), 0x85ebca6b) ^ (h2 >>> 13);
  }
  return `rv${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`.slice(0, 24).padEnd(8, '0');
}

/**
 * THE INVITE.
 *
 * A rivalry is mutual, and a share link is one-way: the person who opens it
 * learns who sent it, but the sender has no way to learn who accepted. So the
 * link carries a CODE rather than an identity, and the code names a rendezvous
 * both sides can read — the inviter writes `from` when they create it, the
 * accepter writes `to` when they open it, and each side adopts the other from
 * the half they did not write.
 *
 * The code is unguessable-enough rather than secret. The worst outcome of a
 * guessed code is an unwanted rival, which the player can change.
 */
export interface RivalInvite {
  code: string;
  from: { playerId: string; name: string };
  to?: { playerId: string; name: string };
  at: number;
}

const INVITE_CODE = /^[A-Za-z0-9_-]{6,32}$/;

export function makeRivalInviteCode(): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `rv${rnd}`;
}

export async function createRivalInvite(invite: RivalInvite): Promise<boolean> {
  if (!INVITE_CODE.test(invite.code) || !SAFE_ID.test(invite.from.playerId)) return false;
  try {
    const res = await fetch(`${LEADERBOARD_URL}/rivalInvites/${invite.code}.json`, {
      method: 'PUT',
      body: JSON.stringify({ ...invite, to: undefined })
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Accept an invite: claim the `to` half. */
export async function acceptRivalInvite(
  code: string,
  to: { playerId: string; name: string }
): Promise<boolean> {
  if (!INVITE_CODE.test(code) || !SAFE_ID.test(to.playerId)) return false;
  try {
    const res = await fetch(`${LEADERBOARD_URL}/rivalInvites/${code}/to.json`, {
      method: 'PUT',
      body: JSON.stringify(to)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchRivalInvite(code: string): Promise<RivalInvite | null> {
  if (!INVITE_CODE.test(code)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${LEADERBOARD_URL}/rivalInvites/${code}.json`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as RivalInvite | null;
    if (!data || !data.from || typeof data.from.playerId !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

/** Post this player's round for a day. Write-once in practice — the first
 *  attempt is the one that counts — but a retry of the same day is harmless. */
export async function postRivalEntry(pair: string, dateKey: string, entry: RivalEntry): Promise<boolean> {
  if (!PAIR_ID.test(pair) || !DATE_KEY.test(dateKey) || !SAFE_ID.test(entry.playerId)) return false;
  try {
    const res = await fetch(
      `${LEADERBOARD_URL}/rivals/${pair}/${dateKey}/${encodeURIComponent(entry.playerId)}.json`,
      { method: 'PUT', body: JSON.stringify(entry) }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Read the OTHER side's entry for a day. Returns null when they have not played
 * yet, which is an ordinary state and not an error — the card says so rather
 * than inventing an opponent.
 *
 * A recording that fails structural validation is dropped rather than handed to
 * the physics engine.
 */
export async function fetchRivalEntry(
  pair: string,
  dateKey: string,
  theirPlayerId: string
): Promise<RivalEntry | null> {
  if (!PAIR_ID.test(pair) || !DATE_KEY.test(dateKey) || !SAFE_ID.test(theirPlayerId)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `${LEADERBOARD_URL}/rivals/${pair}/${dateKey}/${encodeURIComponent(theirPlayerId)}.json`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as RivalEntry | null;
    if (!data || typeof data.playerId !== 'string' || !Number.isFinite(data.total)) return null;
    if (data.rec && !isValidRecording(data.rec)) return { ...data, rec: undefined };
    return data;
  } catch {
    return null;
  }
}
