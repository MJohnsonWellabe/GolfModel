import { describe, expect, it } from 'vitest';
import { bestRounds, isNewRecord, RoundRecord } from '../src/firebase/History';

const round = (over: Partial<RoundRecord>): RoundRecord => ({
  id: Math.random().toString(36).slice(2),
  d: 1000,
  course: 'Amen Corner',
  mode: 'solo',
  names: 'Zac',
  golferId: 'zac',
  total: 12,
  toPar: 0,
  holes: [4, 3, 5],
  ...over
});

describe('bestRounds', () => {
  it('filters by course and mode, sorts by total then date, and caps at n', () => {
    const rounds = [
      round({ id: 'a', total: 11, d: 300 }),
      round({ id: 'b', total: 10, d: 200 }),
      round({ id: 'c', total: 10, d: 100 }), // earlier tie wins
      round({ id: 'd', total: 9, course: 'Legends Links' }), // other course
      round({ id: 'e', total: 8, mode: 'scramble' }), // other mode
      round({ id: 'f', total: 13 })
    ];
    const best = bestRounds(rounds, 'Amen Corner', 'solo', 3);
    expect(best.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('isNewRecord', () => {
  it('the first round on a course+mode is always a record', () => {
    const r = round({ id: 'only' });
    expect(isNewRecord([r], r)).toBe(true);
  });

  it('requires strictly beating every other round', () => {
    const existing = round({ id: 'old', total: 10 });
    const tie = round({ id: 'tie', total: 10 });
    const better = round({ id: 'better', total: 9 });
    expect(isNewRecord([existing, tie], tie)).toBe(false);
    expect(isNewRecord([existing, better], better)).toBe(true);
  });

  it('other courses and modes do not block a record', () => {
    const otherCourse = round({ id: 'x', total: 5, course: 'Legends Links' });
    const mine = round({ id: 'mine', total: 12 });
    expect(isNewRecord([otherCourse, mine], mine)).toBe(true);
  });
});
