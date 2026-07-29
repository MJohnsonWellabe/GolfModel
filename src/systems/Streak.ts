/**
 * Gentle seven-day streak (retention plan, Part 4). Pure date math + reward
 * schedule; no DOM, no timers, no countdowns.
 *
 * Principles:
 *  - the streak advances when the player COMPLETES THAT DAY'S DAILY CHALLENGE
 *    — never for merely opening the app, and (since this pass) never for
 *    playing an ordinary round either. It briefly counted any completed round,
 *    on the theory that a brutal challenge day would otherwise wipe a long
 *    streak; the owner's report is that this made it meaningless ("yesterday's
 *    daily was chip in from off the green, I didn't do it and now I still have
 *    a 12 day streak"). The protection token below is the right answer to the
 *    brutal-challenge day, and it already exists;
 *  - the streak is EVALUATED AGAINST TODAY on every read (`currentStreak`), not
 *    only when a round ends — otherwise a player who stops playing keeps their
 *    number forever;
 *  - the DAY REWARD is granted when the Daily Challenge is completed that day
 *    (claimable exactly once per day — idempotent by date key);
 *  - one streak-protection token per seven-day cycle: missing a SINGLE day
 *    consumes it automatically and the streak continues (no purchase, no
 *    permanent loss of months of progress — a 2+ day gap restarts at 1 but
 *    `best` is never lost);
 *  - rewards use existing currencies only (coins/XP; day 7 additionally
 *    surfaces a badge via the achievements system, handled by the caller).
 */

export interface StreakState {
  v: 1;
  /** Consecutive days with a completed round. */
  current: number;
  /** Best streak ever (never resets). */
  best: number;
  /** YYYY-MM-DD of the last day counted. */
  lastDate: string;
  /** Whether this 7-day cycle's protection token is still available. */
  protectionAvailable: boolean;
  /** YYYY-MM-DD the protection last fired (informational, for the UI). */
  protectionUsedOn: string;
  /** Date keys (YYYY-MM-DD) whose day-reward has been claimed. Bounded: only
   *  the most recent few are kept (idempotency window). */
  claimedDays: string[];
}

export function emptyStreak(): StreakState {
  return {
    v: 1,
    current: 0,
    best: 0,
    lastDate: '',
    protectionAvailable: true,
    protectionUsedOn: '',
    claimedDays: []
  };
}

/** Coerce any stored/synced shape to a safe StreakState. */
export function migrateStreak(raw: unknown): StreakState {
  const base = emptyStreak();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Partial<StreakState>;
  return {
    v: 1,
    current: typeof s.current === 'number' && s.current >= 0 ? Math.floor(s.current) : 0,
    best: typeof s.best === 'number' && s.best >= 0 ? Math.floor(s.best) : 0,
    lastDate: typeof s.lastDate === 'string' ? s.lastDate : '',
    protectionAvailable: s.protectionAvailable !== false,
    protectionUsedOn: typeof s.protectionUsedOn === 'string' ? s.protectionUsedOn : '',
    claimedDays: Array.isArray(s.claimedDays) ? s.claimedDays.filter((d) => typeof d === 'string') : []
  };
}

/** Grow-only-ish merge for cross-device sync: later lastDate wins the temporal
 *  fields; best/claims union. */
export function mergeStreak(a: StreakState, b: StreakState): StreakState {
  const newer = a.lastDate >= b.lastDate ? a : b;
  return {
    v: 1,
    current: a.lastDate === b.lastDate ? Math.max(a.current, b.current) : newer.current,
    best: Math.max(a.best, b.best),
    lastDate: newer.lastDate,
    protectionAvailable: newer.protectionAvailable,
    protectionUsedOn: newer.protectionUsedOn,
    claimedDays: [...new Set([...a.claimedDays, ...b.claimedDays])].sort().slice(-14)
  };
}

