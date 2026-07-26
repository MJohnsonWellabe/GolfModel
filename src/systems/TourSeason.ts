import { CourseData } from '../core/types';
import { TOUR_RIVALS, TourRival } from '../data/tourRivals';
import { simulateEntrantRound } from './AiTournament';
import { majorCourseForRound } from './TourMajorSetup';

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
/** Sudden death is capped: still all square after five extra holes and the
 *  player takes the trophy — the punishing outcome (grinding five perfect
 *  holes and then LOSING on a technicality) is never the game's pick. */
export const MAX_PLAYOFF_HOLES = 5;
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
  /** Set when regulation ended with the player tied for the lead: the event
   *  holds un-finalized while sudden death runs (owner pass 8 — "If the user
   *  is involved in a tie, it should go into a playoff hole"). One entry per
   *  playoff hole played; survivors re-derived from the record, so the state
   *  is self-describing across devices and reloads. */
  playoff?: TourPlayoff;
}

export interface TourPlayoff {
  /** The rivals in the tie, leaderboard order at the end of regulation. */
  tiedRivalIds: string[];
  /** Strokes per playoff hole: the player's, and each SURVIVING rival's. */
  holes: Array<{ player: number; rivals: Record<string, number> }>;
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
  /** Set while eventDone is false because SUDDEN DEATH is on: regulation
   *  ended with the player tied for the lead (or a playoff hole re-tied).
   *  The event holds un-finalized until the playoff resolves. */
  playoff?: { tiedRivalIds: string[] };
  /** Set when eventDone via a playoff: who took it ('player' or a rival). */
  playoffWinnerId?: string;
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
  // A major escalates its setup per round (forward tees/kind pins → the
  // authored card → back tees/tucked pins). The FIELD plays the identical
  // materialized course the player just did — majorCourseForRound is pure
  // in (course, roundNo), so both sides agree by construction.
  const playedCourse = def.major ? majorCourseForRound(course, roundNo) : course;
  rivals.forEach((r, i) => {
    const res = simulateEntrantRound(
      playedCourse,
      def.courseId,
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
  // Regulation is over. A player tied for the LEAD goes to sudden death
  // instead of sharing the trophy (owner pass 8): the event holds
  // un-finalized — no points, no result line, the schedule does not advance —
  // until the playoff produces an outright winner. AI–AI ties (player not
  // involved) still share points, competition style: nobody watches a
  // playoff they're not in.
  const tied = leadTiedRivalIds(standings);
  if (tied) {
    ev.playoff = { tiedRivalIds: tied, holes: [] };
    return { eventDone: false, standings, playoff: { tiedRivalIds: tied } };
  }
  return finalizeTourEvent(s, def, standings);
}

/** The rival ids tied with a LEADING player (leaderboard order), or null when
 *  regulation produced an outright result. Ties elsewhere don't playoff. */
function leadTiedRivalIds(standings: readonly TourStandingRow[]): string[] | null {
  const me = standings.findIndex((r) => r.isPlayer);
  if (me < 0 || competitionRank(standings, me) !== 0) return null;
  const top = standings[me];
  const tied = standings
    .filter((r) => !r.isPlayer && r.toPar === top.toPar && r.total === top.total)
    .map((r) => r.id);
  return tied.length > 0 ? tied : null;
}

/** Award points, log the result line, advance the schedule. `playoffWinnerId`
 *  overrides a tied-lead finish: the winner takes 1st alone, the rest of the
 *  playoff group shares 2nd. */
function finalizeTourEvent(
  s: TourSeasonState,
  def: TourEventDef,
  standings: TourStandingRow[],
  playoffWinnerId?: string
): TourRoundOutcome {
  const pointsAwarded = pointsForStandings(standings, def.major, playoffWinnerId);
  let playerRank = standings.length;
  for (const row of standings) {
    s.points[row.id] = (s.points[row.id] ?? 0) + (pointsAwarded[row.id] ?? 0);
  }
  const me = standings.findIndex((r) => r.isPlayer);
  if (me >= 0) playerRank = competitionRank(standings, me) + 1;
  // A playoff decides 1st and 2nd outright, whatever regulation said.
  if (playoffWinnerId && me >= 0 && competitionRank(standings, me) === 0) {
    playerRank = playoffWinnerId === 'player' ? 1 : 2;
  }
  s.results.push({
    idx: def.idx,
    playerRank,
    points: pointsAwarded['player'] ?? 0,
    toPar: standings[me >= 0 ? me : 0].toPar,
    winnerId: playoffWinnerId ?? standings[0].id
  });
  s.played++;
  s.activeEvent = null;
  return {
    eventDone: true,
    standings,
    playerRank,
    pointsAwarded,
    seasonEnded: seasonDone(s),
    ...(playoffWinnerId ? { playoffWinnerId } : {})
  };
}

/**
 * The playoff a season is currently holding on, or null. SELF-HEALING: the
 * pending state is re-derived from the banked rounds (all regulation rounds
 * in, player tied for the lead, no result logged), so a partial cloud copy
 * that dropped the `playoff` field — RTDB prunes empty arrays — re-arms
 * cleanly instead of stranding the event.
 */
export function playoffPending(
  s: TourSeasonState,
  courseIds: readonly string[],
  rivals: readonly TourRival[] = TOUR_RIVALS
): { def: TourEventDef; tiedRivalIds: string[]; holesPlayed: number } | null {
  const def = currentEvent(s, courseIds);
  const ev = s.activeEvent;
  if (!def || !ev || ev.idx !== s.played) return null;
  if (ev.playerTotals.length < def.rounds) return null;
  const tied = leadTiedRivalIds(eventStandings(ev, rivals));
  if (!tied) return null;
  if (!ev.playoff) ev.playoff = { tiedRivalIds: tied, holes: [] };
  return { def, tiedRivalIds: playoffSurvivors(ev.playoff), holesPlayed: ev.playoff.holes.length };
}

/** The rivals still standing after the playoff holes on record: a rival
 *  drops out the first hole it scores worse than the player. (A rival that
 *  scored BETTER ended the playoff — no further holes exist to filter.) */
function playoffSurvivors(po: TourPlayoff): string[] {
  let alive = [...po.tiedRivalIds];
  for (const h of po.holes) {
    alive = alive.filter((id) => (h.rivals[id] ?? Infinity) <= h.player);
  }
  return alive;
}

/**
 * Fold one sudden-death hole into the playoff. `rivalStrokes` carries every
 * SURVIVING rival's strokes on the hole (the caller simulates them raw — no
 * tournament-form shift on a single hole).
 *
 * Resolution, in order: the player alone at the low score wins; any rival
 * strictly below the player wins (the lowest such, leaderboard order on a
 * tie — the AI side of an AI–AI split needs no drama); otherwise the
 * re-tied survivors go again, until the MAX_PLAYOFF_HOLES cap hands the
 * trophy to the player.
 */
export function completeTourPlayoffHole(
  s: TourSeasonState,
  courseIds: readonly string[],
  playerStrokes: number,
  rivalStrokes: Record<string, number>,
  rivals: readonly TourRival[] = TOUR_RIVALS
): TourRoundOutcome | null {
  const pending = playoffPending(s, courseIds, rivals);
  const ev = s.activeEvent;
  if (!pending || !ev?.playoff) return null;
  const def = pending.def;
  const po = ev.playoff;
  po.holes.push({ player: playerStrokes, rivals: { ...rivalStrokes } });
  const standings = eventStandings(ev, rivals);
  const alive = pending.tiedRivalIds.filter((id) => (rivalStrokes[id] ?? Infinity) <= playerStrokes);
  const beatMe = pending.tiedRivalIds.filter((id) => (rivalStrokes[id] ?? Infinity) < playerStrokes);
  if (beatMe.length > 0) {
    const winner = beatMe.sort(
      (x, y) => rivalStrokes[x]! - rivalStrokes[y]! || po.tiedRivalIds.indexOf(x) - po.tiedRivalIds.indexOf(y)
    )[0];
    return finalizeTourEvent(s, def, standings, winner);
  }
  if (alive.length === 0 || po.holes.length >= MAX_PLAYOFF_HOLES) {
    return finalizeTourEvent(s, def, standings, 'player');
  }
  return { eventDone: false, standings, playoff: { tiedRivalIds: alive } };
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
 *  competition rank, doubled at a major, ties sharing the higher points.
 *  A playoff overrides the shared lead: the winner takes 1st's points
 *  alone and the rest of the tied group shares 2nd's. */
export function pointsForStandings(
  standings: readonly TourStandingRow[],
  major: boolean,
  playoffWinnerId?: string
): Record<string, number> {
  const mult = major ? 2 : 1;
  const out: Record<string, number> = {};
  for (let i = 0; i < standings.length; i++) {
    const rank = competitionRank(standings, i);
    const playoffLoser = playoffWinnerId !== undefined && rank === 0 && standings[i].id !== playoffWinnerId;
    out[standings[i].id] = (TOUR_POINTS[playoffLoser ? 1 : rank] ?? 0) * mult;
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

// ----- PER-GOLFER TOUR RECORDS (owner pass 8 follow-up: "past results by
// golfer… career wins, major wins and season placements, for any golfer I've
// used"). The season state itself is DISCARDED at rollover, so this history
// is the only durable record. Keyed by CareerPro id with a name snapshot, so
// a Pro deleted from the stable keeps their page in the record book.

export interface TourProSeasonFinish {
  seasonNo: number;
  /** Final points-table rank (1 = season champion). */
  rank: number;
  /** Season points the Pro finished with. */
  points: number;
}

export interface TourProRecord {
  /** Name snapshot — refreshed on every record, kept after deletion. */
  name: string;
  /** Tour event wins, majors included. */
  wins: number;
  /** Major championships among those wins. */
  majorWins: number;
  /** One line per FINISHED season, in seasonNo order. */
  seasons: TourProSeasonFinish[];
}

export type TourHistory = Record<string, TourProRecord>;

function proRecord(h: TourHistory, proId: string, name: string): TourProRecord {
  const rec = h[proId] ?? (h[proId] = { name, wins: 0, majorWins: 0, seasons: [] });
  rec.name = name;
  return rec;
}

/** Stamp an event win onto the Pro who earned it (call when an event
 *  finalizes with the player ranked 1st — playoff wins included). */
export function recordTourEventWin(h: TourHistory, proId: string, name: string, major: boolean): void {
  const rec = proRecord(h, proId, name);
  rec.wins += 1;
  if (major) rec.majorWins += 1;
}

/** Stamp a finished season's placement onto the Pro who closed it out.
 *  Idempotent per seasonNo — a cloud replay or double-fire REPLACES the
 *  line, never duplicates it. */
export function recordTourSeasonFinish(
  h: TourHistory,
  proId: string,
  name: string,
  seasonNo: number,
  rank: number,
  points: number
): void {
  const rec = proRecord(h, proId, name);
  rec.seasons = rec.seasons.filter((s) => s.seasonNo !== seasonNo);
  rec.seasons.push({ seasonNo, rank, points });
  rec.seasons.sort((a, b) => a.seasonNo - b.seasonNo);
}

/** Any stored shape → a valid history. A corrupt Pro record drops whole
 *  (its tallies can't be trusted); valid neighbours survive. */
export function migrateTourHistory(raw: unknown): TourHistory {
  if (!raw || typeof raw !== 'object') return {};
  const out: TourHistory = {};
  for (const [id, rec] of Object.entries(raw as Record<string, unknown>)) {
    if (!rec || typeof rec !== 'object') continue;
    const r = rec as Partial<TourProRecord>;
    if (typeof r.name !== 'string' || typeof r.wins !== 'number' || typeof r.majorWins !== 'number') continue;
    const seasons: TourProSeasonFinish[] = [];
    let ok = true;
    for (const s of Array.isArray(r.seasons) ? r.seasons : []) {
      if (!s || typeof s.seasonNo !== 'number' || typeof s.rank !== 'number' || typeof s.points !== 'number') {
        ok = false;
        break;
      }
      seasons.push({ seasonNo: s.seasonNo, rank: s.rank, points: s.points });
    }
    if (!ok) continue;
    // Floor, never round up — a corrupted fraction must not inflate a tally.
    const clean = (v: number): number => Math.max(0, Math.floor(v));
    seasons.sort((a, b) => a.seasonNo - b.seasonNo);
    out[id] = { name: r.name, wins: clean(r.wins), majorWins: clean(r.majorWins), seasons };
  }
  return out;
}

/**
 * Cross-device merge, per Pro: the larger tallies win (two copies of the
 * same timeline — one is the other plus progress; summing would
 * double-count every win) and seasons union by seasonNo. Pure — neither
 * input is mutated.
 */
export function mergeTourHistory(a: TourHistory, b: TourHistory): TourHistory {
  const out: TourHistory = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id];
    const y = b[id];
    if (!x || !y) {
      const only = (x ?? y)!;
      out[id] = { ...only, seasons: only.seasons.map((s) => ({ ...s })) };
      continue;
    }
    const bySeason = new Map<number, TourProSeasonFinish>();
    for (const s of [...y.seasons, ...x.seasons]) bySeason.set(s.seasonNo, { ...s });
    out[id] = {
      // The name from the copy with more to say (the further-progressed one).
      name: x.wins + x.seasons.length >= y.wins + y.seasons.length ? x.name : y.name,
      wins: Math.max(x.wins, y.wins),
      majorWins: Math.max(x.majorWins, y.majorWins),
      seasons: [...bySeason.values()].sort((s1, s2) => s1.seasonNo - s2.seasonNo)
    };
  }
  return out;
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
          fieldToPars: TOUR_RIVALS.map((_, i) => [...(ae.fieldToPars?.[i] ?? [])]),
          ...(migratePlayoff(ae.playoff) ?? {})
        }
      : null;
  return { seasonNo: t.seasonNo, seed: t.seed, played, points, results, activeEvent };
}

/** A stored playoff → a valid one (as a spreadable fragment) or nothing.
 *  Damage degrades safely: playoffPending re-derives the tie from the
 *  banked rounds, so dropping a corrupt record restarts sudden death at
 *  hole 1 rather than stranding or mis-scoring the event. */
function migratePlayoff(raw: unknown): { playoff: TourPlayoff } | null {
  if (!raw || typeof raw !== 'object') return null;
  const po = raw as Partial<TourPlayoff>;
  if (!Array.isArray(po.tiedRivalIds) || !po.tiedRivalIds.every((id) => typeof id === 'string')) return null;
  if (po.tiedRivalIds.length === 0) return null;
  const holes: TourPlayoff['holes'] = [];
  for (const h of Array.isArray(po.holes) ? po.holes : []) {
    if (!h || typeof h.player !== 'number') return null;
    const rivals: Record<string, number> = {};
    for (const [k, v] of Object.entries(h.rivals ?? {})) {
      if (typeof v !== 'number') return null;
      rivals[k] = v;
    }
    holes.push({ player: h.player, rivals });
  }
  return { playoff: { tiedRivalIds: [...po.tiedRivalIds], holes } };
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
  if (aRounds !== bRounds) return aRounds > bRounds ? a : b;
  // Same regulation progress: a copy deeper into sudden death is newer.
  const aPo = a.activeEvent?.playoff?.holes.length ?? 0;
  const bPo = b.activeEvent?.playoff?.holes.length ?? 0;
  return bPo > aPo ? b : a;
}
