/**
 * Pure aggregation of the retention analytics `/events` node for the Admin
 * Statistics dashboard. No DOM, no Firebase — unit-testable, mirroring
 * aggregate.ts for round records.
 *
 * Identity model (see src/profile/GuestIdentity.ts):
 *  - every event carries a stable random guest id (`gid`) and, when signed in,
 *    the account uid. An `identity_linked` event marks a guest signing in.
 *  - a player is SIGNED-IN when any of their events carry a uid (or their gid
 *    was ever linked to a uid); otherwise they are a GUEST. A linked gid and
 *    its uid are ONE player (never double-counted), and each round event
 *    exists exactly once regardless of identity, so guest→account conversion
 *    can never double-count rounds.
 */

import { AnalyticsEvent } from '../systems/Analytics';

/** The raw `/events` node: children are events or `{b: [...]}` beacon batches. */
export type RawEventsNode = Record<string, AnalyticsEvent | { b: AnalyticsEvent[] }> | null | undefined;

/** Flatten the RTDB node (unwrapping page-hide beacon batches), time-ordered. */
export function flattenEvents(node: RawEventsNode): AnalyticsEvent[] {
  const out: AnalyticsEvent[] = [];
  for (const v of Object.values(node ?? {})) {
    if (!v || typeof v !== 'object') continue;
    if ('b' in v && Array.isArray((v as { b: AnalyticsEvent[] }).b)) {
      for (const ev of (v as { b: AnalyticsEvent[] }).b) if (ev && typeof ev.e === 'string') out.push(ev);
    } else if (typeof (v as AnalyticsEvent).e === 'string') {
      out.push(v as AnalyticsEvent);
    }
  }
  return out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}

export interface RetentionStats {
  /** Players whose events only ever carried an (unlinked) guest id. */
  guestPlayers: number;
  /** Players with an account uid (a linked gid+uid counts once). */
  signedInPlayers: number;
  /** guestPlayers + signedInPlayers. */
  totalUniquePlayers: number;
  totalSessions: number;
  roundsStarted: number;
  roundsCompleted: number;
  replaySelected: number;
  playNextSelected: number;
  dailyCompleted: number;
  /** Sessions in which at least one daily_completed fired. */
  dailyParticipants: number;
  /** course id → rounds started on it. */
  byCourse: Record<string, number>;
  /** mode → rounds started in it. */
  byMode: Record<string, number>;
  /** % of completed rounds followed by another started round, same session. */
  nextRoundConversion: number | null;
  /** Of those follow-ups, the split. */
  replayConversion: number | null;
  playNextConversion: number | null;
  /** Split of rounds started/completed by identity at event time. */
  guestRoundsCompleted: number;
  signedInRoundsCompleted: number;
  /** D1/D7 return: of players first seen on a day with ≥1/≥7 full days of
   *  observation after it, the % with any event on day+1 / day+7 (UTC day
   *  keys). Null until at least one player is measurable. */
  d1ReturnRate: number | null;
  d7ReturnRate: number | null;
}

/** UTC day key for an epoch-ms timestamp. */
function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const DAY_MS = 86_400_000;

/**
 * D1/D7 return rates (docs/technical/ANALYTICS_FRAMEWORK.md). Players are
 * resolved identities (linked gid→uid counts once). A player only enters a
 * cohort when the observation window fully elapsed before the newest event
 * in the data — otherwise "hasn't returned YET" would read as churn.
 */
export function dayReturnRates(
  events: AnalyticsEvent[],
  resolveId: (ev: AnalyticsEvent) => string
): { d1: number | null; d7: number | null } {
  if (events.length === 0) return { d1: null, d7: null };
  const daysByPlayer = new Map<string, Set<string>>();
  const firstSeen = new Map<string, number>();
  let newest = 0;
  for (const ev of events) {
    const id = resolveId(ev);
    if (!id || !ev.t) continue;
    newest = Math.max(newest, ev.t);
    const days = daysByPlayer.get(id) ?? new Set<string>();
    days.add(dayKey(ev.t));
    daysByPlayer.set(id, days);
    firstSeen.set(id, Math.min(firstSeen.get(id) ?? Infinity, ev.t));
  }
  const rate = (offsetDays: number): number | null => {
    let cohort = 0;
    let returned = 0;
    for (const [id, first] of firstSeen) {
      // Full observation: the target day must have completely elapsed.
      const targetDayStart = first + offsetDays * DAY_MS;
      if (targetDayStart + DAY_MS > newest) continue;
      cohort += 1;
      if (daysByPlayer.get(id)?.has(dayKey(targetDayStart))) returned += 1;
    }
    return cohort > 0 ? Math.round((returned / cohort) * 1000) / 10 : null;
  };
  return { d1: rate(1), d7: rate(7) };
}

