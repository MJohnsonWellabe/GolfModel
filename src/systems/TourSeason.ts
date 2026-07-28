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
/**
 * A CAREER IS FINITE (owner pass 9: "Make the season limits 10 seasons before
 * you have to start a new golfer and that golfer can't play in career
 * anymore"). Ten completed seasons and the Pro retires to the Hall of Fame:
 * no more tour events, no more CP. They stay selectable for casual rounds and
 * keep their page in the record book forever — the career is the thing that
 * ends, not the golfer.
 */
export const SEASON_LIMIT = 10;
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

/** A partner in a SHARED season: their name and whichever events they have
 *  posted so far, cached locally so standings render offline. */
export interface TourCoopPartner {
  playerId: string;
  name: string;
  /** Event index → their score for that event. */
  results: Record<number, { total: number; toPar: number }>;
  /** When they last posted anything (epoch ms, newest CoopResult.at). Absent
   *  for a partner who has posted nothing. Used only to decide when a silent
   *  partner has abandoned a shared season — see coopSeasonSettled. */
  updatedAt?: number;
}

/** The shared-season link on a local season (owner pass 9). Absent = solo. */
export interface TourCoopState {
  /** The shared doc's id — also what the invite link carries. */
  id: string;
  /** This device's player id within the doc. */
  playerId: string;
  partners: TourCoopPartner[];
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
  /** SHARED SEASON: set when this season is being played with a friend. */
  coop?: TourCoopState;
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
  /** The player's cumulative strokes — needed to re-rank the event when a
   *  shared-season partner posts their score later. */
  total?: number;
  /** Every rival's event score, parallel to TOUR_RIVALS. Stored so a shared
   *  season can RE-SETTLE an event's points without re-simulating the field
   *  (ten numbers beat ten physics rounds). */
  field?: Array<{ total: number; toPar: number }>;
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
      s.seed + def.idx * 15013 + roundNo * 7919 + i * 104729,
      (s.seed ^ 0x9e3779b9) + def.idx * 8191 + roundNo * 6151 + i * 3079,
      // HOT STREAKS: which rivals are running hot at this stop is a pure
      // function of (season seed, rival id, event index), so a shared season
      // derives the identical purple patches on both devices — same as every
      // other thing about this field.
      { seasonSeed: s.seed, eventIdx: def.idx }
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
  return finalizeTourEvent(s, def, standings, undefined, rivals);
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
  playoffWinnerId?: string,
  rivals: readonly TourRival[] = TOUR_RIVALS
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
  const meRow = standings[me >= 0 ? me : 0];
  s.results.push({
    idx: def.idx,
    playerRank,
    points: pointsAwarded['player'] ?? 0,
    toPar: meRow.toPar,
    winnerId: playoffWinnerId ?? standings[0].id,
    total: meRow.total,
    // The field's scores ride along so a SHARED season can re-rank this event
    // when the partner posts, without re-simulating ten physics rounds.
    //
    // Stored in RIVAL ORDER, matched by id — `standings` is sorted by score,
    // and the re-settle reads this array positionally as rivals[i], so
    // dumping it in finishing order silently attached each rival's season
    // points to whoever happened to finish in their slot.
    field: rivals.map((r) => {
      const row = standings.find((x) => x.id === r.id);
      return { total: row?.total ?? 0, toPar: row?.toPar ?? 0 };
    })
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
    return finalizeTourEvent(s, def, standings, winner, rivals);
  }
  if (alive.length === 0 || po.holes.length >= MAX_PLAYOFF_HOLES) {
    return finalizeTourEvent(s, def, standings, 'player', rivals);
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

/**
 * SHARED SEASON POINTS, recomputed from scratch (owner pass 9: "Points will be
 * calculated on current placements and update when the second user finishes").
 *
 * For a solo season `s.points` is a simple accumulator, but a shared one has
 * to RE-SETTLE: you finish event 3 ranked against the AI field alone, your
 * partner posts theirs a day later, and both of your point totals must move to
 * reflect the completed leaderboard. So points become a pure function of every
 * result on record — each event ranks the AI field, you, and whichever
 * partners have posted THAT event — which is idempotent no matter what order
 * the two of you play in.
 */
export function recomputeSeasonPoints(
  s: TourSeasonState,
  courseIds: readonly string[],
  rivals: readonly TourRival[] = TOUR_RIVALS
): Record<string, number> {
  const sched = tourSchedule(s.seed, courseIds);
  const points: Record<string, number> = {};
  for (const res of s.results) {
    if (!res.field || res.total === undefined) {
      // A result banked before shared seasons existed carries no field — keep
      // the player's stored points rather than inventing a leaderboard.
      points['player'] = (points['player'] ?? 0) + res.points;
      continue;
    }
    const rows = eventRowsFor(res, s, rivals);
    const awarded = pointsForStandings(rows, sched[res.idx]?.major ?? false);
    for (const [id, pts] of Object.entries(awarded)) points[id] = (points[id] ?? 0) + pts;
  }
  return points;
}

/**
 * One finished event's leaderboard, rebuilt from the stored result: the local
 * player, the ten AI scores, and every shared-season partner who has posted
 * THAT event. Shared by the points math, the season countback and the
 * schedule's per-event drill-down, so none of them can disagree about who
 * finished where.
 *
 * Exported because the schedule screen shows this table to the player: a second
 * implementation for display would be free to drift from the one that pays the
 * points, and the whole reason this function exists is that it must not.
 */
export function eventRowsFor(
  res: TourEventResult,
  s: TourSeasonState,
  rivals: readonly TourRival[]
): TourStandingRow[] {
  return [
    { id: 'player', name: 'You', isPlayer: true, total: res.total!, toPar: res.toPar },
    ...(res.field ?? []).map((f, i) => ({
      id: rivals[i]?.id ?? `rival${i}`,
      name: rivals[i]?.name ?? `Rival ${i + 1}`,
      isPlayer: false,
      total: f.total,
      toPar: f.toPar
    })),
    ...(s.coop?.partners ?? []).flatMap((p) => {
      const r = p.results[res.idx];
      return r ? [{ id: p.playerId, name: p.name, isPlayer: false, total: r.total, toPar: r.toPar }] : [];
    })
  ].sort((a, b) => a.toPar - b.toPar || a.total - b.total || Number(b.isPlayer) - Number(a.isPlayer));
}

/** What a season COUNTBACK needs about each entrant: how many events they
 *  won outright-or-shared, their stroke total, and their score per event (for
 *  the head-to-head step). */
export interface SeasonCountback {
  /** Events finished first, shared wins included. */
  wins: number;
  /** Raw strokes across every event on record — a display figure; the
   *  comparator uses only the events both entrants played. */
  strokes: number;
  /** Event index → toPar, only for events this entrant actually posted. */
  byEvent: Record<number, number>;
}

/**
 * Season tallies beyond points, for breaking a tie between two REAL players
 * (owner: "what will happen when two real users tie in a tournament").
 *
 * Points alone can leave two people dead level, and a shared season has to
 * name the same champion on BOTH phones — so the tiebreak can only use facts
 * both devices hold: the events on the local results log and whatever the
 * partner has posted.
 */
export function seasonCountback(
  s: TourSeasonState,
  rivals: readonly TourRival[] = TOUR_RIVALS
): Record<string, SeasonCountback> {
  const out: Record<string, SeasonCountback> = {};
  const get = (id: string): SeasonCountback => (out[id] ??= { wins: 0, strokes: 0, byEvent: {} });
  for (const res of s.results) {
    if (!res.field || res.total === undefined) continue;
    const rows = eventRowsFor(res, s, rivals);
    rows.forEach((row, i) => {
      // Keyed by the entrant's REAL id. The local player's row is the literal
      // 'player' on every device, so keying by that would make the id
      // tiebreak compare different strings on the two phones — and each would
      // hand the title to the other.
      const t = get(coopIdOf(row.id, s));
      t.strokes += row.total;
      t.byEvent[res.idx] = row.toPar;
      if (competitionRank(rows, i) === 0) t.wins += 1;
    });
  }
  return out;
}

/**
 * Rank two entrants who are LEVEL ON POINTS. Negative = `a` ahead.
 *
 * Most event wins, then head-to-head over the events both played, then the
 * fewest strokes across those same shared events (so simply having played
 * more can neither help nor hurt), then the id — a deterministic backstop
 * that guarantees both devices name the same champion and a dead heat is
 * impossible.
 */
export function compareCountback(
  aId: string,
  bId: string,
  cb: Record<string, SeasonCountback>
): number {
  const a = cb[aId];
  const b = cb[bId];
  if (!a || !b) return a ? -1 : b ? 1 : aId.localeCompare(bId);
  if (a.wins !== b.wins) return b.wins - a.wins;
  // Head-to-head, over the events BOTH posted — the only set where comparing
  // them means anything.
  const shared = Object.keys(a.byEvent)
    .map(Number)
    .filter((idx) => idx in b.byEvent);
  let h2h = 0;
  for (const idx of shared) {
    if (a.byEvent[idx] < b.byEvent[idx]) h2h -= 1;
    else if (a.byEvent[idx] > b.byEvent[idx]) h2h += 1;
  }
  if (h2h !== 0) return h2h;
  // Then the aggregate over those same shared events, so having simply played
  // more events can neither help nor hurt.
  const agg = (t: SeasonCountback): number => shared.reduce((n, idx) => n + t.byEvent[idx], 0);
  const byScore = agg(a) - agg(b);
  if (byScore !== 0) return byScore;
  // Nothing separates them: fall to the id, which is stable and identical on
  // both devices, so the two phones can never name different champions.
  return aId.localeCompare(bId);
}

/** Fold a fetched shared-season doc into the local season: the partner's
 *  posted results (everyone who is not this device) replace the cache, and
 *  the points table re-settles. Returns true when anything changed. */
export function applyCoopSnapshot(
  s: TourSeasonState,
  partners: TourCoopPartner[],
  courseIds: readonly string[],
  rivals: readonly TourRival[] = TOUR_RIVALS
): boolean {
  if (!s.coop) return false;
  const before = JSON.stringify(s.coop.partners);
  s.coop.partners = partners.filter((p) => p.playerId !== s.coop!.playerId);
  const changed = JSON.stringify(s.coop.partners) !== before;
  s.points = recomputeSeasonPoints(s, courseIds, rivals);
  return changed;
}

/**
 * Season standings including any shared-season partners.
 *
 * The tiebreak is a COUNTBACK, not "whichever player this device belongs to".
 * That was the bug: `Number(b.isPlayer) - Number(a.isPlayer)` put the local
 * human on top of a level partner, so on a points tie each phone crowned
 * itself and the two disagreed about who won. Every key below is computed
 * from facts both devices hold, ending in an id comparison that cannot tie —
 * so both name the same champion.
 */
export function coopSeasonStandings(
  s: TourSeasonState,
  rivals: readonly TourRival[] = TOUR_RIVALS
): TourStandingRow[] {
  const rows = seasonStandings(s, rivals);
  for (const p of s.coop?.partners ?? []) {
    rows.push({ id: p.playerId, name: p.name, isPlayer: false, total: s.points[p.playerId] ?? 0, toPar: 0 });
  }
  if (!s.coop) return rows.sort((a, b) => b.total - a.total || Number(b.isPlayer) - Number(a.isPlayer));
  const humans = new Set([s.coop.playerId, ...s.coop.partners.map((p) => p.playerId)]);
  const cb = seasonCountback(s, rivals);
  return rows.sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;
    // Two PEOPLE level on points go to the countback; an AI keeps the old
    // display order (their ties are cosmetic — points already shared).
    const ai = coopIdOf(a.id, s);
    const bi = coopIdOf(b.id, s);
    if (humans.has(ai) && humans.has(bi)) return compareCountback(ai, bi, cb);
    return Number(b.isPlayer) - Number(a.isPlayer);
  });
}

/** A standings row's id as BOTH devices know it: the local player's row is
 *  always 'player', which is a different string on each phone, so a shared
 *  season resolves it to that device's real player id. */
function coopIdOf(rowId: string, s: TourSeasonState): string {
  return rowId === 'player' && s.coop ? s.coop.playerId : rowId;
}

/** How long a partner can go silent before a shared season settles without
 *  them (owner: "If they abandon, it settles to you"). */
export const COOP_STALE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Is a shared season's result FINAL? True for a solo season, for one where
 * every partner has played all sixteen, and for one whose partner has gone
 * quiet for a month. Until then the human title is provisional — the player
 * who finished first has not beaten anyone yet.
 */
export function coopSeasonSettled(s: TourSeasonState, now: number): boolean {
  const partners = s.coop?.partners ?? [];
  if (partners.length === 0) return true;
  return partners.every((p) => {
    if (Object.keys(p.results).length >= TOUR_EVENTS) return true;
    // A partner who never posted at all has no clock to run down — the season
    // settles once the invite has been stale for the same month.
    return now - (p.updatedAt ?? 0) > COOP_STALE_MS;
  });
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
  // coopSeasonStandings, NOT seasonStandings: the partner has to be in the
  // table or a shared season crowns BOTH players (each beat the AI field, so
  // each was told they won). It falls through to the solo table when there is
  // no partner, so nothing changes for a season played alone.
  const table = coopSeasonStandings(s, rivals);
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
  /** Set while a SHARED season's result is not final — you finished all
   *  sixteen but your friend has not, so the head-to-head placing here can
   *  still move. Cleared when the season settles. */
  provisional?: boolean;
  /** Events actually played, when the season was ABANDONED part-way (owner
   *  pass 9b: "you should be able to quit a season and start a new one
   *  whenever you want. the partial season counts for the golfer").
   *  ABSENT MEANS A FULL SEASON — every record written before quitting
   *  existed stays correct without a migration. */
  events?: number;
}

export interface TourProRecord {
  /** Name snapshot — refreshed on every record, kept after deletion. */
  name: string;
  /** Tour event wins, majors included. */
  wins: number;
  /** Major championships among those wins. */
  majorWins: number;
  /** WHICH majors this Pro has won, by name, deduped — the career grand slam
   *  is all four (MAJOR_NAMES), and a repeat win of the same major does not
   *  bring it closer. */
  majors: string[];
  /** One line per season CLOSED OUT — played to the finale or quit part-way
   *  (a quit line carries `events`). This list's length is also the career
   *  counter SEASON_LIMIT reads. */
  seasons: TourProSeasonFinish[];
}

/** How many seasons this Pro has played out. The record book's season list
 *  IS the counter — idempotent per seasonNo and merged across devices, so it
 *  can neither double-count nor be lost. */
export function seasonsCompleted(h: TourHistory, proId: string): number {
  return h[proId]?.seasons.length ?? 0;
}

/** Has this Pro reached the career limit? A retired Pro cannot enter the tour
 *  or earn CP; casual rounds are still theirs to play. */
export function proRetired(h: TourHistory, proId: string): boolean {
  return seasonsCompleted(h, proId) >= SEASON_LIMIT;
}

/** Has this Pro won all four majors? (The career grand slam.) */
export function hasGrandSlam(rec: TourProRecord | undefined): boolean {
  if (!rec) return false;
  return MAJOR_NAMES.every((m) => rec.majors.includes(m));
}

export type TourHistory = Record<string, TourProRecord>;

function proRecord(h: TourHistory, proId: string, name: string): TourProRecord {
  const rec = h[proId] ?? (h[proId] = { name, wins: 0, majorWins: 0, majors: [], seasons: [] });
  rec.name = name;
  return rec;
}

/** Stamp an event win onto the Pro who earned it (call when an event
 *  finalizes with the player ranked 1st — playoff wins included).
 *  `majorName` is the major's title when the event was one, else undefined. */
export function recordTourEventWin(h: TourHistory, proId: string, name: string, majorName?: string): void {
  const rec = proRecord(h, proId, name);
  rec.wins += 1;
  if (majorName) {
    rec.majorWins += 1;
    if (!rec.majors.includes(majorName)) rec.majors.push(majorName);
  }
}

/** Stamp a season's placement onto the Pro who closed it out. `events` is
 *  passed only when the season was QUIT part-way — a full season stores
 *  nothing, so old records and new ones read alike.
 *
 *  Idempotent per seasonNo: a cloud replay, a double-fire, or quitting a
 *  season that was somehow already recorded REPLACES the line rather than
 *  duplicating it — which is what stops the career counter inflating. */
export function recordTourSeasonFinish(
  h: TourHistory,
  proId: string,
  name: string,
  seasonNo: number,
  rank: number,
  points: number,
  events?: number,
  provisional = false
): void {
  const rec = proRecord(h, proId, name);
  rec.seasons = rec.seasons.filter((s) => s.seasonNo !== seasonNo);
  rec.seasons.push({
    seasonNo,
    rank,
    points,
    ...(provisional ? { provisional: true } : {}),
    ...(typeof events === 'number' && events < TOUR_EVENTS ? { events } : {})
  });
  rec.seasons.sort((a, b) => a.seasonNo - b.seasonNo);
}

/**
 * QUIT THE SEASON IN PROGRESS (owner pass 9b, verbatim: "you should be able
 * to quit a season and start a new one whenever you want. the partial season
 * counts for the golfer").
 *
 * Walking away is allowed but never free: the part-played season is stamped
 * onto the Pro's record with the placement they held, which also burns one of
 * their ten (SEASON_LIMIT reads this very list). The season purse is NOT paid
 * — `finishSeason` would hand a champion's coins to someone six events in.
 *
 * The one exception is a season with nothing played: there is no placement to
 * record, so it simply rerolls the schedule under the SAME season number, and
 * a mistaken tap can never cost a career slot.
 *
 * Pure: the caller persists `next` and the mutated history.
 */
export function quitSeason(
  s: TourSeasonState,
  history: TourHistory,
  proId: string,
  proName: string,
  newSeed: number,
  rivals: readonly TourRival[] = TOUR_RIVALS
): { recorded: TourProSeasonFinish | null; next: TourSeasonState | null; retired: boolean } {
  if (s.played <= 0) {
    return { recorded: null, next: newSeason(newSeed, s.seasonNo), retired: false };
  }
  // The rank the player actually SAW — coopSeasonStandings folds in a shared
  // season's partner and falls through to the solo table when there is none.
  const table = coopSeasonStandings(s, rivals);
  const rank = table.findIndex((r) => r.isPlayer) + 1;
  const points = s.points['player'] ?? 0;
  recordTourSeasonFinish(history, proId, proName, s.seasonNo, rank || table.length, points, s.played);
  const recorded = history[proId].seasons.find((x) => x.seasonNo === s.seasonNo) ?? null;
  const retired = proRetired(history, proId);
  return { recorded, next: retired ? null : rolloverSeason(s, newSeed), retired };
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
      // A malformed `events` is IGNORED rather than dropping the whole Pro:
      // the line degrades to "a full season", which loses one annotation
      // instead of a career.
      const ev = typeof s.events === 'number' && s.events >= 0 && s.events < TOUR_EVENTS
        ? Math.floor(s.events)
        : undefined;
      seasons.push({
        seasonNo: s.seasonNo,
        rank: s.rank,
        points: s.points,
        ...(s.provisional === true ? { provisional: true } : {}),
        ...(ev !== undefined ? { events: ev } : {})
      });
    }
    if (!ok) continue;
    // Floor, never round up — a corrupted fraction must not inflate a tally.
    const clean = (v: number): number => Math.max(0, Math.floor(v));
    seasons.sort((a, b) => a.seasonNo - b.seasonNo);
    const majors = (Array.isArray(r.majors) ? r.majors : []).filter((m): m is string => typeof m === 'string');
    out[id] = {
      name: r.name,
      wins: clean(r.wins),
      majorWins: clean(r.majorWins),
      majors: [...new Set(majors)],
      seasons
    };
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
      out[id] = { ...only, majors: [...only.majors], seasons: only.seasons.map((s) => ({ ...s })) };
      continue;
    }
    const bySeason = new Map<number, TourProSeasonFinish>();
    for (const s of [...y.seasons, ...x.seasons]) {
      // Two devices can hold the SAME season at different depths (one quit at
      // six events, the other played nine before quitting). The further-
      // progressed copy is the truth; a finished season (no `events`) beats
      // any partial one.
      const held = bySeason.get(s.seasonNo);
      const depth = (f: TourProSeasonFinish): number => f.events ?? TOUR_EVENTS;
      if (!held || depth(s) > depth(held)) bySeason.set(s.seasonNo, { ...s });
    }
    out[id] = {
      // The name from the copy with more to say (the further-progressed one).
      name: x.wins + x.seasons.length >= y.wins + y.seasons.length ? x.name : y.name,
      wins: Math.max(x.wins, y.wins),
      majorWins: Math.max(x.majorWins, y.majorWins),
      majors: [...new Set([...x.majors, ...y.majors])],
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
    .map((r) => {
      // `total` and `field` ride along so a SHARED season can re-settle an
      // event's points after a reload without re-simulating the rivals.
      // Dropping them here would silently strand a co-op season's history.
      const field = (Array.isArray(r.field) ? r.field : []).filter(
        (f): f is { total: number; toPar: number } =>
          !!f && typeof f.total === 'number' && typeof f.toPar === 'number'
      );
      return {
        idx: r.idx,
        playerRank: r.playerRank,
        points: r.points,
        toPar: r.toPar ?? 0,
        winnerId: r.winnerId ?? '',
        ...(typeof r.total === 'number' ? { total: r.total } : {}),
        ...(field.length ? { field: field.map((f) => ({ total: f.total, toPar: f.toPar })) } : {})
      };
    });
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
  const coop = migrateCoop(t.coop);
  return { seasonNo: t.seasonNo, seed: t.seed, played, points, results, activeEvent, ...(coop ? { coop } : {}) };
}

