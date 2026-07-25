import { describe, expect, it } from 'vitest';
import { MIN_ROUNDS_FOR_AVERAGE, recordBoards } from '../src/systems/RecordBoards';
import type { RoundRecord } from '../src/firebase/History';

/**
 * The record boards.
 *
 * Records showed one thing: the five lowest rounds on a course. That rewards a
 * single hot afternoon and ignores a whole career of numbers the game already
 * tracks — and every one of them was visible only inside your own profile,
 * which makes them a diary rather than a leaderboard.
 *
 * The boards are pure: rounds in, rankings out. That is what makes it possible
 * to assert the things that would otherwise only be found by staring at a live
 * leaderboard and wondering why somebody is on it.
 */
function round(over: Partial<RoundRecord> = {}): RoundRecord {
  return {
    id: Math.random().toString(36).slice(2),
    d: 1,
    course: 'Sable Bay',
    mode: 'solo',
    names: 'Matt',
    golferId: 'chip',
    total: 11,
    toPar: -1,
    holes: [4, 3, 4],
    uid: 'u1',
    ...over
  } as RoundRecord;
}

const byId = (id: string) => (bs: ReturnType<typeof recordBoards>) => bs.find((b) => b.id === id)!;

describe('what the boards rank', () => {
  it('counts an ace from the SCORECARD, which was on the wire all along', () => {
    // Nobody had looked: a hole in one is a 1 in holes[], so this board needed
    // no new field and no new write.
    const boards = recordBoards([
      round({ uid: 'a', names: 'Ace', holes: [1, 4, 4] }),
      round({ uid: 'a', names: 'Ace', holes: [1, 3, 5] }),
      round({ uid: 'b', names: 'Bee', holes: [4, 4, 4] })
    ]);
    const aces = byId('aces')(boards);
    expect(aces.entries[0].name).toBe('Ace');
    expect(aces.entries[0].value).toBe(2);
    // Somebody with none is not on the board at all — a leaderboard of zeroes
    // is a list of people who have not done the thing.
    expect(aces.entries.map((e) => e.name)).not.toContain('Bee');
  });

  it('ranks the longest drive and the most chip-ins from the added fields', () => {
    const boards = recordBoards([
      round({ uid: 'a', names: 'Ace', drive: 280, chipIns: 1 }),
      round({ uid: 'b', names: 'Bee', drive: 331, chipIns: 0 }),
      round({ uid: 'a', names: 'Ace', drive: 260, chipIns: 2 })
    ]);
    expect(byId('drive')(boards).entries[0].name).toBe('Bee');
    expect(byId('drive')(boards).entries[0].label).toBe('331 yd');
    // Chip-ins ACCUMULATE over a career; the drive is a single best.
    expect(byId('chipins')(boards).entries[0].value).toBe(3);
  });

  it('will not rank an average on one lucky round', () => {
    // A board topped by somebody who played once and shot −3 teaches everybody
    // else that the board is meaningless.
    const few = recordBoards([round({ uid: 'a', names: 'Ace', toPar: -3 })]);
    expect(byId('average')(few).entries).toHaveLength(0);

    const many = recordBoards(
      Array.from({ length: MIN_ROUNDS_FOR_AVERAGE }, () => round({ uid: 'a', names: 'Ace', toPar: -3 }))
    );
    expect(byId('average')(many).entries[0].label).toBe('-3.0');
  });

  it('sorts the low boards low and the high boards high', () => {
    const boards = recordBoards([
      round({ uid: 'a', names: 'Ace', toPar: 4, putts: 40 }),
      round({ uid: 'b', names: 'Bee', toPar: -2, putts: 28 })
    ]);
    expect(byId('best')(boards).entries[0].name).toBe('Bee');
    expect(byId('putts')(boards).entries[0].name).toBe('Bee');
  });
});

describe('who is eligible', () => {
  it('never ranks a guest, whose id is a device rather than a person', () => {
    // A guest is a real player and their rounds are COUNTED (constitution rule
    // 18) — but the id is re-rolled, so ranking one would put a stranger on the
    // board every visit.
    const boards = recordBoards([
      round({ uid: 'g-123', names: 'Guest', guest: true, drive: 400 }),
      round({ uid: 'a', names: 'Ace', drive: 200 })
    ]);
    expect(byId('drive')(boards).entries.map((e) => e.name)).toEqual(['Ace']);
  });

  it('shows the name somebody goes by NOW', () => {
    // People rename themselves, and a board showing who they used to be is a
    // small betrayal.
    const boards = recordBoards([
      round({ uid: 'a', names: 'Old Name', drive: 300 }),
      round({ uid: 'a', names: 'New Name', drive: 250 })
    ]);
    expect(byId('drive')(boards).entries[0].name).toBe('New Name');
    expect(byId('drive')(boards).entries[0].value).toBe(300);
  });

  it('says how many rounds an entry rests on', () => {
    const boards = recordBoards([round({ uid: 'a' }), round({ uid: 'a' })]);
    expect(byId('best')(boards).entries[0].rounds).toBe(2);
  });
});
