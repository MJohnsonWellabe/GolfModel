/**
 * CAREER MODE — your stable of Pros, and the CP economy.
 *
 * WHY THIS EXISTS (owner, pass 7): "the game feels flat … nothing you do today
 * changes tomorrow's round." The career golfer is the answer chosen over more
 * systems: you start a rookie at overall 65 who grows because YOU played —
 * every round pays CP (career points), CP buys attribute points, and the
 * golfer you built is the one you enter in the daily tournament.
 *
 * THE STABLE (owner, career round 2): a Pro has a NAME and a dedicated look
 * (a character that survives the unlocked-loadout shuffle), and you can start
 * a new Pro whenever you like. The CP wallet is SHARED across the stable —
 * unspent CP carries to the rookie, spent CP stays invested in the old Pro,
 * who remains playable forever (retirement is soft: any Pro can be made
 * active again from the Locker).
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
import type { CharacterKey } from './characters';

/** The archetype-slot id the career golfer occupies in the Locker's Style
 *  tab. Never a preset: golfers.ts resolves it from the active Pro's attrs. */
export const CAREER_ARCHETYPE_ID = 'career';

/** Per-attribute ceiling. 99, deliberately short of the presets' signature
 *  100s — the last point everywhere is the one thing money and time cannot
 *  finish, which keeps the presets meaningful. */
export const ATTR_CAP = 99;

/** One golfer in the stable: named at creation, wearing a dedicated look,
 *  carrying every attribute point ever bought for them. */
export interface CareerPro {
  /** Stable unique id — the merge key across devices. */
  id: string;
  /** The name the owner gave this Pro at creation. */
  name: string;
  /** Which starting shape the Pro began from. */
  styleId: ArchetypeId;
  /** The Pro's CURRENT attributes (starting shape + every point bought). */
  attrs: GolferStats;
  /** The Pro's dedicated look — this character is what the Pro wears every
   *  round, shuffle or not. */
  character: CharacterKey;
  createdAt: number;
}

export interface CareerState {
  /** Every Pro ever started, oldest first. Old Pros stay playable. */
  pros: CareerPro[];
  /** The Pro currently being grown and played; null = career not started. */
  activeProId: string | null;
  /** Unspent CP. Always cpEarned − cpSpent; stored for cheap reads. The
   *  wallet is SHARED across the stable — spending applies to the ACTIVE
   *  Pro, but the balance belongs to the player. */
  cp: number;
  /** Lifetime CP earned — GROW-ONLY, the merge anchor and the season-pass
   *  pace. Spending never reduces it. */
  cpEarned: number;
  /** Lifetime CP spent — grow-only, the other half of the merge pair. */
  cpSpent: number;
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

/** A career that has not been started: an empty stable, an empty wallet. */
export function emptyCareer(): CareerState {
  return { pros: [], activeProId: null, cp: 0, cpEarned: 0, cpSpent: 0 };
}

/** True once at least one Pro exists — the "has a career" gate everywhere. */
export function careerStarted(c: CareerState): boolean {
  return c.pros.length > 0;
}

/** The Pro currently active, or null (career not started / merge oddity). */
export function activePro(c: CareerState): CareerPro | null {
  return c.pros.find((p) => p.id === c.activeProId) ?? null;
}

/** Highest overall across the stable — what the career achievements test
 *  ("Raise your Pro to 80" is earned by ANY Pro reaching it). */
export function bestProOvr(c: CareerState): number {
  return c.pros.reduce((best, p) => Math.max(best, careerOvr(p.attrs)), 0);
}

/**
 * Start a new Pro: a rookie at overall 65 in the chosen shape, named and
 * dressed at creation, immediately active. CP already in the wallet is kept —
 * the rookie arrives with the stable's savings (owner: "unspent cp should
 * carry over, spent shouldn't"). Old Pros keep their points and stay
 * selectable.
 */
export function startPro(
  c: CareerState,
  opts: { name: string; styleId: ArchetypeId; character: CharacterKey; now: number; id?: string }
): CareerState {
  const id = opts.id ?? newProId(opts.now);
  const pro: CareerPro = {
    id,
    name: opts.name.trim() || 'My Pro',
    styleId: opts.styleId,
    attrs: { ...CAREER_STARTS[opts.styleId] },
    character: opts.character,
    createdAt: opts.now
  };
  return { ...c, pros: [...c.pros, pro], activeProId: id };
}

function newProId(now: number): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 1e9).toString(36);
  return `pro-${now.toString(36)}-${rnd}`;
}

/** Make another Pro from the stable the active one. Unknown id is a no-op. */
export function setActivePro(c: CareerState, id: string): CareerState {
  return c.pros.some((p) => p.id === id) ? { ...c, activeProId: id } : c;
}

