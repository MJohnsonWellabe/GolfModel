/**
 * The Rival — one named opponent, played against every day.
 *
 * WHY THIS AND NOT ANOTHER COUNTER
 * --------------------------------
 * This game already has streaks, mastery stars, personal records, weekly
 * events, achievements and a season pass. Every one of them is a number that
 * goes up. None of them is a REASON TO COME BACK TOMORROW SPECIFICALLY, because
 * nothing is waiting: the numbers accrue silently whenever you happen to play.
 *
 * What the products that own the daily habit have in common is not a bigger
 * counter. Strava replaced one global leaderboard with millions of tiny ones and
 * found that people are motivated by comparison to someone they could plausibly
 * beat — the size and composition of the reference group matters more than the
 * mechanic. Wordle gave everyone the same puzzle, once a day, and the result was
 * a ritual. Golf Clash's most-used button is the rematch after a loss.
 *
 * A rival is all three at once: the smallest possible leaderboard (two people),
 * a shared daily fixture, and a standing rematch. The scoreboard is not "your
 * best round" — it is "Dana leads 12–9", which is a sentence about a
 * relationship, and it is unfinished by construction.
 *
 * WHY IT IS POSSIBLE HERE
 * -----------------------
 * Because rounds are stored as INPUTS (`RoundRecording`) and the physics is
 * deterministic, an opponent's round can be re-flown exactly as they played it
 * (`GhostRun`). The rival is not a number to beat — they are a ball in the air
 * next to yours, hit the way they actually hit it. That machinery already
 * exists, is verified end to end, and needs no server, no matchmaking and no
 * simultaneous play.
 *
 * TWO KINDS OF RIVAL
 * ------------------
 * - `friend` — a real person's recorded round, arriving in a rival link. Their
 *   ghost is literally them.
 * - `house` — assigned when you have no friend rival, so the feature works on
 *   day one for a player who knows nobody. Their rounds are SYNTHESISED by
 *   driving the game's own AI at a calibrated skill (`RivalRound.ts`), which
 *   makes them a real golfer playing a real round rather than a target number.
 *
 * WHAT THIS MODULE IS
 * -------------------
 * Pure state: who the rival is, the running head-to-head, and the date
 * bookkeeping that makes a day's result count exactly once. No DOM, no storage,
 * no timers, no physics. The round synthesis lives in `RivalRound.ts` and the
 * presentation lives with the game.
 */

/** How a rival's rounds are obtained. */
export type RivalKind = 'friend' | 'house';

export interface RivalDay {
  /** YYYY-MM-DD. */
  date: string;
  you: number;
  them: number;
}

export interface RivalState {
  v: 1;
  /** Stable id. For a friend this is their opaque player id; for a house rival
   *  it is the seed their identity and rounds derive from. */
  id: string;
  name: string;
  kind: RivalKind;
  /** Seed for synthesising a house rival's rounds. Unused for `friend`. */
  seed: number;
  /** Target scoring standard for a house rival, in strokes-to-par per hole.
   *  Negative is better than par. Calibrated against the player. */
  skill: number;
  /** Head-to-head across every settled day. */
  wins: number;
  losses: number;
  ties: number;
  /** The most recent settled days, newest last. Bounded — this is a feeling,
   *  not an archive, and it rides in the profile. */
  history: RivalDay[];
  /** Date key of the last settled day, so a result counts exactly once. */
  lastDate: string;
}

/** How many days of head-to-head detail are kept. Two weeks is enough to show
 *  a form line without turning the profile into a ledger. */
export const RIVAL_HISTORY_DAYS = 14;

export function emptyRival(): RivalState {
  return {
    v: 1,
    id: '',
    name: '',
    kind: 'house',
    seed: 0,
    skill: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    history: [],
    lastDate: ''
  };
}

/** True when a rival has actually been chosen/assigned. */
export function hasRival(s: RivalState): boolean {
  return !!s.id && !!s.name;
}

