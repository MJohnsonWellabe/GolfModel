import { describe, expect, it } from 'vitest';
import { RoundRecord } from '../src/firebase/History';
import {
  avgByArchetype,
  avgByCharacter,
  avgByCourse,
  avgByHole,
  avgPutts,
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
    expect(per[0].avgStrokes).toBe(3.5);
    expect(per[1].avgStrokes).toBe(4);
    expect(per[0].n).toBe(2);
  });

  it('tolerates rounds with missing holes arrays', () => {
    const broken = [round({ holes: undefined as unknown as number[] })];
    expect(avgByHole(broken).size).toBe(0);
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
