import { describe, expect, it } from 'vitest';
import { BOARD_TOP, MIN_ROUNDS_FOR_AVERAGE, recordBoards } from '../src/systems/RecordBoards';
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

  it('freezes a single-moment best to whoever set it, like a course record', () => {
    // The 300yd drive was hit under 'Old Name' — a rename afterward must not
    // repaint that record under the name the player wears today.
    const boards = recordBoards([
      round({ uid: 'a', names: 'Old Name', drive: 300 }),
      round({ uid: 'a', names: 'New Name', drive: 250 })
    ]);
    expect(byId('drive')(boards).entries[0].name).toBe('Old Name');
    expect(byId('drive')(boards).entries[0].value).toBe(300);
  });

  it('shows the running tallies (aces, chip-ins, average) under the CURRENT name', () => {
    // Unlike a single-moment best, these totals are updated by every round
    // played — "as of now" is already honest, so a rename should follow them.
    const boards = recordBoards([
      round({ uid: 'a', names: 'Old Name', holes: [1, 4, 4], chipIns: 1, toPar: 0 }),
      round({ uid: 'a', names: 'New Name', holes: [4, 4, 4], chipIns: 0, toPar: 0 })
    ]);
    expect(byId('aces')(boards).entries[0].name).toBe('New Name');
    expect(byId('chipins')(boards).entries[0].name).toBe('New Name');
  });

  it('picks the running-tally name by actual DATE, not array position', () => {
    // fetchAllRounds() merges a Firebase snapshot with local rounds appended
    // after, so the array order is not reliably chronological. The OLDER
    // round ('Old Name', d: 1) is pushed AFTER the NEWER one ('New Name',
    // d: 2) here — a board that just took "whichever round it saw last"
    // would wrongly land back on 'Old Name'.
    const boards = recordBoards([
      round({ uid: 'a', names: 'New Name', d: 2, holes: [1, 4, 4] }),
      round({ uid: 'a', names: 'Old Name', d: 1, holes: [4, 4, 4] })
    ]);
    expect(byId('aces')(boards).entries[0].name).toBe('New Name');
  });

  it('freezes the lowest round and fewest putts the same way, whichever round came first', () => {
    // The best round and the fewest-putts round land on DIFFERENT rounds here
    // (order swapped from the drive test) — each must freeze independently to
    // its own round's name, not just "whichever round happened to be last".
    const boards = recordBoards([
      round({ uid: 'a', names: 'New Name', toPar: 1, putts: 30 }),
      round({ uid: 'a', names: 'Old Name', toPar: -4, putts: 22 })
    ]);
    expect(byId('best')(boards).entries[0].name).toBe('Old Name');
    expect(byId('putts')(boards).entries[0].name).toBe('Old Name');
  });

  it('says how many rounds an entry rests on', () => {
    const boards = recordBoards([round({ uid: 'a' }), round({ uid: 'a' })]);
    expect(byId('best')(boards).entries[0].rounds).toBe(2);
  });
});

describe('top five, and you (owner pass 5)', () => {
  /** Twelve players with descending drives: p1 hits 312, p2 311, ... p12 301. */
  const field = Array.from({ length: 12 }, (_, i) =>
    round({ uid: `p${i + 1}`, names: `P${i + 1}`, drive: 312 - i })
  );

  it('shows the top five, not a wall of strangers', () => {
    const drive = byId('drive')(recordBoards(field));
    expect(drive.entries).toHaveLength(BOARD_TOP);
    expect(drive.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("appends the viewer's own ranked row when they sit outside the top", () => {
    // "Where am I" is the question that brings a player back to a board — a
    // top-five of other people never answers it.
    const drive = byId('drive')(recordBoards(field, 'p9'));
    expect(drive.entries).toHaveLength(BOARD_TOP + 1);
    const mine = drive.entries[drive.entries.length - 1];
    expect(mine.you).toBe(true);
    expect(mine.name).toBe('P9');
    expect(mine.rank).toBe(9);
    // ...and nobody else is marked as the viewer.
    expect(drive.entries.filter((e) => e.you)).toHaveLength(1);
  });

  it('does not duplicate a viewer who is already in the top five', () => {
    const drive = byId('drive')(recordBoards(field, 'p2'));
    expect(drive.entries).toHaveLength(BOARD_TOP);
    expect(drive.entries[1].you).toBe(true);
  });

  it('a guest viewer (null) marks nobody', () => {
    const drive = byId('drive')(recordBoards(field, null));
    expect(drive.entries.some((e) => e.you)).toBe(false);
  });

  it('ties share the better rank, competition style', () => {
    const boards = recordBoards([
      round({ uid: 'a', names: 'Ace', holes: [1, 4, 4] }),
      round({ uid: 'b', names: 'Bee', holes: [1, 4, 4] }),
      round({ uid: 'b', names: 'Bee', holes: [1, 4, 4] }),
      round({ uid: 'c', names: 'Cee', holes: [1, 4, 4] })
    ]);
    // Bee has 2 aces (rank 1); Ace and Cee have 1 each — BOTH rank 2.
    const ranks = new Map(byId('aces')(boards).entries.map((e) => [e.name, e.rank]));
    expect(ranks.get('Bee')).toBe(1);
    expect(ranks.get('Ace')).toBe(2);
    expect(ranks.get('Cee')).toBe(2);
  });
});
