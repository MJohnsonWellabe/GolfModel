import { leaderboardUrl } from './History';

/**
 * Async tournaments + the all-time hole-in-one leaderboard, over the same
 * Realtime Database as the round leaderboard (REST, no server).
 *
 * HONEST ANTI-TAMPER NOTE: with the open REST rules the game ships with, any
 * participant can forge or overwrite scores. The client validates for
 * accidents (bounds, one entry per player, first-write-wins), not adversaries.
 * With the Phase 5 Firebase-auth rules (see docs/FIREBASE_SETUP.md), entries
 * become uid-keyed + write-once + validated, which is what makes results
 * trustworthy. Treat open-rules tournaments as friends-only.
 */

export interface Tournament {
  code: string;
  name: string;
  course: string;
  holes: number;
  createdBy: { id: string; name: string };
  createdAt: number;
  /** Epoch ms after which the leaderboard freezes. */
  endsAt: number;
  /** Shared RNG seed → identical wind/pins for every entrant. */
  seed: number;
}

export interface TournamentEntry {
  playerId: string;
  name: string;
  golferId: string;
  total: number;
  toPar: number;
  holes: number[];
  submittedAt: number;
}

/** Unambiguous alphabet (no 0/O/1/I) for shareable codes. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function makeTournamentCode(rng: () => number = Math.random): string {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return `JG-${c}`;
}

/** Winner = lowest total; ties broken by earliest submission. */
export function tournamentWinner(entries: TournamentEntry[]): TournamentEntry | null {
  if (!entries.length) return null;
  return [...entries].sort((a, b) => a.total - b.total || a.submittedAt - b.submittedAt)[0];
}

export function tournamentStandings(entries: TournamentEntry[]): TournamentEntry[] {
  return [...entries].sort((a, b) => a.total - b.total || a.submittedAt - b.submittedAt);
}

export function isEnded(t: Tournament, now: number): boolean {
  return now >= t.endsAt;
}

/** Reject obviously-impossible entries (client-side sanity, not security). */
export function isPlausibleEntry(e: TournamentEntry, holes: number, maxPerHole: number): boolean {
  if (!Array.isArray(e.holes) || e.holes.length !== holes) return false;
  if (e.holes.some((h) => h < 1 || h > maxPerHole)) return false;
  return e.total === e.holes.reduce((a, h) => a + h, 0);
}

// ------------------------------------------------------------------ REST

export async function createTournament(t: Tournament): Promise<boolean> {
  const url = leaderboardUrl();
  if (!url) return false;
  try {
    const res = await fetch(`${url}/tournaments/${t.code}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: t.name,
        course: t.course,
        holes: t.holes,
        createdBy: t.createdBy,
        createdAt: t.createdAt,
        endsAt: t.endsAt,
        seed: t.seed
      })
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchTournament(code: string): Promise<{ meta: Tournament; entries: TournamentEntry[] } | null> {
  const url = leaderboardUrl();
  if (!url) return null;
  try {
    const res = await fetch(`${url}/tournaments/${code}.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as (Omit<Tournament, 'code'> & { entries?: Record<string, TournamentEntry> }) | null;
    if (!data || typeof data.seed !== 'number') return null;
    const entries = data.entries ? Object.values(data.entries).filter((e) => e && typeof e.total === 'number') : [];
    return { meta: { ...data, code }, entries };
  } catch {
    return null;
  }
}

/** Submit an entry, first-write-wins: won't overwrite an existing score. */
export async function submitEntry(code: string, entry: TournamentEntry): Promise<boolean> {
  const url = leaderboardUrl();
  if (!url) return false;
  try {
    const existing = await fetch(`${url}/tournaments/${code}/entries/${entry.playerId}.json`);
    if (existing.ok) {
      const cur = await existing.json();
      if (cur) return false; // first score stands
    }
    const res = await fetch(`${url}/tournaments/${code}/entries/${entry.playerId}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --------------------------------------------- hole-in-one (aces) leaderboard

export interface AceRecord {
  playerId: string;
  name: string;
  aces: number;
  updatedAt: number;
}

/** Report a player's all-time ace total (their own record is authoritative). */
export async function submitAces(rec: AceRecord): Promise<boolean> {
  const url = leaderboardUrl();
  if (!url) return false;
  try {
    const res = await fetch(`${url}/aces/${rec.playerId}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** All-time ace leaderboard, most aces first (ties: earliest to reach it). */
export async function fetchAces(): Promise<AceRecord[]> {
  const url = leaderboardUrl();
  if (!url) return [];
  try {
    const res = await fetch(`${url}/aces.json`);
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, AceRecord> | null;
    const recs = data ? Object.values(data).filter((r) => r && typeof r.aces === 'number') : [];
    return recs.sort((a, b) => b.aces - a.aces || a.updatedAt - b.updatedAt);
  } catch {
    return [];
  }
}
