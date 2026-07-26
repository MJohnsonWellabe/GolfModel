import { CourseData } from '../core/types';
import { TOUR_RIVALS, TourRival } from '../data/tourRivals';
import { simulateEntrantRound } from './AiTournament';

/**
 * THE TOUR SEASON — the career Pro's competitive spine (owner, career round
 * 2): sixteen individual events against the same ten named rivals, a
 * PGA-style season-long points leaderboard, and four MAJORS — three-round
 * tournaments at one course — at events 4/8/12/16. The finale major ends the
 * season: a champion is crowned, the purse pays, and the schedule rolls over.
 *
 * Own-pace by design (owner Q&A): events are played whenever the player
 * likes, in order. The schedule is deterministic from the season seed, and
 * every rival round is seeded from (season, event, round, rival) — so the
 * field's story is fixed the moment the season starts, on every device.
 *
 * Pure data + math over the profile's `tour` state. No DOM, no persistence,
 * no Math.random — main.ts supplies seeds and courses; tests drive the whole
 * season headlessly.
 */

export const TOUR_EVENTS = 16;
/** 0-based indices of the majors: events 4, 8, 12, and the finale 16. */
export const TOUR_MAJOR_IDXS = [3, 7, 11, 15] as const;
export const MAJOR_ROUNDS = 3;
export const MAJOR_NAMES = [
  'The Spring Invitational',
  'The Summer Open',
  'The Autumn Classic',
  'The Grand Championship'
] as const;

/** PGA-style points for the top 11 finishers (you + all ten rivals — every
 *  entrant scores, but last place earns less than a fifth of a win). Majors
 *  pay DOUBLE. Ties share the higher points, competition style. */
export const TOUR_POINTS = [500, 300, 190, 135, 110, 90, 75, 60, 50, 40, 30] as const;

/** Season-end purse by final points rank: coins (the spend currency) and a
 *  CP bonus (the growth currency) — winning the season should visibly grow
 *  the Pro who won it. */
export const TOUR_PURSE_COINS = [400, 250, 150, 100, 100, 100] as const;
export const TOUR_FIELD_PURSE_COINS = 60;
export const TOUR_PURSE_CP = [30, 20, 12] as const;
export const TOUR_FIELD_PURSE_CP = 6;

export interface TourEventDef {
  /** 0-based schedule position. */
  idx: number;
  courseId: string;
  major: boolean;
  /** Rounds this event takes: 1, or MAJOR_ROUNDS for a major. */
  rounds: number;
  /** The major's name, when it is one. */
  majorName?: string;
}

/** A part-played event (a major between rounds, or any event mid-finalize):
 *  the player's and the field's per-round scores so far. Persisted on the
 *  PROFILE so a major survives closing the game — whole-round granularity:
 *  abandoning mid-round forfeits that round's progress, never the event. */
export interface TourActiveEvent {
  idx: number;
  playerTotals: number[];
  playerToPars: number[];
  /** Parallel to TOUR_RIVALS: each rival's per-round totals/toPars. */
  fieldTotals: number[][];
  fieldToPars: number[][];
}

export interface TourSeasonState {
  seasonNo: number;
  seed: number;
  /** Events completed. The next event is always schedule[played]. */
  played: number;
  /** Season points by entrant: 'player', or a rival id. */
  points: Record<string, number>;
  /** One line per finished event — the season's story, shown in the hub's
   *  schedule ("E3 · Timberline Open — 2nd, +300 pts"). */
  results: TourEventResult[];
  activeEvent: TourActiveEvent | null;
}

/** How a finished event went for the player, plus who took it. */
export interface TourEventResult {
  idx: number;
  playerRank: number;
  /** Points the player banked (majors already doubled). */
  points: number;
  /** The player's event to-par (cumulative across a major's rounds). */
  toPar: number;
  winnerId: string;
}

export interface TourStandingRow {
  id: string;
  name: string;
  isPlayer: boolean;
  /** Event standings: cumulative strokes/toPar. Season standings: points. */
  total: number;
  toPar: number;
}

export function newSeason(seed: number, seasonNo = 1): TourSeasonState {
  return { seasonNo, seed, played: 0, points: {}, results: [], activeEvent: null };
}

/**
 * The season's 16 stops, deterministic from the seed: the course rotation
 * (caller passes the canonical Play Next order, availability-filtered)
 * entered at a seed-chosen offset and walked stop by stop — majors take the
 * course the rotation hands them, so every season tours the whole roster.
 */
export function tourSchedule(seed: number, courseIds: readonly string[]): TourEventDef[] {
  const n = Math.max(1, courseIds.length);
  const offset = Math.abs(seed) % n;
  const events: TourEventDef[] = [];
  for (let i = 0; i < TOUR_EVENTS; i++) {
    const majorNo = TOUR_MAJOR_IDXS.indexOf(i as (typeof TOUR_MAJOR_IDXS)[number]);
    events.push({
      idx: i,
      courseId: courseIds[(offset + i) % n],
      major: majorNo >= 0,
      rounds: majorNo >= 0 ? MAJOR_ROUNDS : 1,
      ...(majorNo >= 0 ? { majorName: MAJOR_NAMES[majorNo] } : {})
    });
  }
  return events;
}

