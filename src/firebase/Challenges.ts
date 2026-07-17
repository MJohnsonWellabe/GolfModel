/**
 * 1v1 challenge result tracking — plain REST against the RTDB
 * `/challenges/{cid}` node (the Tournaments/Weekly pattern: fire-and-forget
 * writes, bounded reads, friends-tier trust).
 *
 * Lifecycle: the challenger's finished round creates the doc (their score is
 * the target); the ?c= link carries the cid; each recipient's finished round
 * posts a write-once response. Both sides read the doc from their "Your
 * Challenges" profile section to see who won.
 *
 * Rules (docs/FIREBASE_SETUP.md): world-readable; the doc itself and each
 * response are write-once, so a posted score can never be overwritten.
 */

import { LEADERBOARD_URL } from '../config';

export interface ChallengeSide {
  /** Opaque player id (uid or guest id) — never an email/real identity. */
  playerId: string;
  name: string;
  total: number;
  toPar: number;
  at: number;
}

export interface ChallengeDoc {
  cid: string;
  courseId: string;
  seed: number;
  createdAt: number;
  creator: ChallengeSide;
  /** playerId → response (write-once each). */
  responses?: Record<string, ChallengeSide>;
}

const CID = /^[A-Za-z0-9_-]{6,32}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Random, unguessable-enough challenge id (friends-tier). */
export function makeChallengeId(): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `ch${rnd}`;
}

/** Create the challenge doc (first write stands). Fire-and-forget-safe. */
export async function createChallengeDoc(doc: ChallengeDoc): Promise<boolean> {
  if (!CID.test(doc.cid) || !SAFE_ID.test(doc.creator.playerId)) return false;
  try {
    const res = await fetch(`${LEADERBOARD_URL}/challenges/${doc.cid}.json`, {
      method: 'PUT',
      body: JSON.stringify({ ...doc, responses: undefined })
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Post a recipient's result (write-once per player). */
export async function submitChallengeResponse(cid: string, side: ChallengeSide): Promise<boolean> {
  if (!CID.test(cid) || !SAFE_ID.test(side.playerId)) return false;
  try {
    const res = await fetch(
      `${LEADERBOARD_URL}/challenges/${cid}/responses/${encodeURIComponent(side.playerId)}.json`,
      { method: 'PUT', body: JSON.stringify(side) }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Fetch one challenge doc (6s abort; null on absent/offline). */
export async function fetchChallenge(cid: string): Promise<ChallengeDoc | null> {
  if (!CID.test(cid)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${LEADERBOARD_URL}/challenges/${cid}.json`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as ChallengeDoc | null;
    return data && typeof data.cid === 'string' && data.creator ? data : null;
  } catch {
    return null;
  }
}

export type ChallengeOutcomeFor = 'won' | 'lost' | 'tied' | 'pending';

/**
 * The viewing player's result on a challenge. Challenger: compared against the
 * BEST response (any responder beating the target loses it for the creator);
 * responder: their own response vs the creator's target. Lower total wins.
 */
export function outcomeFor(doc: ChallengeDoc, playerId: string): ChallengeOutcomeFor {
  const responses = Object.values(doc.responses ?? {});
  if (doc.creator.playerId === playerId) {
    if (!responses.length) return 'pending';
    const best = Math.min(...responses.map((r) => r.total));
    return best < doc.creator.total ? 'lost' : best === doc.creator.total ? 'tied' : 'won';
  }
  const mine = doc.responses?.[playerId];
  if (!mine) return 'pending';
  return mine.total < doc.creator.total ? 'won' : mine.total === doc.creator.total ? 'tied' : 'lost';
}