/** Local-calendar previous day (DST-safe — mirrors ProgressionEngine.prevDay). */
function prevDay(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export interface StreakAdvance {
  state: StreakState;
  /** True when this call moved the streak to a new day. */
  advanced: boolean;
  /** True when the missed-one-day protection token was consumed. */
  usedProtection: boolean;
  /** True when the streak reset to 1 (gap too large / first ever). */
  restarted: boolean;
}

/**
 * Advance the streak for a completed round on `dateKey`. Idempotent within a
 * day. Missing exactly one day consumes the cycle's protection token instead
 * of resetting; entering day 1 of a new 7-day cycle re-arms the token.
 */
export function advanceStreak(prev: StreakState, dateKey: string): StreakAdvance {
  const s: StreakState = { ...prev, claimedDays: [...prev.claimedDays] };
  if (!dateKey || s.lastDate === dateKey) {
    return { state: s, advanced: false, usedProtection: false, restarted: false };
  }
  let usedProtection = false;
  let restarted = false;
  if (s.lastDate === prevDay(dateKey)) {
    s.current += 1;
  } else if (s.lastDate !== '' && s.lastDate === prevDay(prevDay(dateKey)) && s.protectionAvailable && s.current > 0) {
    // Missed exactly one day — the protection token bridges the gap.
    s.current += 1;
    s.protectionAvailable = false;
    s.protectionUsedOn = prevDay(dateKey);
    usedProtection = true;
  } else {
    s.current = 1;
    restarted = true;
  }
  s.lastDate = dateKey;
  s.best = Math.max(s.best, s.current);
  // A new 7-day cycle re-arms the protection token (one per cycle).
  if (cycleDay(s.current) === 1 && !usedProtection) {
    s.protectionAvailable = true;
    s.protectionUsedOn = '';
  }
  return { state: s, advanced: true, usedProtection, restarted };
}

/**
 * THE STREAK AS OF `todayKey` — what every readout must show.
 *
 * `advanceStreak` is the only thing that ever moved `current`, and it runs at
 * ROUND END. So a player who simply stopped playing kept their number forever:
 * the menus went on rendering a 12-day streak weeks after the last round,
 * because nothing had happened to re-evaluate it (owner: "Daily streaks don't
 * stop ... I didn't do it and now I still have a 12 day streak"). There was no
 * expiry, only a gap check that a future round might one day perform.
 *
 * A streak is a statement about TODAY, so it is computed against today rather
 * than stored. Alive when the last counted day is today or yesterday; alive one
 * day further back when the protection token is still held, since that is
 * exactly the gap the token exists to bridge and `advanceStreak` would spend it
 * on the next round; dead after that.
 *
 * Pure and cheap — safe to call on every render. It does NOT mutate: the stored
 * state is left alone so the next `advanceStreak` still sees the real history
 * (and can still spend the token), and `best` is never touched by any of this.
 */
export function currentStreak(s: StreakState, todayKey: string): number {
  if (s.current <= 0 || !s.lastDate || !todayKey) return Math.max(0, s.current);
  // A clock behind the last recorded day (travel, a device with the wrong
  // date) must never silently delete a streak.
  if (s.lastDate >= todayKey) return s.current;
  if (s.lastDate === prevDay(todayKey)) return s.current;
  if (s.protectionAvailable && s.lastDate === prevDay(prevDay(todayKey))) return s.current;
  return 0;
}

/** 1..7 position inside the repeating weekly cycle for a streak count ≥ 1. */
export function cycleDay(current: number): number {
  if (current <= 0) return 0;
  return ((current - 1) % 7) + 1;
}

export interface StreakReward {
  coins: number;
  xp: number;
  /** Day-7 marker: the caller may additionally surface a badge/cosmetic. */
  milestone: boolean;
  label: string;
}

/** The reward for completing the Daily Challenge on cycle day 1..7 (Part 4's
 *  suggested rhythm, using existing currencies only). */
export function streakRewardFor(day: number): StreakReward {
  switch (cycleDay(day)) {
    case 1: return { coins: 25, xp: 0, milestone: false, label: 'Day 1 · 25 coins' };
    case 2: return { coins: 30, xp: 0, milestone: false, label: 'Day 2 · 30 coins' };
    case 3: return { coins: 0, xp: 60, milestone: false, label: 'Day 3 · 60 XP' };
    case 4: return { coins: 25, xp: 40, milestone: false, label: 'Day 4 · 25 coins + 40 XP' };
    case 5: return { coins: 45, xp: 0, milestone: false, label: 'Day 5 · 45 coins' };
    case 6: return { coins: 0, xp: 110, milestone: false, label: 'Day 6 · 110 XP' };
    case 7: return { coins: 100, xp: 50, milestone: true, label: 'Day 7 · 100 coins + 50 XP' };
    default: return { coins: 0, xp: 0, milestone: false, label: '' };
  }
}

export interface StreakClaim {
  state: StreakState;
  /** The reward granted, or null when this day was already claimed. */
  reward: StreakReward | null;
}

/**
 * Claim the day's streak reward (fires when the Daily Challenge completes).
 * Claimable exactly once per date key — refresh, cross-device sync and
 * offline reconciliation can never double-pay (claimedDays unions on merge).
 */
export function claimStreakReward(prev: StreakState, dateKey: string): StreakClaim {
  const s: StreakState = { ...prev, claimedDays: [...prev.claimedDays] };
  if (!dateKey || s.current <= 0 || s.lastDate !== dateKey || s.claimedDays.includes(dateKey)) {
    return { state: s, reward: null };
  }
  s.claimedDays = [...s.claimedDays, dateKey].sort().slice(-14);
  return { state: s, reward: streakRewardFor(s.current) };
}
