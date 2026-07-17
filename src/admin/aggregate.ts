import { RoundRecord } from '../firebase/History';

/**
 * Pure aggregation over leaderboard rounds for the admin dashboard.
 * Every average carries its sample count (n) — putt data in particular only
 * exists on rounds recorded after putt tracking shipped, so n varies by stat.
 */

export interface CourseAvg {
  course: string;
  n: number;
  avgTotal: number;
  avgToPar: number;
}

/** One hole's average of whatever per-hole stat was aggregated (strokes or
 *  putts — shared shape so both tables render the same way). */
export interface HoleAvg {
  hole: number; // 1-based position in the round
  n: number;
  avg: number;
}

export interface TypeAvg {
  type: string;
  n: number;
  avgTotal: number;
  avgToPar: number;
}

export interface PuttAvg {
  course: string; // 'All courses' for the overall row
  n: number;
  avgPutts: number;
}

export interface AccountRounds {
  uid: string;
  /** Most recently seen display name for this uid (names can change). */
  name: string;
  n: number;
  lastPlayed: number; // epoch ms, latest round's `d`
  avgTotal: number;
  avgToPar: number;
  /** Highest XP carried on any of this account's rounds (RoundRecord.xp is a
   *  grow-only post-round total, so max == latest). 0 when no round carries xp
   *  yet — legacy rounds predate the field; the admin overlays a profiles/{uid}
   *  backfill on top of this. */
  xp: number;
}

