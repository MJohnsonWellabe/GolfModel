import { describe, expect, it } from 'vitest';
import { RoundRecord } from '../src/firebase/History';
import {
  avgByArchetype,
  avgByCharacter,
  avgByCourse,
  avgByHole,
  avgPutts,
  avgPuttsByHole,
  guestSummary,
  overallAvg,
  roundsByAccount,
  splitGolferId
} from '../src/admin/aggregate';

const round = (over: Partial<RoundRecord>): RoundRecord => ({
  id: Math.random().toString(36).slice(2),
  d: 1000,
  course: 'Sable Bay',
  mode: 'solo',
  names: 'Matt',
  golferId: 'chip-bigHitter',
  total: 12,
  toPar: 0,
  holes: [4, 4, 4],
  ...over
});

const sample: RoundRecord[] = [
  round({ course: 'Sable Bay', total: 12, toPar: 0, holes: [4, 4, 4], putts: 6, hputts: [2, 2, 2] }),
  round({ course: 'Sable Bay', total: 10, toPar: -2, holes: [3, 4, 3], putts: 4, hputts: [1, 2, 1] }),
  round({ course: 'Timberline', total: 14, toPar: 2, holes: [5, 5, 4], golferId: 'rose-puttKing' }),
  round({ course: 'Timberline', total: 12, toPar: 0, holes: [4, 4, 4], golferId: 'rose-puttKing', putts: 5 })
];

describe('avgByCourse', () => {
  it('averages totals and toPar per course with counts', () => {
    const rows = avgByCourse(sample);
    const sable = rows.find((r) => r.course === 'Sable Bay')!;
    expect(sable.n).toBe(2);
    expect(sable.avgTotal).toBe(11);
    expect(sable.avgToPar).toBe(-1);
    const timber = rows.find((r) => r.course === 'Timberline')!;
    expect(timber.avgTotal).toBe(13);
    expect(timber.avgToPar).toBe(1);
  });
});

describe('avgByHole', () => {
  it('averages per hole slot per course', () => {
    const per = avgByHole(sample).get('Sable Bay')!;
    expect(per.map((h) => h.hole)).toEqual([1, 2, 3]);
    expect(per[0].avg).toBe(3.5);
    expect(per[1].avg).toBe(4);
    expect(per[0].n).toBe(2);
  });

  it('tolerates rounds with missing holes arrays', () => {
    const broken = [round({ holes: undefined as unknown as number[] })];
    expect(avgByHole(broken).size).toBe(0);
  });
});

describe('avgPuttsByHole', () => {
  it('averages putts per hole slot per course, over rounds carrying hputts', () => {
    const per = avgPuttsByHole(sample).get('Sable Bay')!;
    expect(per.map((h) => h.hole)).toEqual([1, 2, 3]);
    expect(per[0].avg).toBe(1.5); // (2+1)/2
    expect(per[0].n).toBe(2);
  });

  it('rounds with no hputts contribute nothing (Timberline: only 1 of 2 rounds has putts, neither has hputts)', () => {
    expect(avgPuttsByHole(sample).has('Timberline')).toBe(false);
  });
});

describe('golfer type split', () => {
  it('splits golferId into character and archetype', () => {
    expect(splitGolferId('chip-bigHitter')).toEqual({ character: 'chip', archetype: 'bigHitter' });
    expect(splitGolferId(undefined).archetype).toBe('unknown');
  });

  it('aggregates by archetype and character', () => {
    const arch = avgByArchetype(sample);
    expect(arch.find((a) => a.type === 'bigHitter')!.n).toBe(2);
    expect(arch.find((a) => a.type === 'puttKing')!.n).toBe(2);
    const chars = avgByCharacter(sample);
    expect(chars.find((c) => c.type === 'chip')!.n).toBe(2);
    expect(chars.find((c) => c.type === 'rose')!.avgTotal).toBe(13);
  });
});

describe('avgPutts', () => {
  it('only counts rounds carrying putt data and reports both counts', () => {
    const p = avgPutts(sample);
    expect(p.tracked).toBe(3);
    expect(p.totalRounds).toBe(4);
    expect(p.overall.avgPutts).toBe(5); // (6+4+5)/3
    expect(p.byCourse.find((c) => c.course === 'Sable Bay')!.avgPutts).toBe(5);
    expect(p.byCourse.find((c) => c.course === 'Timberline')!.n).toBe(1);
  });

  it('handles zero tracked rounds without dividing by zero', () => {
    const p = avgPutts([round({})]);
    expect(p.tracked).toBe(0);
    expect(p.overall.avgPutts).toBe(0);
  });
});