/** Coerce any stored or synced shape into a safe RivalState. */
export function migrateRival(raw: unknown): RivalState {
  const base = emptyRival();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<RivalState>;
  const num = (v: unknown, min: number, max: number, dflt: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt;
  return {
    v: 1,
    id: typeof r.id === 'string' ? r.id.slice(0, 64) : '',
    name: typeof r.name === 'string' ? r.name.slice(0, 20) : '',
    kind: r.kind === 'friend' ? 'friend' : 'house',
    seed: num(r.seed, 0, 0xffffffff, 0) >>> 0,
    skill: num(r.skill, -3, 6, 0),
    wins: Math.floor(num(r.wins, 0, 1e6, 0)),
    losses: Math.floor(num(r.losses, 0, 1e6, 0)),
    ties: Math.floor(num(r.ties, 0, 1e6, 0)),
    history: Array.isArray(r.history)
      ? r.history
          .filter(
            (d): d is RivalDay =>
              !!d && typeof d.date === 'string' && Number.isFinite(d.you) && Number.isFinite(d.them)
          )
          .map((d) => ({ date: d.date, you: Math.floor(d.you), them: Math.floor(d.them) }))
          .slice(-RIVAL_HISTORY_DAYS)
      : [],
    lastDate: typeof r.lastDate === 'string' ? r.lastDate : ''
  };
}

/** Cross-device merge: the device that has settled more days is authoritative
 *  for the record, and the histories union by date. Deliberately conservative —
 *  double-counting a day would corrupt the one number the feature is about. */
export function mergeRival(a: RivalState, b: RivalState): RivalState {
  if (!hasRival(a)) return b;
  if (!hasRival(b)) return a;
  // A different rival on each device is not mergeable; the more recently
  // active one wins outright rather than blending two relationships.
  if (a.id !== b.id) return a.lastDate >= b.lastDate ? a : b;
  const byDate = new Map<string, RivalDay>();
  for (const d of [...a.history, ...b.history]) byDate.set(d.date, d);
  const history = [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date)).slice(-RIVAL_HISTORY_DAYS);
  const lead = a.wins + a.losses + a.ties >= b.wins + b.losses + b.ties ? a : b;
  return { ...lead, history, lastDate: a.lastDate >= b.lastDate ? a.lastDate : b.lastDate };
}

export interface RivalSettle {
  state: RivalState;
  /** 'win' | 'loss' | 'tie' for THIS day, or null when nothing was settled
   *  (no rival, or the day was already settled). */
  result: 'win' | 'loss' | 'tie' | null;
}

/**
 * Settle one day's head-to-head. Idempotent by date: replaying a day can never
 * pad the record, which is what makes the number worth believing.
 *
 * Lower strokes win — the whole game in one line.
 */
export function settleRivalDay(prev: RivalState, dateKey: string, you: number, them: number): RivalSettle {
  if (!hasRival(prev) || !dateKey || prev.lastDate === dateKey) {
    return { state: prev, result: null };
  }
  if (!Number.isFinite(you) || !Number.isFinite(them) || you <= 0 || them <= 0) {
    return { state: prev, result: null };
  }
  const result = you < them ? 'win' : you > them ? 'loss' : 'tie';
  const s: RivalState = {
    ...prev,
    wins: prev.wins + (result === 'win' ? 1 : 0),
    losses: prev.losses + (result === 'loss' ? 1 : 0),
    ties: prev.ties + (result === 'tie' ? 1 : 0),
    history: [...prev.history, { date: dateKey, you: Math.floor(you), them: Math.floor(them) }].slice(
      -RIVAL_HISTORY_DAYS
    ),
    lastDate: dateKey
  };
  return { state: s, result };
}

/**
 * Keep the rival beatable — in both directions.
 *
 * A fixed standard decays into one of the two failure modes the whole design
 * exists to avoid: beat them five days running and they are furniture; lose five
 * days running and they are a wall. Either way the fixture stops being worth
 * turning up for, which is the only thing this feature sells.
 *
 * So the standard drifts, slowly, against recent form: a run of wins makes them
 * better, a run of losses makes them worse, and anything mixed leaves them
 * alone. Quarter-stroke steps over a three-day window — slow enough that the
 * player never feels the game reaching for the dial, fast enough that a
 * mismatch corrects inside a week.
 *
 * Only house rivals drift. A friend's standard is whatever they actually shoot,
 * and quietly adjusting a real person's score would be a lie.
 */
