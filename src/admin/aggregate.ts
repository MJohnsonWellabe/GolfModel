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

export interface HoleAvg {
  hole: number; // 1-based position in the round
  n: number;
  avgStrokes: number;
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

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

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
  const acc = new Map<string, { n: number; sum: number }[]>();
  for (const r of rounds) {
    if (!Array.isArray(r.holes)) continue;
    const per = acc.get(r.course) ?? [];
    r.holes.forEach((strokes, i) => {
      if (typeof strokes !== 'number') return;
      per[i] = per[i] ?? { n: 0, sum: 0 };
      per[i].n++;
      per[i].sum += strokes;
    });
    acc.set(r.course, per);
  }
  const out = new Map<string, HoleAvg[]>();
  for (const [course, per] of acc) {
    out.set(
      course,
      per.map((a, i) => ({ hole: i + 1, n: a?.n ?? 0, avgStrokes: a ? round2(a.sum / a.n) : 0 }))
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