describe('overallAvg', () => {
  it('averages total and toPar across every round with the count', () => {
    const o = overallAvg(sample); // totals 12,10,14,12 ; toPar 0,-2,2,0
    expect(o.rounds).toBe(4);
    expect(o.avgTotal).toBe(12); // 48/4
    expect(o.avgToPar).toBe(0); // 0/4
  });

  it('does not divide by zero on an empty set', () => {
    expect(overallAvg([])).toEqual({ rounds: 0, avgTotal: 0, avgToPar: 0 });
  });
});

describe('roundsByAccount', () => {
  it('counts rounds per uid and keeps the most recent display name', () => {
    const rounds = [
      round({ uid: 'uid-1', names: 'Matt', d: 1000 }),
      round({ uid: 'uid-1', names: 'MattJ', d: 2000 }), // renamed later — latest wins
      round({ uid: 'uid-2', names: 'Sam', d: 1500 }),
      round({ uid: undefined, names: 'Guest' }) // pre-tracking round
    ];
    const r = roundsByAccount(rounds);
    expect(r.untracked).toBe(1);
    expect(r.tracked).toHaveLength(2);
    const uid1 = r.tracked.find((a) => a.uid === 'uid-1')!;
    expect(uid1.n).toBe(2);
    expect(uid1.name).toBe('MattJ');
    expect(uid1.lastPlayed).toBe(2000);
    expect(r.tracked.find((a) => a.uid === 'uid-2')!.n).toBe(1);
  });

  it('reports per-account avg score, avg to-par, and grow-only xp', () => {
    const rounds = [
      round({ uid: 'u', total: 12, toPar: 0, xp: 300, d: 1000 }),
      round({ uid: 'u', total: 10, toPar: -2, xp: 500, d: 2000 }), // later, higher xp
      round({ uid: 'u', total: 14, toPar: 2, d: 1500 }) // legacy round, no xp
    ];
    const a = roundsByAccount(rounds).tracked.find((x) => x.uid === 'u')!;
    expect(a.n).toBe(3);
    expect(a.avgTotal).toBe(12); // (12+10+14)/3
    expect(a.avgToPar).toBe(0); // (0-2+2)/3
    expect(a.xp).toBe(500); // max of the xp-bearing rounds
  });

  it('xp is 0 when no round carries the xp field (legacy-only account)', () => {
    const a = roundsByAccount([round({ uid: 'legacy' })]).tracked[0];
    expect(a.xp).toBe(0);
  });

  it('sorts by round count, most active first', () => {
    const rounds = [
      round({ uid: 'a', d: 1 }),
      round({ uid: 'b', d: 1 }),
      round({ uid: 'b', d: 2 }),
      round({ uid: 'b', d: 3 })
    ];
    const r = roundsByAccount(rounds);
    expect(r.tracked.map((a) => a.uid)).toEqual(['b', 'a']);
  });
});

describe('guest play', () => {
  it('summarizes guest rounds by device and keeps them out of the account table', () => {
    const rounds = [
      round({ uid: 'u-acct', total: 12 }),
      round({ uid: 'g-dev1', guest: true, total: 14, d: 10 }),
      round({ uid: 'g-dev1', guest: true, total: 16, d: 20 }),
      round({ uid: 'g-dev2', guest: true, total: 18, d: 30 })
    ];
    const g = guestSummary(rounds);
    expect(g.rounds).toBe(3);
    expect(g.devices).toBe(2);
    expect(g.avgTotal).toBe(16); // (14+16+18)/3
    expect(g.lastPlayed).toBe(30);
    // Guests never appear as accounts.
    const acc = roundsByAccount(rounds);
    expect(acc.tracked.map((a) => a.uid)).toEqual(['u-acct']);
    expect(acc.untracked).toBe(0);
  });

  it('reports zeros when there are no guest rounds', () => {
    const g = guestSummary([round({ uid: 'u' })]);
    expect(g).toEqual({ rounds: 0, devices: 0, avgTotal: null, lastPlayed: null });
  });
});
