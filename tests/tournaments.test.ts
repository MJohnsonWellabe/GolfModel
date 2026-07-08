import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/utils/Random';
import {
  isEnded,
  isPlausibleEntry,
  makeTournamentCode,
  Tournament,
  TournamentEntry,
  tournamentStandings,
  tournamentWinner
} from '../src/firebase/Tournaments';

const entry = (over: Partial<TournamentEntry>): TournamentEntry => ({
  playerId: 'p',
  name: 'P',
  golferId: 'g',
  total: 12,
  toPar: 0,
  holes: [4, 3, 5],
  submittedAt: 1000,
  ...over
});

describe('tournament codes', () => {
  it('are JG- prefixed, 6 unambiguous chars, and deterministic under a seed', () => {
    const a = makeTournamentCode(mulberry32(7));
    const b = makeTournamentCode(mulberry32(7));
    expect(a).toBe(b);
    expect(a).toMatch(/^JG-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  });
});

describe('standings & winner', () => {
  it('lowest total wins; ties broken by earliest submission', () => {
    const entries = [
      entry({ playerId: 'a', total: 11, submittedAt: 300 }),
      entry({ playerId: 'b', total: 10, submittedAt: 200 }),
      entry({ playerId: 'c', total: 10, submittedAt: 100 }) // earlier tie wins
    ];
    expect(tournamentWinner(entries)!.playerId).toBe('c');
    expect(tournamentStandings(entries).map((e) => e.playerId)).toEqual(['c', 'b', 'a']);
  });
  it('returns null when there are no entries', () => {
    expect(tournamentWinner([])).toBeNull();
  });
});

describe('end + validation', () => {
  const t: Tournament = {
    code: 'JG-ABCDEF',
    name: 'Test',
    course: 'Wildwood Glen',
    holes: 3,
    createdBy: { id: 'x', name: 'X' },
    createdAt: 0,
    endsAt: 1000,
    seed: 42
  };
  it('isEnded flips at endsAt', () => {
    expect(isEnded(t, 999)).toBe(false);
    expect(isEnded(t, 1000)).toBe(true);
  });
  it('rejects impossible entries (bad length, out of range, mismatched total)', () => {
    expect(isPlausibleEntry(entry({ holes: [4, 3, 5], total: 12 }), 3, 8)).toBe(true);
    expect(isPlausibleEntry(entry({ holes: [4, 3], total: 7 }), 3, 8)).toBe(false); // wrong hole count
    expect(isPlausibleEntry(entry({ holes: [4, 3, 9], total: 16 }), 3, 8)).toBe(false); // over max
    expect(isPlausibleEntry(entry({ holes: [4, 3, 5], total: 99 }), 3, 8)).toBe(false); // total mismatch
  });
});