export const RIVAL_FORM_WINDOW = 3;

export function recalibrateRival(s: RivalState): RivalState {
  if (s.kind !== 'house') return s;
  const recent = s.history.slice(-RIVAL_FORM_WINDOW);
  if (recent.length < RIVAL_FORM_WINDOW) return s;
  const youWon = recent.filter((d) => d.you < d.them).length;
  const theyWon = recent.filter((d) => d.them < d.you).length;
  // A clean sweep either way, and only then. Anything closer is a good rivalry
  // and must not be touched.
  const step = youWon === recent.length ? -0.25 : theyWon === recent.length ? 0.25 : 0;
  if (step === 0) return s;
  const skill = Math.min(2, Math.max(-1, s.skill + step));
  return skill === s.skill ? s : { ...s, skill };
}

export interface RivalStanding {
  /** Positive = you are ahead in the rivalry. */
  lead: number;
  /** Broadcast-style line: "You lead 12–9", "Dana leads 9–12", "All square 4–4". */
  label: string;
  /** Days settled. */
  played: number;
}

export function rivalStanding(s: RivalState): RivalStanding {
  const lead = s.wins - s.losses;
  const played = s.wins + s.losses + s.ties;
  const score = `${s.wins}–${s.losses}${s.ties ? ` (${s.ties})` : ''}`;
  const label =
    played === 0
      ? `First round against ${s.name}`
      : lead > 0
        ? `You lead ${score}`
        : lead < 0
          ? `${s.name} leads ${s.losses}–${s.wins}${s.ties ? ` (${s.ties})` : ''}`
          : `All square ${score}`;
  return { lead, label, played };
}

/**
 * Calibrate a house rival's standard against the player's recent form.
 *
 * The target is DELIBERATELY just out of reach and no further. A rival who wins
 * every day is a wall and a rival who never wins is furniture; the research on
 * competitive reference groups is unambiguous that the motivating comparison is
 * to someone you could plausibly beat, and mid-pack players disengage when the
 * only feedback is a distant elite.
 *
 * So: half a stroke per hole better than the player's recent average, clamped so
 * the rival is never worse than bogey golf and never better than a decent
 * amateur. `recentToPar` is the player's per-hole strokes over par across their
 * recent rounds; an empty history calibrates to level par, which is a fair
 * opening assumption for someone with no record.
 */
export function calibrateRivalSkill(recentToPar: readonly number[]): number {
  if (!recentToPar.length) return 0;
  const usable = recentToPar.filter((v) => Number.isFinite(v)).slice(-10);
  if (!usable.length) return 0;
  const avg = usable.reduce((a, b) => a + b, 0) / usable.length;
  return Math.min(2, Math.max(-1, Math.round((avg - 0.5) * 2) / 2));
}

/**
 * A house rival's name and identity, derived from a seed so the same seed always
 * produces the same person. They are given a surname and a home course so they
 * read as a golfer rather than as a difficulty setting.
 */
const RIVAL_FIRST = [
  'Dana', 'Miles', 'Nora', 'Theo', 'Rae', 'Cass', 'Vic', 'June',
  'Otto', 'Wren', 'Hugo', 'Elle', 'Sol', 'Ida', 'Kit', 'Bo'
];
const RIVAL_LAST = [
  'Vaughn', 'Okafor', 'Ferris', 'Lindqvist', 'Maro', 'Delgado', 'Ashby', 'Nakai',
  'Prowse', 'Ibori', 'Calder', 'Sunder', 'Roche', 'Vance', 'Amari', 'Kestrel'
];

export interface HouseRival {
  id: string;
  name: string;
  seed: number;
  skill: number;
}

/** Build the house rival for a seed and a calibrated standard. */
export function houseRival(seed: number, skill: number): HouseRival {
  const s = seed >>> 0;
  const first = RIVAL_FIRST[s % RIVAL_FIRST.length];
  const last = RIVAL_LAST[Math.floor(s / RIVAL_FIRST.length) % RIVAL_LAST.length];
  return { id: `house-${s}`, name: `${first} ${last}`, seed: s, skill };
}
