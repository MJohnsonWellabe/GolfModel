/**
 * CAREER MODE — your Pro, and the CP economy.
 *
 * WHY THIS EXISTS (owner, pass 7): "the game feels flat … nothing you do today
 * changes tomorrow's round." The career golfer is the answer chosen over more
 * systems: you start a rookie at overall 65 who grows because YOU played —
 * every round pays CP (career points), CP buys attribute points, and the
 * golfer you built is the one you enter in the daily tournament.
 *
 * THE ECONOMY DECISION (owner Q&A): CP REPLACES XP — two currencies, not
 * three. CP earned is progression (and paces the season pass); coins remain
 * the one spend currency for cosmetics/upgrades/the pass. Legacy
 * `profile.xp/level` are frozen (they never unlocked anything).
 *
 * THE CURVE (owner spec, verbatim targets): 65→80 in ~25–30 rounds, 80→90 in
 * another ~25–30, 90→99 in ~50 more. With rounds paying ~6–8 CP each, the
 * rising point costs below land the totals at ~27 / ~28 / ~55 rounds. The
 * bracket totals are pinned by tests/career.test.ts — change one side, change
 * both.
 *
 * Pure data + math. No profile, no DOM, no persistence — the UI and
 * ProgressionEngine call in; tests exercise everything headlessly.
 */
import type { GolferStats } from '../core/types';
import type { ArchetypeId, StatKey } from './archetypes';

/** The archetype-slot id the career golfer occupies in the Locker's Style
 *  tab. Never a preset: golfers.ts resolves it from CareerState.attrs. */
export const CAREER_ARCHETYPE_ID = 'career';

/** Per-attribute ceiling. 99, deliberately short of the presets' signature
 *  100s — the last point everywhere is the one thing money and time cannot
 *  finish, which keeps the presets meaningful. */
export const ATTR_CAP = 99;

export interface CareerState {
  /** Which starting shape the career began from; null = not started yet. */
  styleId: ArchetypeId | null;
  /** The Pro's CURRENT attributes (starting shape + every point bought). */
  attrs: GolferStats;
  /** Unspent CP. Always cpEarned − cpSpent; stored for cheap reads. */
  cp: number;
  /** Lifetime CP earned — GROW-ONLY, the merge anchor and the season-pass
   *  pace. Spending never reduces it. */
  cpEarned: number;
  /** Lifetime CP spent — grow-only, the other half of the merge pair. */
  cpSpent: number;
  createdAt: number;
}

/**
 * The five starting shapes: the archetype identities scaled down to overall
 * EXACTLY 65 (sum 325 — gated by a test), signature bias kept, so "which pro
 * am I" is a real choice on day one and growth is the rest of the identity.
 */
export const CAREER_STARTS: Record<ArchetypeId, GolferStats> = {
  bigHitter: { drivingPower: 75, drivingAccuracy: 62, approach: 64, chipping: 62, putting: 62 },
  sniper: { drivingPower: 64, drivingAccuracy: 75, approach: 63, chipping: 62, putting: 61 },
  ironMaiden: { drivingPower: 62, drivingAccuracy: 63, approach: 75, chipping: 63, putting: 62 },
  shortGame: { drivingPower: 59, drivingAccuracy: 63, approach: 64, chipping: 75, putting: 64 },
  puttKing: { drivingPower: 59, drivingAccuracy: 62, approach: 64, chipping: 65, putting: 75 }
};

/** A career that has not been started: flat 65s as a harmless placeholder
 *  (physics never sees them until styleId is set and the card is selected). */
export function emptyCareer(): CareerState {
  return {
    styleId: null,
    attrs: { drivingPower: 65, drivingAccuracy: 65, approach: 65, chipping: 65, putting: 65 },
    cp: 0,
    cpEarned: 0,
    cpSpent: 0,
    createdAt: 0
  };
}

/** Begin the career from a starting shape. CP already earned (rounds played
 *  before starting) is kept — the rookie arrives with savings. */
export function startCareer(c: CareerState, styleId: ArchetypeId, now: number): CareerState {
  return { ...c, styleId, attrs: { ...CAREER_STARTS[styleId] }, createdAt: now };
}