/** Overall totals for the dashboard summary tile. */
export interface OverallAvg {
  rounds: number;
  avgTotal: number;
  avgToPar: number;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Whole-population averages for the top summary tile: total rounds, avg total
 *  score, avg to-par. (Avg putts comes from avgPutts, which tracks its own
 *  narrower sample.) */
export function overallAvg(rounds: RoundRecord[]): OverallAvg {
  const n = rounds.length;
  if (!n) return { rounds: 0, avgTotal: 0, avgToPar: 0 };
  let total = 0;
  let toPar = 0;
  for (const r of rounds) {
    total += r.total;
    toPar += r.toPar;
  }
  return { rounds: n, avgTotal: round1(total / n), avgToPar: round2(toPar / n) };
}

export function avgByCourse(rounds: RoundRecord[]): CourseAvg[] {
  const acc = new Map<string, { n: number; total: number; toPar: number }>();
  for (const r of rounds) {
    const a = acc.get(r.course) ?? { n: 0, total: 0, toPar: 0 };
    a.n++;
    a.total += r.total;
    a.toPar += r.toPar;
    acc.set(r.course, a);
  }
  return [...acc.entries()]
    .map(([course, a]) => ({
      course,
      n: a.n,
      avgTotal: round1(a.total / a.n),
      avgToPar: round2(a.toPar / a.n)
    }))
    .sort((x, y) => y.n - x.n);
}

/** Average strokes per hole slot, per course (holes[] is positional). */
export function avgByHole(rounds: RoundRecord[]): Map<string, HoleAvg[]> {
  return avgArrayByHole(rounds, (r) => r.holes);
}

/** Average putts per hole slot, per course (hputts[] is positional — absent
 *  on rounds recorded before putt tracking, same as the overall putts avg). */
export function avgPuttsByHole(rounds: RoundRecord[]): Map<string, HoleAvg[]> {
  return avgArrayByHole(rounds, (r) => r.hputts);
}

function avgArrayByHole(rounds: RoundRecord[], pick: (r: RoundRecord) => number[] | undefined): Map<string, HoleAvg[]> {
  const acc = new Map<string, { n: number; sum: number }[]>();
  for (const r of rounds) {
    const values = pick(r);
    if (!Array.isArray(values)) continue;
    const per = acc.get(r.course) ?? [];
    values.forEach((v, i) => {
      if (typeof v !== 'number') return;
      per[i] = per[i] ?? { n: 0, sum: 0 };
      per[i].n++;
      per[i].sum += v;
    });
    acc.set(r.course, per);
  }
  const out = new Map<string, HoleAvg[]>();
  for (const [course, per] of acc) {
    out.set(
      course,
      per.map((a, i) => ({ hole: i + 1, n: a?.n ?? 0, avg: a ? round2(a.sum / a.n) : 0 }))
    );
  }
  return out;
}

/** golferId is `${character}-${archetype}` — both halves are single tokens. */
export function splitGolferId(golferId: string | undefined): { character: string; archetype: string } {
  const parts = (golferId ?? '').split('-');
  if (parts.length < 2) return { character: parts[0] || 'unknown', archetype: 'unknown' };
  return { character: parts.slice(0, -1).join('-'), archetype: parts[parts.length - 1] };
}

export function avgByArchetype(rounds: RoundRecord[]): TypeAvg[] {
  return avgByKey(rounds, (r) => splitGolferId(r.golferId).archetype);
}

export function avgByCharacter(rounds: RoundRecord[]): TypeAvg[] {
  return avgByKey(rounds, (r) => splitGolferId(r.golferId).character);
}

function avgByKey(rounds: RoundRecord[], key: (r: RoundRecord) => string): TypeAvg[] {
  const acc = new Map<string, { n: number; total: number; toPar: number }>();
  for (const r of rounds) {
    const k = key(r);
    const a = acc.get(k) ?? { n: 0, total: 0, toPar: 0 };
    a.n++;
    a.total += r.total;
    a.toPar += r.toPar;
    acc.set(k, a);
  }
  return [...acc.entries()]
    .map(([type, a]) => ({
      type,
      n: a.n,
      avgTotal: round1(a.total / a.n),
      avgToPar: round2(a.toPar / a.n)
    }))
    .sort((x, y) => y.n - x.n);
}

/** Overall + per-course putt averages, over rounds that carry putt data only. */
export function avgPutts(rounds: RoundRecord[]): { overall: PuttAvg; byCourse: PuttAvg[]; tracked: number; totalRounds: number } {
  const withPutts = rounds.filter((r) => typeof r.putts === 'number');
  const per = new Map<string, { n: number; sum: number }>();
  let sum = 0;
  for (const r of withPutts) {
    sum += r.putts as number;
    const a = per.get(r.course) ?? { n: 0, sum: 0 };
    a.n++;
    a.sum += r.putts as number;
    per.set(r.course, a);
  }
  return {
    overall: {
      course: 'All courses',
      n: withPutts.length,
      avgPutts: withPutts.length ? round2(sum / withPutts.length) : 0
    },
    byCourse: [...per.entries()]
      .map(([course, a]) => ({ course, n: a.n, avgPutts: round2(a.sum / a.n) }))
      .sort((x, y) => y.n - x.n),
    tracked: withPutts.length,
    totalRounds: rounds.length
  };
}

/** Guest-play summary from the shared rounds: total guest rounds and the
 *  number of distinct guest devices (stable `g-…` ids). Kept SEPARATE from
 *  accounts — guests are counted, never shown as an account (Constitution
 *  rule 18). Works off `/rounds` directly, so it needs no analytics rules. */
export interface GuestSummary {
  rounds: number;
  devices: number;
  avgTotal: number | null;
  lastPlayed: number | null;
}
export function guestSummary(rounds: RoundRecord[]): GuestSummary {
  const devices = new Set<string>();
  let n = 0;
  let total = 0;
  let lastPlayed = -Infinity;
  for (const r of rounds) {
    if (!r.guest) continue;
    n++;
    total += r.total;
    if (r.uid) devices.add(r.uid);
    if (r.d > lastPlayed) lastPlayed = r.d;
  }
  return {
    rounds: n,
    devices: devices.size,
    avgTotal: n ? round1(total / n) : null,
    lastPlayed: n ? lastPlayed : null
  };
}

/** Rounds played per signed-in account, newest-played first. GUEST rounds are
 *  excluded here (they're summarized by guestSummary). Rounds saved before
 *  account tracking shipped (or somehow missing a uid) are grouped under
 *  'untracked' rather than dropped, so the account round count stays honest. */
export function roundsByAccount(rounds: RoundRecord[]): { tracked: AccountRounds[]; untracked: number } {
  const acc = new Map<
    string,
    { n: number; name: string; lastPlayed: number; total: number; toPar: number; xp: number }
  >();
  let untracked = 0;
  for (const r of rounds) {
    if (r.guest) continue; // counted by guestSummary, never as an account
    if (!r.uid) {
      untracked++;
      continue;
    }
    const a = acc.get(r.uid) ?? { n: 0, name: r.names, lastPlayed: -Infinity, total: 0, toPar: 0, xp: 0 };
    a.n++;
    a.total += r.total;
    a.toPar += r.toPar;
    // XP is grow-only, so the largest value seen is the account's latest total.
    if (typeof r.xp === 'number') a.xp = Math.max(a.xp, r.xp);
    if (r.d >= a.lastPlayed) {
      a.lastPlayed = r.d;
      a.name = r.names; // keep the most recent round's display name
    }
    acc.set(r.uid, a);
  }
  return {
    tracked: [...acc.entries()]
      .map(([uid, a]) => ({
        uid,
        name: a.name,
        n: a.n,
        lastPlayed: a.lastPlayed,
        avgTotal: round1(a.total / a.n),
        avgToPar: round2(a.toPar / a.n),
        xp: a.xp
      }))
      .sort((x, y) => y.n - x.n),
    untracked
  };
}