export function seasonDone(s: TourSeasonState): boolean {
  return s.played >= TOUR_EVENTS;
}

/** The event up next (or mid-play), null once the season is complete. */
export function currentEvent(s: TourSeasonState, courseIds: readonly string[]): TourEventDef | null {
  if (seasonDone(s)) return null;
  return tourSchedule(s.seed, courseIds)[s.played];
}

/** Rounds already banked toward the current event (majors span three). */
export function eventRoundsPlayed(s: TourSeasonState): number {
  return s.activeEvent && s.activeEvent.idx === s.played ? s.activeEvent.playerTotals.length : 0;
}

export interface TourRoundOutcome {
  /** True when this round finished the event (points were just awarded). */
  eventDone: boolean;
  /** Cumulative event standings after this round. */
  standings: TourStandingRow[];
  /** Set when eventDone: the player's finish and everyone's points. */
  playerRank?: number;
  pointsAwarded?: Record<string, number>;
  /** Set when eventDone on the finale: the season just ended. */
  seasonEnded?: boolean;
}

/**
 * Fold the player's just-finished round into the current event and field the
 * rivals' rounds for the same course — same simulator, same calibrated form
 * shift as the AI tournament. On the event's last round: competition-ranked
 * points (majors ×2, ties share the higher points), the schedule advances,
 * and on event 16 the season flags itself ended for the caller to close out.
 */
export function completeTourRound(
  s: TourSeasonState,
  courses: Record<string, CourseData>,
  playerTotal: number,
  playerToPar: number,
  courseIds: readonly string[],
  rivals: readonly TourRival[] = TOUR_RIVALS
): TourRoundOutcome | null {
  const def = currentEvent(s, courseIds);
  const course = def ? courses[def.courseId] : undefined;
  if (!def || !course) return null;
  if (!s.activeEvent || s.activeEvent.idx !== s.played) {
    s.activeEvent = {
      idx: s.played,
      playerTotals: [],
      playerToPars: [],
      fieldTotals: rivals.map(() => []),
      fieldToPars: rivals.map(() => [])
    };
  }
  const ev = s.activeEvent;
  const roundNo = ev.playerTotals.length;
  ev.playerTotals.push(playerTotal);
  ev.playerToPars.push(playerToPar);
  rivals.forEach((r, i) => {
    const res = simulateEntrantRound(
      course,
      r,
      r.difficulty,
      s.seed + def.idx * 15013 + roundNo * 7919 + i * 104729,
      (s.seed ^ 0x9e3779b9) + def.idx * 8191 + roundNo * 6151 + i * 3079
    );
    ev.fieldTotals[i].push(res.total);
    ev.fieldToPars[i].push(res.toPar);
  });
  const standings = eventStandings(ev, rivals);
  if (ev.playerTotals.length < def.rounds) {
    return { eventDone: false, standings };
  }
  // The event is over: competition-ranked points, majors double, ties share
  // the higher points (a two-way tie for 1st pays two 500s — or 1000s).
  const pointsAwarded = pointsForStandings(standings, def.major);
  let playerRank = standings.length;
  for (const row of standings) {
    s.points[row.id] = (s.points[row.id] ?? 0) + (pointsAwarded[row.id] ?? 0);
  }
  const me = standings.findIndex((r) => r.isPlayer);
  if (me >= 0) playerRank = competitionRank(standings, me) + 1;
  s.results.push({
    idx: def.idx,
    playerRank,
    points: pointsAwarded['player'] ?? 0,
    toPar: standings[me >= 0 ? me : 0].toPar,
    winnerId: standings[0].id
  });
  s.played++;
  s.activeEvent = null;
  return { eventDone: true, standings, playerRank, pointsAwarded, seasonEnded: seasonDone(s) };
}

/** Competition rank of row i: the first index carrying the same score —
 *  tied entrants all hold the higher position. */
function competitionRank(standings: readonly TourStandingRow[], i: number): number {
  let rank = i;
  while (rank > 0 && standings[rank - 1].toPar === standings[i].toPar && standings[rank - 1].total === standings[i].total) {
    rank--;
  }
  return rank;
}

/** Points each finisher earns from a final standings order: TOUR_POINTS by
 *  competition rank, doubled at a major, ties sharing the higher points. */
export function pointsForStandings(standings: readonly TourStandingRow[], major: boolean): Record<string, number> {
  const mult = major ? 2 : 1;
  const out: Record<string, number> = {};
  for (let i = 0; i < standings.length; i++) {
    out[standings[i].id] = (TOUR_POINTS[competitionRank(standings, i)] ?? 0) * mult;
  }
  return out;
}

/** Cumulative event standings, lowest to-par first (ties: lower raw total,
 *  then the player — a tied player never reads below an AI with the same
 *  score; same discipline as the AI tournament board). */
