/**
 * LEADERBOARDS PER RECORD (`recordBoards`).
 *
 * Records showed one thing: the five lowest rounds on a course. That rewards a
 * single hot afternoon and nothing else — and this game already tracks a whole
 * career of things a golfer is proud of. Longest drive. Aces. Chip-ins. The
 * average you actually play to. Those are the numbers people compare, and until
 * now every one of them was visible only inside your own profile, which makes
 * them a diary rather than a leaderboard.
 *
 * WHERE THE DATA COMES FROM
 * -------------------------
 * The same world-readable `/rounds` node the admin dashboard aggregates. No new
 * writes on any gameplay path, no new node to secure, and guests are counted
 * for the boards that do not need an account — a guest is a real player
 * (design constitution rule 18) but cannot be RANKED, because there is no
 * durable identity to rank.
 *
 * WHAT IS DERIVED AND WHAT HAD TO BE ADDED
 * ----------------------------------------
 * Most of it was already on the wire and nobody had looked: an ace is a `1` in
 * `holes[]`, an average is the mean of `toPar`, putts have their own field.
 * Longest drive and chip-ins are per-round facts that only existed in the
 * profile, so `RoundRecord` gained two optional fields for them — additive, so
 * every round already stored keeps its meaning and simply does not appear on
 * those two boards.
 *
 * Pure. It takes rounds and returns rankings, so the boards can be tested
 * without a network, a profile, or a browser.
 */

import { asDifficulty, recordsAllowed } from './Difficulty';
import type { RoundRecord } from '../firebase/History';

/**
 * Whether a stored round may be RANKED on these boards.
 *
 * A round recorded before the difficulty setting shipped carries no `diff` at
 * all; every one of those was played at what is now Pro, so an absent value
 * reads as ranked rather than being thrown away.
 */
export function rankedRound(r: Pick<RoundRecord, 'diff'>): boolean {
  const d = asDifficulty(r.diff);
  return d === undefined || recordsAllowed(d);
}

export interface BoardEntry {
  /** Stable identity — the account uid. */
  uid: string;
  name: string;
  /** The ranked number, already rounded for display. */
  value: number;
  /** How it should read: '312 yd', '3', '−1.4'. */
  label: string;
  /** Rounds this player contributed, so a board can be honest about sample. */
  rounds: number;
  /** 1-based position in the FULL ranking — carried on the entry because the
   *  viewer's own row can sit far below the visible top of the board, where
   *  its index says nothing about its rank. */
  rank: number;
  /** True on the viewing player's row, so the UI can say "that one is you". */
  you: boolean;
}

export interface Board {
  id: string;
  title: string;
  /** One line on what it measures — a leaderboard nobody can interpret is a
   *  list of strangers. */
  blurb: string;
  entries: BoardEntry[];
}

/**
 * Rounds needed before an AVERAGE is ranked.
 *
 * One lucky round is not an average, and a board topped by somebody who played
 * once and shot −3 teaches everybody else that the board is meaningless.
 */
export const MIN_ROUNDS_FOR_AVERAGE = 5;

interface Career {
  uid: string;
  name: string;
  rounds: number;
  toParSum: number;
  aces: number;
  chipIns: number;
  bestDrive: number;
  bestRound: number;
  fewestPutts: number;
}

/** Fold the shared round history into one row per player. */
function careers(rounds: readonly RoundRecord[]): Career[] {
  const by = new Map<string, Career>();
  for (const r of rounds) {
    // A guest round counts as PLAY (the admin dashboard counts it) but cannot
    // be ranked: the id is a device, not a person, and it is re-rolled.
    if (r.guest || !r.uid) continue;
    // Nor can a round played below Pro. These boards compare SCORES, and an
    // easier difficulty widens the swing bands that produce them, so ranking
    // the two together would quietly make the boards a difficulty setting.
    // An absent `diff` predates the setting and was played at what is now Pro.
    if (!rankedRound(r)) continue;
    let c = by.get(r.uid);
    if (!c) {
      c = {
        uid: r.uid,
        name: r.names || 'Golfer',
        rounds: 0,
        toParSum: 0,
        aces: 0,
        chipIns: 0,
        bestDrive: 0,
        bestRound: Infinity,
        fewestPutts: Infinity
      };
      by.set(r.uid, c);
    }
    // The most recent name wins — people rename themselves, and a board
    // showing who they used to be is a small betrayal.
    if (r.names) c.name = r.names;
    c.rounds += 1;
    c.toParSum += r.toPar;
    for (const s of r.holes) if (s === 1) c.aces += 1;
    if (typeof r.drive === 'number') c.bestDrive = Math.max(c.bestDrive, r.drive);
    if (typeof r.chipIns === 'number') c.chipIns += r.chipIns;
    c.bestRound = Math.min(c.bestRound, r.toPar);
    if (typeof r.putts === 'number' && r.putts > 0) c.fewestPutts = Math.min(c.fewestPutts, r.putts);
  }
  return [...by.values()];
}