/** Change a Pro's dedicated look. Unknown id is a no-op. */
export function setProLook(c: CareerState, id: string, character: CharacterKey): CareerState {
  if (!c.pros.some((p) => p.id === id)) return c;
  return { ...c, pros: c.pros.map((p) => (p.id === id ? { ...p, character } : p)) };
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

/** Spend CP on +1 to one attribute of the ACTIVE Pro. Returns the new state,
 *  or null when there is no active Pro, the attribute is capped, or the CP
 *  falls short (the UI disables, this guards). */
export function raiseAttr(c: CareerState, key: StatKey): CareerState | null {
  const pro = activePro(c);
  if (!pro) return null;
  const cur = pro.attrs[key];
  const cost = pointCost(cur);
  if (!Number.isFinite(cost) || c.cp < cost) return null;
  return {
    ...c,
    pros: c.pros.map((p) => (p.id === pro.id ? { ...p, attrs: { ...p.attrs, [key]: cur + 1 } } : p)),
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

/** The single-Pro CareerState that shipped first — recognized and upgraded
 *  by migrateCareer so no owner loses the Pro they already grew. */
interface LegacyCareerState {
  styleId?: ArchetypeId | null;
  attrs?: Partial<GolferStats>;
  cp?: number;
  cpEarned?: number;
  cpSpent?: number;
  createdAt?: number;
}

const FLAT_65: GolferStats = { drivingPower: 65, drivingAccuracy: 65, approach: 65, chipping: 65, putting: 65 };

function migratePro(raw: unknown, fallbackCharacter: CharacterKey): CareerPro | null {
  const p = (raw ?? {}) as Partial<CareerPro>;
  if (typeof p.id !== 'string' || !p.id) return null;
  return {
    id: p.id,
    name: typeof p.name === 'string' && p.name.trim() ? p.name : 'My Pro',
    styleId: p.styleId && p.styleId in CAREER_STARTS ? p.styleId : 'bigHitter',
    attrs: { ...FLAT_65, ...(p.attrs ?? {}) },
    character: typeof p.character === 'string' && p.character ? p.character : fallbackCharacter,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0
  };
}

/**
 * Any stored career shape → the current one. Three cases:
 * - the stable shape (possibly a partial RTDB copy: empty arrays dropped);
 * - the LEGACY single-Pro shape → its Pro becomes `pros[0]`, named after the
 *   profile (or 'My Pro'), wearing the profile's character, with the id
 *   derived from createdAt so the SAME legacy Pro migrated on two devices
 *   merges as one;
 * - nothing → an empty career.
 * The wallet coalesces field-by-field so a dropped counter can't zero the
 * grow-only pair.
 */
export function migrateCareer(
  raw: unknown,
  fallback: { name: string; character: CharacterKey }
): CareerState {
  const r = (raw ?? {}) as Partial<CareerState> & LegacyCareerState;
  const cpEarned = Math.max(0, r.cpEarned ?? 0);
  const cpSpent = Math.max(0, r.cpSpent ?? 0);
  const wallet = { cp: Math.max(0, cpEarned - cpSpent), cpEarned, cpSpent };
  if (Array.isArray(r.pros)) {
    const pros = r.pros
      .map((p) => migratePro(p, fallback.character))
      .filter((p): p is CareerPro => p !== null);
    const activeProId = r.activeProId && pros.some((p) => p.id === r.activeProId)
      ? r.activeProId
      : (pros[pros.length - 1]?.id ?? null);
    return { pros, activeProId, ...wallet };
  }
  if (r.styleId && r.styleId in CAREER_STARTS) {
    const pro: CareerPro = {
      id: `legacy-${r.createdAt ?? 0}`,
      name: fallback.name.trim() || 'My Pro',
      styleId: r.styleId,
      attrs: { ...FLAT_65, ...(r.attrs ?? {}) },
      character: fallback.character,
      createdAt: r.createdAt ?? 0
    };
    return { pros: [pro], activeProId: pro.id, ...wallet };
  }
  return { pros: [], activeProId: null, ...wallet };
}

/**
 * Merge two careers from different devices (Profile.mergeProfiles calls
 * this, NEWER FIRST). Same discipline as coins: the grow-only pair is the
 * truth — earned and spent each take the max across devices, cp is DERIVED,
 * so spending on one device can never resurrect CP on another. Pros union by
 * id; a Pro known to both sides keeps the newer side's name/look and takes
 * the per-stat max attrs (points bought anywhere are kept). The active
 * choice follows the newer profile.
 */
export function mergeCareers(a: CareerState, b: CareerState): CareerState {
  const byId = new Map<string, CareerPro>();
  for (const p of b.pros) byId.set(p.id, p);
  for (const p of a.pros) {
    const other = byId.get(p.id);
    if (!other) {
      byId.set(p.id, p);
      continue;
    }
    byId.set(p.id, {
      ...p,
      attrs: {
        drivingPower: Math.max(p.attrs.drivingPower, other.attrs.drivingPower),
        drivingAccuracy: Math.max(p.attrs.drivingAccuracy, other.attrs.drivingAccuracy),
        approach: Math.max(p.attrs.approach, other.attrs.approach),
        chipping: Math.max(p.attrs.chipping, other.attrs.chipping),
        putting: Math.max(p.attrs.putting, other.attrs.putting)
      },
      createdAt: p.createdAt || other.createdAt
    });
  }
  const pros = [...byId.values()].sort((x, y) => x.createdAt - y.createdAt);
  const cpEarned = Math.max(a.cpEarned, b.cpEarned);
  const cpSpent = Math.max(a.cpSpent, b.cpSpent);
  const activeProId =
    (a.activeProId && byId.has(a.activeProId) ? a.activeProId : null) ??
    (b.activeProId && byId.has(b.activeProId) ? b.activeProId : null) ??
    (pros[pros.length - 1]?.id ?? null);
  return { pros, activeProId, cp: Math.max(0, cpEarned - cpSpent), cpEarned, cpSpent };
}