export function eventStandings(ev: TourActiveEvent, rivals: readonly TourRival[] = TOUR_RIVALS): TourStandingRow[] {
  const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
  const rows: TourStandingRow[] = [
    { id: 'player', name: 'You', isPlayer: true, total: sum(ev.playerTotals), toPar: sum(ev.playerToPars) },
    ...rivals.map((r, i) => ({
      id: r.id,
      name: r.name,
      isPlayer: false,
      total: sum(ev.fieldTotals[i] ?? []),
      toPar: sum(ev.fieldToPars[i] ?? [])
    }))
  ];
  return rows.sort((a, b) => a.toPar - b.toPar || a.total - b.total || Number(b.isPlayer) - Number(a.isPlayer));
}

/** The season points table, highest first (ties: the player reads first).
 *  `total` carries the points; `toPar` is unused (0) in this view. */
export function seasonStandings(s: TourSeasonState, rivals: readonly TourRival[] = TOUR_RIVALS): TourStandingRow[] {
  const rows: TourStandingRow[] = [
    { id: 'player', name: 'You', isPlayer: true, total: s.points['player'] ?? 0, toPar: 0 },
    ...rivals.map((r) => ({ id: r.id, name: r.name, isPlayer: false, total: s.points[r.id] ?? 0, toPar: 0 }))
  ];
  return rows.sort((a, b) => b.total - a.total || Number(b.isPlayer) - Number(a.isPlayer));
}

export interface SeasonFinish {
  championId: string;
  championName: string;
  playerRank: number;
  coins: number;
  cp: number;
}

/** Close out a finished season: who took it, where the player landed, what
 *  the purse pays. The caller applies the rewards and then rolls over. */
export function finishSeason(s: TourSeasonState, rivals: readonly TourRival[] = TOUR_RIVALS): SeasonFinish {
  const table = seasonStandings(s, rivals);
  const playerRank = table.findIndex((r) => r.isPlayer) + 1;
  return {
    championId: table[0].id,
    championName: table[0].name,
    playerRank,
    coins: TOUR_PURSE_COINS[playerRank - 1] ?? TOUR_FIELD_PURSE_COINS,
    cp: TOUR_PURSE_CP[playerRank - 1] ?? TOUR_FIELD_PURSE_CP
  };
}

/** The next season: number up, fresh seed (a NEW schedule), points cleared.
 *  The rivals persist by construction — they are the data, not the state. */
export function rolloverSeason(s: TourSeasonState, newSeed: number): TourSeasonState {
  return newSeason(newSeed, s.seasonNo + 1);
}

/** Any stored tour shape → a valid state or null (never started). Partial
 *  RTDB copies (dropped empty objects/arrays) coalesce safely. */
export function migrateTour(raw: unknown): TourSeasonState | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<TourSeasonState>;
  if (typeof t.seed !== 'number' || typeof t.seasonNo !== 'number') return null;
  const played = Math.max(0, Math.min(TOUR_EVENTS, Math.round(t.played ?? 0)));
  const points: Record<string, number> = {};
  for (const [k, v] of Object.entries(t.points ?? {})) {
    if (typeof v === 'number' && v >= 0) points[k] = v;
  }
  const results = (Array.isArray(t.results) ? t.results : [])
    .filter(
      (r): r is TourEventResult =>
        !!r && typeof r.idx === 'number' && typeof r.playerRank === 'number' && typeof r.points === 'number'
    )
    .map((r) => ({ idx: r.idx, playerRank: r.playerRank, points: r.points, toPar: r.toPar ?? 0, winnerId: r.winnerId ?? '' }));
  const ae = t.activeEvent;
  const activeEvent: TourActiveEvent | null =
    ae &&
    typeof ae.idx === 'number' &&
    ae.idx === played &&
    Array.isArray(ae.playerTotals) &&
    Array.isArray(ae.playerToPars)
      ? {
          idx: ae.idx,
          playerTotals: [...ae.playerTotals],
          playerToPars: [...ae.playerToPars],
          fieldTotals: TOUR_RIVALS.map((_, i) => [...(ae.fieldTotals?.[i] ?? [])]),
          fieldToPars: TOUR_RIVALS.map((_, i) => [...(ae.fieldToPars?.[i] ?? [])])
        }
      : null;
  return { seasonNo: t.seasonNo, seed: t.seed, played, points, results, activeEvent };
}

/**
 * Cross-device merge: seasons don't interleave — the FURTHER-PROGRESSED copy
 * wins whole (higher seasonNo, then more events played, then more rounds
 * into the current event, then `a` — the caller passes the newer first).
 * Points are per-season so merging tables across different schedules would
 * fabricate a season nobody played.
 */
export function mergeTour(a: TourSeasonState | null, b: TourSeasonState | null): TourSeasonState | null {
  if (!a) return b;
  if (!b) return a;
  if (a.seasonNo !== b.seasonNo) return a.seasonNo > b.seasonNo ? a : b;
  if (a.played !== b.played) return a.played > b.played ? a : b;
  const aRounds = a.activeEvent?.playerTotals.length ?? 0;
  const bRounds = b.activeEvent?.playerTotals.length ?? 0;
  return bRounds > aRounds ? b : a;
}