function toPar(n: number): string {
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;
}

/** How many rows a board shows before the viewer's own line (owner: "top 5
 *  and the user who's viewing it, for each stat"). */
export const BOARD_TOP = 5;

function board(
  id: string,
  title: string,
  blurb: string,
  rows: Career[],
  pick: (c: Career) => { value: number; label: string } | null,
  order: 'high' | 'low',
  viewerUid: string | null,
  limit = BOARD_TOP
): Board {
  const entries: BoardEntry[] = [];
  for (const c of rows) {
    const v = pick(c);
    if (!v || !Number.isFinite(v.value)) continue;
    entries.push({
      uid: c.uid,
      name: c.name,
      value: v.value,
      label: v.label,
      rounds: c.rounds,
      rank: 0,
      you: viewerUid !== null && c.uid === viewerUid
    });
  }
  entries.sort((a, b) => (order === 'high' ? b.value - a.value : a.value - b.value));
  // Competition ranking ("1224"): equal values share the better rank — two
  // people with 3 aces are both 2nd, and the next player is 4th.
  for (let i = 0; i < entries.length; i++) {
    entries[i].rank = i > 0 && entries[i].value === entries[i - 1].value ? entries[i - 1].rank : i + 1;
  }
  const top = entries.slice(0, limit);
  // The viewer rides along under the top even when they are 40th — a board
  // that only ever shows five strangers answers "who's best" but never "where
  // am I", and the second question is the one that brings a player back.
  const mine = entries.find((e) => e.you);
  if (mine && !top.includes(mine)) top.push(mine);
  return { id, title, blurb, entries: top };
}

/**
 * Every board, in the order a golfer cares about them: what you did once at
 * your very best, then what you do on an ordinary day.
 *
 * `viewerUid` is the signed-in account looking at the boards (null for a
 * guest): their row is marked `you` and appended below the top when they rank
 * outside it.
 */
export function recordBoards(rounds: readonly RoundRecord[], viewerUid: string | null = null): Board[] {
  const rows = careers(rounds);
  return [
    board(
      'drive',
      '🚀 Longest drive',
      'The furthest tee shot anybody has hit.',
      rows,
      (c) => (c.bestDrive > 0 ? { value: c.bestDrive, label: `${Math.round(c.bestDrive)} yd` } : null),
      'high',
      viewerUid
    ),
    board(
      'aces',
      '🎯 Holes in one',
      'Career aces. One is a story; two is a habit.',
      rows,
      (c) => (c.aces > 0 ? { value: c.aces, label: `${c.aces}` } : null),
      'high',
      viewerUid
    ),
    board(
      'chipins',
      '⛳ Chip-ins',
      'Holed from off the green, career total.',
      rows,
      (c) => (c.chipIns > 0 ? { value: c.chipIns, label: `${c.chipIns}` } : null),
      'high',
      viewerUid
    ),
    board(
      'average',
      '📊 Best average',
      `Mean score to par, over at least ${MIN_ROUNDS_FOR_AVERAGE} rounds.`,
      rows,
      (c) =>
        c.rounds >= MIN_ROUNDS_FOR_AVERAGE
          ? { value: c.toParSum / c.rounds, label: `${(c.toParSum / c.rounds).toFixed(1)}` }
          : null,
      'low',
      viewerUid
    ),
    board(
      'best',
      '🏆 Lowest round',
      'The single best card anybody has posted.',
      rows,
      (c) => (Number.isFinite(c.bestRound) ? { value: c.bestRound, label: toPar(c.bestRound) } : null),
      'low',
      viewerUid
    ),
    board(
      'putts',
      '🥍 Fewest putts',
      'The tidiest day on the greens.',
      rows,
      (c) => (Number.isFinite(c.fewestPutts) ? { value: c.fewestPutts, label: `${c.fewestPutts}` } : null),
      'low',
      viewerUid
    )
  ];
}