/** A stored shared-season link → a valid one, or nothing. A damaged block
 *  drops the season back to solo rather than corrupting the points table. */
function migrateCoop(raw: unknown): TourCoopState | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<TourCoopState>;
  if (typeof c.id !== 'string' || typeof c.playerId !== 'string') return null;
  const partners: TourCoopPartner[] = [];
  for (const p of Array.isArray(c.partners) ? c.partners : []) {
    if (!p || typeof p.playerId !== 'string' || typeof p.name !== 'string') continue;
    const results: TourCoopPartner['results'] = {};
    for (const [k, r] of Object.entries(p.results ?? {})) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0) continue;
      if (!r || typeof r.total !== 'number' || typeof r.toPar !== 'number') continue;
      results[idx] = { total: r.total, toPar: r.toPar };
    }
    partners.push({
      playerId: p.playerId,
      name: p.name,
      results,
      ...(typeof p.updatedAt === 'number' ? { updatedAt: p.updatedAt } : {})
    });
  }
  return { id: c.id, playerId: c.playerId, partners };
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
  if (aPo !== bPo) return aPo > bPo ? a : b;
  // Still tied: prefer whichever copy has heard about more partner results —
  // the shared doc is the authority, but the fuller cache is the better start.
  const known = (x: TourSeasonState): number =>
    (x.coop?.partners ?? []).reduce((n, p) => n + Object.keys(p.results).length, 0);
  return known(b) > known(a) ? b : a;
}
