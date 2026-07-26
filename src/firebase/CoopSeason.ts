/**
 * SHARED TOUR SEASONS — two players, one schedule (owner pass 9: "Allow a
 * user to start a season with another user. Should be able to invite them via
 * a text link. Either user can play through as many tournaments as they want.
 * Points will be calculated on current placements and update when the second
 * user finishes.").
 *
 * The doc is deliberately tiny. The AI field is fully DETERMINISTIC from the
 * season seed — both players simulate the identical ten rivals for every
 * event — so the only thing that has to travel between devices is each
 * human's per-event score. Everything else (schedule, courses, majors, rival
 * scores) is re-derived locally from the seed.
 *
 * Plain REST against `/coopSeasons/{sid}` (the Challenges.ts pattern:
 * fire-and-forget writes, bounded reads, friends-tier trust). Rules
 * (docs/FIREBASE_SETUP.md): world-readable; the doc is write-once; each
 * player writes only under their own id, and each event result is write-once
 * so a posted score can never be rewritten.
 */

import { leaderboardUrl } from './History';

/** One player's score in one event of the shared season. */
export interface CoopResult {
  /** Cumulative strokes for the event (a major sums its three rounds). */
  total: number;
  toPar: number;
  at: number;
}

export interface CoopPlayer {
  /** Opaque player id (uid or guest id) — never an email/real identity. */
  playerId: string;
  name: string;
  /** Event index (0-based, as a string key in RTDB) → their score. */
  results: Record<string, CoopResult>;
}

export interface CoopSeasonDoc {
  v: 1;
  sid: string;
  /** The season seed BOTH players run: identical schedule and identical AI
   *  field, so only human scores need syncing. */
  seed: number;
  seasonNo: number;
  createdAt: number;
  players: Record<string, CoopPlayer>;
}

const SID = /^[A-Za-z0-9_-]{6,32}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A season is 16 events; anything outside that is a malformed key. */
const MAX_EVENT_IDX = 63;

/** The RTDB base, or null when no shared backend is configured. Routed
 *  through History's resolver rather than the raw constant so the `?lb=`
 *  test override reaches shared seasons too. */
function base(): string | null {
  return leaderboardUrl();
}

/** Random, unguessable-enough shared-season id (friends-tier). */
export function makeCoopId(): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `cs${rnd}`;
}

/** The invite a friend taps. The id is all it carries — the doc holds the
 *  seed, so the link stays short enough to text. */
export function coopUrl(sid: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/?coop=${encodeURIComponent(sid)}`;
}

/** Pull a shared-season id out of a pasted link or a bare id. */
export function parseCoopParam(raw: string): string | null {
  const trimmed = raw.trim();
  const fromUrl = /[?&]coop=([A-Za-z0-9_-]+)/.exec(trimmed);
  const id = fromUrl ? fromUrl[1] : trimmed;
  return SID.test(id) ? id : null;
}

/** Validate any stored/fetched shape into a doc, or null. A malformed player
 *  or result is dropped rather than trusted — a shared doc is friends-tier,
 *  not verified. */
export function migrateCoopDoc(raw: unknown): CoopSeasonDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<CoopSeasonDoc>;
  if (typeof d.sid !== 'string' || !SID.test(d.sid)) return null;
  if (typeof d.seed !== 'number' || !Number.isFinite(d.seed)) return null;
  const players: Record<string, CoopPlayer> = {};
  for (const [pid, p] of Object.entries(d.players ?? {})) {
    if (!SAFE_ID.test(pid) || !p || typeof p !== 'object') continue;
    const results: Record<string, CoopResult> = {};
    for (const [k, r] of Object.entries((p as CoopPlayer).results ?? {})) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0 || idx > MAX_EVENT_IDX) continue;
      if (!r || typeof r.total !== 'number' || typeof r.toPar !== 'number') continue;
      results[String(idx)] = { total: r.total, toPar: r.toPar, at: typeof r.at === 'number' ? r.at : 0 };
    }
    players[pid] = {
      playerId: pid,
      name: typeof (p as CoopPlayer).name === 'string' ? (p as CoopPlayer).name.slice(0, 24) : 'A friend',
      results
    };
  }
  return {
    v: 1,
    sid: d.sid,
    seed: d.seed,
    seasonNo: typeof d.seasonNo === 'number' ? d.seasonNo : 1,
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : 0,
    players
  };
}

/** Create the shared season (first write stands). */
export async function createCoopSeason(doc: CoopSeasonDoc): Promise<boolean> {
  const url = base();
  if (!url || !SID.test(doc.sid)) return false;
  try {
    const res = await fetch(`${url}/coopSeasons/${doc.sid}.json`, {
      method: 'PUT',
      body: JSON.stringify(doc)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Add (or refresh the name of) a player in a shared season. */
export async function joinCoopSeason(sid: string, playerId: string, name: string): Promise<boolean> {
  const url = base();
  if (!url || !SID.test(sid) || !SAFE_ID.test(playerId)) return false;
  try {
    const res = await fetch(`${url}/coopSeasons/${sid}/players/${playerId}.json`, {
      method: 'PATCH',
      body: JSON.stringify({ playerId, name: name.slice(0, 24) })
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Post one finished event's score. Write-once per (player, event) by rule —
 *  a re-post of the same event is refused server-side, which is what makes a
 *  posted score final. */
export async function postCoopResult(
  sid: string,
  playerId: string,
  eventIdx: number,
  result: CoopResult
): Promise<boolean> {
  const url = base();
  if (!url || !SID.test(sid) || !SAFE_ID.test(playerId)) return false;
  if (!Number.isInteger(eventIdx) || eventIdx < 0 || eventIdx > MAX_EVENT_IDX) return false;
  try {
    const res = await fetch(
      `${url}/coopSeasons/${sid}/players/${playerId}/results/${eventIdx}.json`,
      { method: 'PUT', body: JSON.stringify(result) }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Read the shared season. Bounded (6 s) and null on any failure, so a hub
 *  paint is never blocked by the network. */
export async function fetchCoopSeason(sid: string): Promise<CoopSeasonDoc | null> {
  const url = base();
  if (!url || !SID.test(sid)) return null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
  try {
    const res = await fetch(`${url}/coopSeasons/${sid}.json`, { signal: ctl?.signal });
    if (!res.ok) return null;
    return migrateCoopDoc(await res.json());
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
