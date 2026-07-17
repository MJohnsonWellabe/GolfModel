/**
 * Retention analytics — batched, non-blocking, privacy-safe.
 *
 * Design constraints (retention plan, Part 13 + Part 17):
 *  - NOTHING here may run on the swing-meter input path or inside the render
 *    loop. `track()` is an O(1) in-memory enqueue; network flushes happen on a
 *    debounced idle timer and on page-hide (sendBeacon), never synchronously.
 *  - Events carry NO personal identifiers: no emails, no auth tokens, no
 *    names. Identity is the opaque uid (account) and/or the random guest id.
 *  - Offline/unconfigured Firebase degrades to a silent no-op — gameplay and
 *    the round flow never depend on analytics succeeding.
 *
 * Transport: REST POST to the RTDB `/events` node (push semantics — each event
 * becomes a child with a server-assigned key). The node needs a write-only
 * rule for clients and admin-only read (docs/FIREBASE_SETUP.md). Events are
 * sent in batches via a single PATCH of pre-assigned keys to keep one network
 * round-trip per flush.
 *
 * The primary product metric ("% of completed rounds followed by another
 * started round in the same session", split Replay vs Play Next) is derived
 * from these events by the admin dashboard — see src/admin/retentionStats.ts.
 */

import { guestId, sessionId } from '../profile/GuestIdentity';

export interface AnalyticsEvent {
  /** Event name, e.g. 'round_completed'. */
  e: string;
  /** Epoch ms at enqueue time. */
  t: number;
  /** Session id (per page load). */
  sid: string;
  /** Stable guest id (always present — links pre-sign-in activity). */
  gid: string;
  /** Account uid when signed in. */
  uid?: string;
  /** Event properties (course, mode, score_to_par, ...). Flat, small. */
  p?: Record<string, string | number | boolean>;
}

export interface AnalyticsTransport {
  /** Send a batch; resolve true on success (false batches are re-queued once). */
  send(events: AnalyticsEvent[]): Promise<boolean>;
  /** Best-effort page-hide delivery (sendBeacon); fire-and-forget. */
  beacon?(events: AnalyticsEvent[]): void;
}

const FLUSH_DELAY_MS = 4000;
const MAX_QUEUE = 200; // hard cap — drop oldest beyond this, never grow unbounded
const MAX_RETRY_BATCH = 50;

/** Fields that must never appear in event properties (privacy guard). */
const FORBIDDEN_PROP_KEYS = /email|token|auth|password|name/i;

export class Analytics {
  private queue: AnalyticsEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private uid: string | null = null;
  private flushing = false;

  constructor(private transport: AnalyticsTransport | null) {}

  /** Set (or clear) the signed-in account id attached to subsequent events. */
  setUid(uid: string | null): void {
    this.uid = uid;
  }

  /** O(1) enqueue; schedules a debounced idle flush. Never throws. */
  track(event: string, props?: Record<string, string | number | boolean>): void {
    try {
      const p: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(props ?? {})) {
        if (FORBIDDEN_PROP_KEYS.test(k)) continue; // privacy guard
        if (typeof v === 'string' && v.length > 120) continue;
        p[k] = v;
      }
      const ev: AnalyticsEvent = {
        e: event,
        t: Date.now(),
        sid: sessionId(),
        gid: guestId(),
        ...(this.uid ? { uid: this.uid } : {}),
        ...(Object.keys(p).length ? { p } : {})
      };
      this.queue.push(ev);
      if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
      this.scheduleFlush();
    } catch {
      // analytics must never break the game
    }
  }

  private scheduleFlush(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  /** Drain the queue through the transport. Public for page-hide + tests. */
  async flush(): Promise<void> {
    if (this.flushing || !this.transport || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      const ok = await this.transport.send(batch);
      if (!ok) {
        // One retry lifetime: re-queue (bounded) for the next flush.
        this.queue.unshift(...batch.slice(-MAX_RETRY_BATCH));
      }
    } catch {
      this.queue.unshift(...batch.slice(-MAX_RETRY_BATCH));
    } finally {
      this.flushing = false;
    }
  }

  /** Best-effort synchronous drain for pagehide/visibilitychange. */
  flushBeacon(): void {
    if (!this.transport?.beacon || this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      this.transport.beacon(batch);
    } catch {
      // page is going away — nothing else to do
    }
  }

  /** Pending events (tests + diagnostics). */
  get pending(): number {
    return this.queue.length;
  }
}

/** Random push-style key: time-ordered prefix + entropy (RTDB-safe chars). */
function pushKey(t: number): string {
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  return `e${t.toString(36)}-${rand}`;
}

/**
 * RTDB REST transport: one PATCH per batch to `/events.json` with
 * pre-assigned keys. `baseUrl` is LEADERBOARD_URL; empty → null (no-op
 * analytics, e.g. tests/offline builds).
 */
export function restTransport(baseUrl: string): AnalyticsTransport | null {
  if (!baseUrl) return null;
  const url = `${baseUrl.replace(/\/+$/, '')}/events.json`;
  const toBody = (events: AnalyticsEvent[]): string => {
    const patch: Record<string, AnalyticsEvent> = {};
    for (const ev of events) patch[pushKey(ev.t)] = ev;
    return JSON.stringify(patch);
  };
  return {
    async send(events: AnalyticsEvent[]): Promise<boolean> {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(url, { method: 'PATCH', body: toBody(events), signal: controller.signal });
        clearTimeout(timer);
        return res.ok;
      } catch {
        return false;
      }
    },
    beacon(events: AnalyticsEvent[]): void {
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          // RTDB accepts POST (push) bodies via beacon; a PATCH isn't possible
          // with sendBeacon, so page-hide events land as one pushed batch
          // object the aggregator unwraps (key `b` = batch marker).
          navigator.sendBeacon(url, JSON.stringify({ b: events }));
        }
      } catch {
        // best effort only
      }
    }
  };
}
