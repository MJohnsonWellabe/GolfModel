import { LEADERBOARD_URL } from '../config';
import { GameMode } from '../core/types';

/** One finished round, as stored locally and on the shared leaderboard. */
export interface RoundRecord {
  id: string;
  /** Epoch ms. */
  d: number;
  /** Course name (e.g. "Amen Corner"). */
  course: string;
  mode: GameMode;
  /** Display name: "Matt", or "Matt & Tiger" for a scramble team. */
  names: string;
  golferId: string;
  total: number;
  toPar: number;
  holes: number[];
  /** Total putts taken (absent on rounds recorded before putt tracking). */
  putts?: number;
  /** Putts taken per hole, parallel to holes[]. */
  hputts?: number[];
  /** Signed-in account uid (absent on rounds recorded before account tracking,
   *  and never present for signed-out play — saveRound is only ever called for
   *  a signed-in profile, so every uid here is a real Firebase uid). */
  uid?: string;
  /** Player's post-round lifetime XP total (grow-only). Lets the admin surface
   *  per-account XP from the public /rounds node without reading the private
   *  profiles/{uid} tree. Absent on rounds recorded before this field shipped. */
  xp?: number;
}

const LOCAL_KEY = 'johnsons-golf-history-v1';
const LOCAL_CAP = 300;

/** Resolve the shared-leaderboard base URL (test override via ?lb=...). */
export function leaderboardUrl(): string | null {
  try {
    const qp = new URLSearchParams(window.location.search).get('lb');
    const url = qp || LEADERBOARD_URL;
    return url ? url.replace(/\/+$/, '') : null;
  } catch {
    return LEADERBOARD_URL || null;
  }
}

export function isShared(): boolean {
  return leaderboardUrl() !== null;
}

export function makeRoundId(): string {
  return `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function loadLocal(): RoundRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RoundRecord[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(rounds: RoundRecord[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rounds.slice(-LOCAL_CAP)));
  } catch {
    // Storage full/blocked — history is best-effort.
  }
}

/** Wipe this device's local round history (Reset Records). Shared-leaderboard
 *  entries live server-side and are not touched — the caller warns about that. */
export function clearLocalHistory(): void {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    // Ignore — nothing persisted to clear.
  }
}

/** Persist a finished round locally and (fire-and-forget) to the leaderboard. */
export function saveRound(round: RoundRecord): void {
  const rounds = loadLocal();
  if (!rounds.some((r) => r.id === round.id)) {
    rounds.push(round);
    saveLocal(rounds);
  }
  const url = leaderboardUrl();
  if (url) {
    fetch(`${url}/rounds/${round.id}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(round)
    }).catch(() => {
      // Offline — the local copy still counts on this device.
    });
  }
}

/** All known rounds: shared leaderboard (if reachable) merged with local history. */
export async function fetchAllRounds(): Promise<{ rounds: RoundRecord[]; shared: boolean }> {
  const local = loadLocal();
  const url = leaderboardUrl();
  if (!url) return { rounds: local, shared: false };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${url}/rounds.json`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, RoundRecord> | null;
    const remote = data ? Object.values(data) : [];
    const byId = new Map<string, RoundRecord>();
    for (const r of [...remote, ...local]) {
      if (r && typeof r.id === 'string' && typeof r.total === 'number') byId.set(r.id, r);
    }
    return { rounds: [...byId.values()], shared: true };
  } catch {
    return { rounds: local, shared: false };
  }
}

/** Best rounds for a course + mode, lowest total first (ties: earliest wins). */
export function bestRounds(
  rounds: RoundRecord[],
  course: string,
  mode: GameMode,
  n: number
): RoundRecord[] {
  return rounds
    .filter((r) => r.course === course && r.mode === mode)
    .sort((a, b) => a.total - b.total || a.d - b.d)
    .slice(0, n);
}

/** Is this round strictly better than every OTHER round on that course+mode? */
export function isNewRecord(rounds: RoundRecord[], round: RoundRecord): boolean {
  const others = rounds.filter(
    (r) => r.id !== round.id && r.course === round.course && r.mode === round.mode
  );
  if (others.length === 0) return true;
  return round.total < Math.min(...others.map((r) => r.total));
}
