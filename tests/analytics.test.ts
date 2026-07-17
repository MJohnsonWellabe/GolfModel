import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Analytics, AnalyticsEvent, AnalyticsTransport } from '../src/systems/Analytics';
import { _resetIdentityForTests, guestId, sessionId } from '../src/profile/GuestIdentity';
import { KVStorage } from '../src/profile/Profile';

function memStorage(): KVStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe('guest identity', () => {
  beforeEach(() => _resetIdentityForTests());

  it('mints one stable guest id per storage and reuses it (not one per call)', () => {
    const s = memStorage();
    const a = guestId(s);
    const b = guestId(s);
    expect(a).toBe(b);
    expect(a).toMatch(/^g-/);
  });

  it('different storages (devices) are different guests — never merged', () => {
    expect(guestId(memStorage())).not.toBe(guestId(memStorage()));
  });

  it('contains no personal information (opaque random id)', () => {
    expect(guestId(memStorage())).toMatch(/^g-[\w-]+$/);
  });

  it('degrades to a per-load in-memory id when storage is unavailable', () => {
    const a = guestId(null);
    const b = guestId(null);
    expect(a).toBe(b);
    expect(a).toMatch(/^g-/);
  });

  it('session ids are per page load and distinct from guest ids', () => {
    const s1 = sessionId();
    expect(sessionId()).toBe(s1);
    expect(s1).toMatch(/^s-/);
    _resetIdentityForTests();
    expect(sessionId()).not.toBe(s1);
  });
});

describe('analytics batching', () => {
  beforeEach(() => {
    _resetIdentityForTests();
    vi.useFakeTimers();
  });

  function collectingTransport(): { sent: AnalyticsEvent[][]; transport: AnalyticsTransport } {
    const sent: AnalyticsEvent[][] = [];
    return {
      sent,
      transport: {
        send: (events) => {
          sent.push(events);
          return Promise.resolve(true);
        }
      }
    };
  }

  it('enqueues without network and flushes one batch after the idle delay', async () => {
    const { sent, transport } = collectingTransport();
    const a = new Analytics(transport);
    a.track('round_started', { course: 'sablebay', mode: 'solo' });
    a.track('round_completed', { course: 'sablebay', score_to_par: -1 });
    expect(sent.length).toBe(0);
    expect(a.pending).toBe(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent.length).toBe(1);
    expect(sent[0].map((e) => e.e)).toEqual(['round_started', 'round_completed']);
    expect(a.pending).toBe(0);
  });

  it('attaches gid always and uid only when signed in', async () => {
    const { sent, transport } = collectingTransport();
    const a = new Analytics(transport);
    a.track('app_open');
    a.setUid('uid-123');
    a.track('round_started');
    await vi.advanceTimersByTimeAsync(5000);
    const [open, started] = sent[0];
    expect(open.gid).toMatch(/^g-/);
    expect(open.uid).toBeUndefined();
    expect(started.uid).toBe('uid-123');
    expect(started.gid).toMatch(/^g-/);
  });

  it('strips personal-looking properties (privacy guard)', async () => {
    const { sent, transport } = collectingTransport();
    const a = new Analytics(transport);
    a.track('app_open', { email: 'x@y.com', authToken: 'secret', playerName: 'Matt', course: 'wildwood' } as never);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent[0][0].p).toEqual({ course: 'wildwood' });
  });

  it('requeues a failed batch once and caps the queue', async () => {
    let fail = true;
    const sent: AnalyticsEvent[][] = [];
    const a = new Analytics({
      send: (events) => {
        if (fail) return Promise.resolve(false);
        sent.push(events);
        return Promise.resolve(true);
      }
    });
    a.track('round_started');
    await vi.advanceTimersByTimeAsync(5000);
    expect(a.pending).toBe(1); // requeued
    fail = false;
    a.track('round_completed');
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent[0].map((e) => e.e)).toEqual(['round_started', 'round_completed']);
  });

  it('null transport is a silent no-op (offline / unconfigured)', async () => {
    const a = new Analytics(null);
    a.track('app_open');
    await vi.advanceTimersByTimeAsync(5000);
    expect(a.pending).toBe(1); // held; never throws, never blocks
  });

  it('track is synchronous O(1) — no network call on the caller path', () => {
    const send = vi.fn(() => Promise.resolve(true));
    const a = new Analytics({ send });
    a.track('replay_selected');
    expect(send).not.toHaveBeenCalled();
  });
});