export function aggregateRetention(events: AnalyticsEvent[]): RetentionStats {
  // ---- identity resolution --------------------------------------------------
  const linkedGids = new Map<string, string>(); // gid -> uid
  for (const ev of events) {
    if (ev.uid && ev.gid) linkedGids.set(ev.gid, ev.uid);
  }
  const uids = new Set<string>();
  const guestGids = new Set<string>();
  for (const ev of events) {
    if (ev.uid) uids.add(ev.uid);
    else if (ev.gid && !linkedGids.has(ev.gid)) guestGids.add(ev.gid);
  }

  // ---- flat counters --------------------------------------------------------
  const sessions = new Set<string>();
  const byCourse: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  let roundsStarted = 0;
  let roundsCompleted = 0;
  let replaySelected = 0;
  let playNextSelected = 0;
  let dailyCompleted = 0;
  const dailySessions = new Set<string>();
  let guestRoundsCompleted = 0;
  let signedInRoundsCompleted = 0;

  for (const ev of events) {
    if (ev.sid) sessions.add(ev.sid);
    switch (ev.e) {
      case 'round_started': {
        roundsStarted += 1;
        const course = String(ev.p?.course ?? 'unknown');
        const mode = String(ev.p?.mode ?? 'unknown');
        byCourse[course] = (byCourse[course] ?? 0) + 1;
        byMode[mode] = (byMode[mode] ?? 0) + 1;
        break;
      }
      case 'round_completed':
        roundsCompleted += 1;
        if (ev.uid) signedInRoundsCompleted += 1;
        else guestRoundsCompleted += 1;
        break;
      case 'replay_selected':
        replaySelected += 1;
        break;
      case 'play_next_selected':
        playNextSelected += 1;
        break;
      case 'daily_completed':
        dailyCompleted += 1;
        if (ev.sid) dailySessions.add(ev.sid);
        break;
      default:
        break;
    }
  }

  // ---- primary metric: completed → another started, same session ------------
  // Walk each session's events in time order; for every round_completed, look
  // for a later round_started in the SAME session, and classify the follow-up
  // by the selection event (replay/play_next) between the two.
  const bySession = new Map<string, AnalyticsEvent[]>();
  for (const ev of events) {
    if (!ev.sid) continue;
    const list = bySession.get(ev.sid) ?? [];
    list.push(ev);
    bySession.set(ev.sid, list);
  }
  let completions = 0;
  let followedByStart = 0;
  let followedViaReplay = 0;
  let followedViaPlayNext = 0;
  for (const list of bySession.values()) {
    for (let i = 0; i < list.length; i++) {
      if (list[i].e !== 'round_completed') continue;
      completions += 1;
      let via: 'replay' | 'playnext' | null = null;
      for (let j = i + 1; j < list.length; j++) {
        const e = list[j].e;
        if (e === 'replay_selected') via = 'replay';
        else if (e === 'play_next_selected') via = 'playnext';
        else if (e === 'round_completed') break; // next completion window
        else if (e === 'round_started') {
          followedByStart += 1;
          if (via === 'replay') followedViaReplay += 1;
          else if (via === 'playnext') followedViaPlayNext += 1;
          break;
        }
      }
    }
  }
  const pct = (num: number, den: number): number | null =>
    den > 0 ? Math.round((num / den) * 1000) / 10 : null;

  // D1/D7 on resolved identities: a linked gid resolves to its uid.
  const returns = dayReturnRates(events, (ev) =>
    ev.uid ? ev.uid : ev.gid ? (linkedGids.get(ev.gid) ?? ev.gid) : ''
  );

  return {
    guestPlayers: guestGids.size,
    signedInPlayers: uids.size,
    totalUniquePlayers: guestGids.size + uids.size,
    totalSessions: sessions.size,
    roundsStarted,
    roundsCompleted,
    replaySelected,
    playNextSelected,
    dailyCompleted,
    dailyParticipants: dailySessions.size,
    byCourse,
    byMode,
    nextRoundConversion: pct(followedByStart, completions),
    replayConversion: pct(followedViaReplay, completions),
    playNextConversion: pct(followedViaPlayNext, completions),
    guestRoundsCompleted,
    signedInRoundsCompleted,
    d1ReturnRate: returns.d1,
    d7ReturnRate: returns.d7
  };
}
