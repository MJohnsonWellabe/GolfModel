import { describe, expect, it } from 'vitest';
import { aggregateRetention, flattenEvents, RawEventsNode } from '../src/admin/retentionStats';
import { AnalyticsEvent } from '../src/systems/Analytics';

let t = 1000;
function ev(e: string, over: Partial<AnalyticsEvent> = {}): AnalyticsEvent {
  t += 1000;
  return { e, t, sid: 's-1', gid: 'g-1', ...over };
}

describe('flattenEvents', () => {
  it('unwraps beacon batches and orders by time', () => {
    const node: RawEventsNode = {
      k2: { e: 'round_started', t: 200, sid: 's-1', gid: 'g-1' },
      k1: { b: [{ e: 'app_open', t: 100, sid: 's-1', gid: 'g-1' }] },
      junk: null as never
    };
    const flat = flattenEvents(node);
    expect(flat.map((e) => e.e)).toEqual(['app_open', 'round_started']);
  });

  it('tolerates an empty/absent node', () => {
    expect(flattenEvents(null)).toEqual([]);
    expect(flattenEvents({})).toEqual([]);
  });
});

describe('aggregateRetention — identity', () => {
  it('counts guests and signed-in players separately (never as accounts)', () => {
    const s = aggregateRetention([
      ev('app_open', { gid: 'g-a', sid: 's-a' }),
      ev('round_completed', { gid: 'g-a', sid: 's-a' }),
      ev('app_open', { gid: 'g-b', uid: 'u-1', sid: 's-b' })
    ]);
    expect(s.guestPlayers).toBe(1);
    expect(s.signedInPlayers).toBe(1);
    expect(s.totalUniquePlayers).toBe(2);
  });

  it('a guest who signs in later is ONE player, and rounds are not double-counted', () => {
    const s = aggregateRetention([
      // guest session: one completed round
      ev('round_started', { gid: 'g-a', sid: 's-1' }),
      ev('round_completed', { gid: 'g-a', sid: 's-1' }),
      // signs in — same gid now carries a uid
      ev('identity_linked', { gid: 'g-a', uid: 'u-9', sid: 's-1' }),
      ev('round_started', { gid: 'g-a', uid: 'u-9', sid: 's-1' }),
      ev('round_completed', { gid: 'g-a', uid: 'u-9', sid: 's-1' })
    ]);
    expect(s.guestPlayers).toBe(0); // linked gid is no longer a separate guest
    expect(s.signedInPlayers).toBe(1);
    expect(s.totalUniquePlayers).toBe(1);
    expect(s.roundsCompleted).toBe(2); // one guest round + one account round, once each
    expect(s.guestRoundsCompleted).toBe(1);
    expect(s.signedInRoundsCompleted).toBe(1);
  });

  it('unrelated guests are never merged', () => {
    const s = aggregateRetention([
      ev('app_open', { gid: 'g-a', sid: 's-1' }),
      ev('app_open', { gid: 'g-b', sid: 's-2' })
    ]);
    expect(s.guestPlayers).toBe(2);
    expect(s.totalSessions).toBe(2);
  });
});

describe('aggregateRetention — counters and conversion', () => {
  it('tallies rounds, selections, daily and usage splits', () => {
    const s = aggregateRetention([
      ev('round_started', { p: { course: 'sablebay', mode: 'solo' } }),
      ev('round_completed'),
      ev('replay_selected'),
      ev('round_started', { p: { course: 'sablebay', mode: 'solo' } }),
      ev('round_completed'),
      ev('play_next_selected'),
      ev('round_started', { p: { course: 'wildwood', mode: 'solo' } }),
      ev('daily_completed')
    ]);
    expect(s.roundsStarted).toBe(3);
    expect(s.roundsCompleted).toBe(2);
    expect(s.replaySelected).toBe(1);
    expect(s.playNextSelected).toBe(1);
    expect(s.dailyCompleted).toBe(1);
    expect(s.byCourse).toEqual({ sablebay: 2, wildwood: 1 });
    expect(s.byMode).toEqual({ solo: 3 });
    // both completions were followed by a start in the same session
    expect(s.nextRoundConversion).toBe(100);
    expect(s.replayConversion).toBe(50);
    expect(s.playNextConversion).toBe(50);
  });

  it('a completion with no follow-up start lowers the conversion', () => {
    const s = aggregateRetention([
      ev('round_started'),
      ev('round_completed'),
      ev('replay_selected'),
      ev('round_started'),
      ev('round_completed') // session ends here
    ]);
    expect(s.nextRoundConversion).toBe(50);
    expect(s.replayConversion).toBe(50);
    expect(s.playNextConversion).toBe(0);
  });

  it('follow-ups never leak across sessions', () => {
    const s = aggregateRetention([
      ev('round_completed', { sid: 's-1' }),
      ev('round_started', { sid: 's-2' })
    ]);
    expect(s.nextRoundConversion).toBe(0);
  });

  it('no completions → conversion is null (not NaN/0 noise)', () => {
    const s = aggregateRetention([ev('app_open')]);
    expect(s.nextRoundConversion).toBeNull();
    expect(s.replayConversion).toBeNull();
  });
});