/**
 * CP cost of the NEXT point on an attribute currently at `value`.
 *
 * The three brackets are the whole growth curve: cheap to 80, real to 90,
 * expensive to 99. Bracket totals from a 65-start: 150 CP to bring five
 * attributes to 80, 200 more to 90, 450 more to 99 — which at ~6–8 CP a
 * round is the owner's ~27/~28/~55-round arc.
 */
export function pointCost(value: number): number {
  if (value >= ATTR_CAP) return Infinity;
  if (value >= 90) return 10;
  if (value >= 80) return 4;
  return 2;
}

/** Overall rating — same definition as types.overallRating, kept local so the
 *  data module has no runtime import needs. */
export function careerOvr(attrs: GolferStats): number {
  const s = attrs.drivingPower + attrs.drivingAccuracy + attrs.approach + attrs.chipping + attrs.putting;
  return Math.round(s / 5);
}

/** Spend CP on +1 to one attribute. Returns the new state, or null when the
 *  attribute is capped or the CP falls short (the UI disables, this guards). */
export function raiseAttr(c: CareerState, key: StatKey): CareerState | null {
  const cur = c.attrs[key];
  const cost = pointCost(cur);
  if (!Number.isFinite(cost) || c.cp < cost) return null;
  return {
    ...c,
    attrs: { ...c.attrs, [key]: cur + 1 },
    cp: c.cp - cost,
    cpSpent: c.cpSpent + cost
  };
}

/** Credit earned CP (round pay, bonuses). Grow-only counters move together. */
export function grantCp(c: CareerState, amount: number): CareerState {
  const a = Math.max(0, Math.round(amount));
  return { ...c, cp: c.cp + a, cpEarned: c.cpEarned + a };
}

/** What a finished round pays, from what actually happened in it. */
export interface RoundCpInput {
  toPar: number;
  birdies: number;
  eagles: number;
  holeInOnes: number;
  /** Won a tournament/1v1 round. */
  won: boolean;
  /** Cleared today's daily challenge with this round. */
  dailyDone: boolean;
}

/** CP the round pays. Base pay rewards SHOWING UP (the owner's "gets better
 *  the more you play"); the bonuses let good golf run ahead of the curve. */
export const CP = {
  round: 4,
  birdie: 1,
  eagle: 3,
  holeInOne: 8,
  perUnderPar: 1,
  tournamentWin: 5,
  daily: 2
} as const;

export function cpForRound(r: RoundCpInput): number {
  return (
    CP.round +
    r.birdies * CP.birdie +
    r.eagles * CP.eagle +
    r.holeInOnes * CP.holeInOne +
    Math.max(0, -r.toPar) * CP.perUnderPar +
    (r.won ? CP.tournamentWin : 0) +
    (r.dailyDone ? CP.daily : 0)
  );
}

/**
 * Merge two careers from different devices (Profile.mergeProfiles calls
 * this). Same discipline as coins: the grow-only pair is the truth — earned
 * and spent each take the max across devices, cp is DERIVED, so spending on
 * one device can never resurrect CP on another. Attributes take the per-stat
 * max (points bought anywhere are kept); the style follows whichever career
 * actually started (or the newer profile on a conflict, chosen by caller
 * order).
 */
export function mergeCareers(a: CareerState, b: CareerState): CareerState {
  const attrs: GolferStats = {
    drivingPower: Math.max(a.attrs.drivingPower, b.attrs.drivingPower),
    drivingAccuracy: Math.max(a.attrs.drivingAccuracy, b.attrs.drivingAccuracy),
    approach: Math.max(a.attrs.approach, b.attrs.approach),
    chipping: Math.max(a.attrs.chipping, b.attrs.chipping),
    putting: Math.max(a.attrs.putting, b.attrs.putting)
  };
  const cpEarned = Math.max(a.cpEarned, b.cpEarned);
  const cpSpent = Math.max(a.cpSpent, b.cpSpent);
  return {
    styleId: a.styleId ?? b.styleId,
    attrs,
    cp: Math.max(0, cpEarned - cpSpent),
    cpEarned,
    cpSpent,
    createdAt: a.createdAt || b.createdAt
  };
}
