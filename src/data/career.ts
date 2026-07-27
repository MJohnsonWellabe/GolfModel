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
 * a new Pro whenever you like. Old Pros remain playable forever (retirement
 * is soft: any Pro can be made active again from the Locker).
 *
 * CP BELONGS TO THE PRO WHO EARNED IT (owner, verbatim: "Cp earned with a pro
 * should be assigned to that pro. You shouldn't have a bunch when you start a
 * new golfer but it also shouldn't go away in case your not done with the
 * first golfer. So you'll need to store cp per pro."). The single shared
 * wallet is gone: `cpLedger` holds one grow-only earned/spent pair PER PRO, a
 * rookie starts at zero, and the CP an older Pro never spent is still theirs
 * when you go back to them. `cp`/`cpEarned`/`cpSpent` survive as DERIVED
 * read-caches (the active Pro's balance, and the stable's lifetime totals) so
 * the UI and the season-pass pace read one number as before.
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

/**
 * The ledger key CP is credited to before the first Pro exists — a lesson
 * round, an achievement, a season-pass reward taken by a player who has not
 * started a career yet. Nothing ever fills it again once a stable exists.
 *
 * The career's FIRST Pro OWNS this row: their balance is their own row plus
 * this one. The CP is deliberately never MOVED into their row, because two
 * devices would then hold the same CP under two different keys — one still in
 * the bucket, one already moved — and a row-by-row merge would count it
 * twice. Folding it in at read time keeps both devices' ledgers identical.
 */
export const UNCLAIMED_CP = '__unclaimed';

/** One Pro's CP, as the same grow-only pair the coins use: a spend only ever
 *  moves `spent` up, so it sticks across a cloud merge, and `earned` only
 *  grows, so a fresh device can never wipe a balance. Balance = earned −
 *  spent, floored at zero. */
export interface ProCp {
  earned: number;
  spent: number;
}

/** Per-Pro CP, keyed by CareerPro id (plus UNCLAIMED_CP). Entries may outlive
 *  the Pro they belong to — like the tour record book, a ledger row is the
 *  history of a golfer, not a pointer to one. */
export type CpLedger = Record<string, ProCp>;

/** The one-time record of WHERE the pre-ledger account-wide wallet landed.
 *  Kept forever because it is what lets two devices that split the same
 *  legacy balance onto DIFFERENT Pros merge without minting CP twice
 *  (mergeCareers strips it from both sides, then re-applies one). */
export interface CpSplitStamp {
  proId: string;
  earned: number;
  spent: number;
}

export interface CareerState {
  /** Every Pro ever started, oldest first. Old Pros stay playable. */
  pros: CareerPro[];
  /** The Pro currently being grown and played; null = career not started. */
  activeProId: string | null;
  /** PER-PRO CP — the source of truth for the whole economy. Every grant and
   *  every spend names a Pro; nothing is pooled. */
  cpLedger: CpLedger;
  /** True once the pre-ledger account-wide wallet has been split into
   *  `cpLedger`. The one-time migration marker (same pattern as the season's
   *  `cpDenominated`); absent = a save that still needs the split. */
  cpPerPro?: boolean;
  /** Where that split put the legacy balance — see CpSplitStamp. Absent when
   *  there was nothing to move. */
  cpSplit?: CpSplitStamp;
  /** DERIVED read-cache: what the ACTIVE Pro has left to spend (the unclaimed
   *  bucket before a career starts). Recomputed from the ledger by every
   *  mutator and by migrateCareer, so it can never drift. */
  cp: number;
  /** DERIVED read-cache: lifetime CP earned across the whole stable — the
   *  season-pass pace and the "career total" readouts. */
  cpEarned: number;
  /** DERIVED read-cache: lifetime CP spent across the whole stable. */
  cpSpent: number;
}

/** A career without its derived caches — what the mutators build before
 *  `withTotals` stamps the three read fields back on. */
type CareerCore = Omit<CareerState, 'cp' | 'cpEarned' | 'cpSpent'>;

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

/** A career that has not been started: an empty stable, an empty ledger. */
export function emptyCareer(): CareerState {
  return { pros: [], activeProId: null, cpLedger: {}, cpPerPro: true, cp: 0, cpEarned: 0, cpSpent: 0 };
}

const NO_CP: ProCp = { earned: 0, spent: 0 };

/** Which ledger row CP earned RIGHT NOW belongs to: the active Pro, or the
 *  unclaimed bucket when no career has started yet. */
export function cpTargetId(c: Pick<CareerState, 'pros' | 'activeProId'>): string {
  return c.pros.some((p) => p.id === c.activeProId) ? (c.activeProId as string) : UNCLAIMED_CP;
}

function rowOf(c: Pick<CareerState, 'cpLedger'>, proId: string | null | undefined): ProCp {
  return (proId && c.cpLedger?.[proId]) || NO_CP;
}

/** What one Pro's CP adds up to: their own row, plus the pre-career bucket
 *  when they are the Pro who started the career (see UNCLAIMED_CP). */
type CpReadable = Pick<CareerState, 'cpLedger' | 'pros'>;

function totalFor(c: CpReadable, proId: string | null | undefined): ProCp {
  const own = rowOf(c, proId);
  const ownsBucket = !!proId && proId !== UNCLAIMED_CP && c.pros[0]?.id === proId;
  if (!ownsBucket) return own;
  const banked = rowOf(c, UNCLAIMED_CP);
  return { earned: own.earned + banked.earned, spent: own.spent + banked.spent };
}

/** Lifetime CP this Pro earned (grow-only). */
export function proCpEarned(c: CpReadable, proId: string | null | undefined): number {
  return totalFor(c, proId).earned;
}

/** Lifetime CP this Pro spent (grow-only). */
export function proCpSpent(c: CpReadable, proId: string | null | undefined): number {
  return totalFor(c, proId).spent;
}

/** What ONE Pro has left to spend — nobody else's CP is reachable from here. */
export function proCp(c: CpReadable, proId: string | null | undefined): number {
  const t = totalFor(c, proId);
  return Math.max(0, t.earned - t.spent);
}

function sumLedger(l: CpLedger, field: keyof ProCp): number {
  let total = 0;
  for (const row of Object.values(l)) total += row[field];
  return total;
}

/** Stamp the derived read-caches back on. Every constructor and mutator ends
 *  here, which is why `cp`/`cpEarned`/`cpSpent` are safe to read directly. */
function withTotals(c: CareerCore): CareerState {
  return {
    ...c,
    cp: proCp(c, cpTargetId(c)),
    cpEarned: sumLedger(c.cpLedger, 'earned'),
    cpSpent: sumLedger(c.cpLedger, 'spent')
  };
}

/** Write one ledger row, dropping it when it holds nothing — an empty row is
 *  noise in storage and would make "has this career been split yet?" lie. */
function setRow(l: CpLedger, proId: string, row: ProCp): CpLedger {
  const next = { ...l };
  if (row.earned <= 0 && row.spent <= 0) delete next[proId];
  else next[proId] = row;
  return next;
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
 * dressed at creation, immediately active.
 *
 * A rookie starts with ZERO CP (owner: "you shouldn't have a bunch when you
 * start a new golfer"). The one exception is the FIRST Pro of a career, whose
 * balance includes whatever was banked before any Pro existed (UNCLAIMED_CP)
 * — that CP was earned by this player with nobody to credit, and losing it on
 * the way into the career would be a tax on playing before starting one. Old
 * Pros keep their points AND their unspent CP, and stay selectable.
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
  return withTotals({ ...c, pros: [...c.pros, pro], activeProId: id });
}

function newProId(now: number): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 1e9).toString(36);
  return `pro-${now.toString(36)}-${rnd}`;
}

/** Make another Pro from the stable the active one. Unknown id is a no-op.
 *  Goes through withTotals because `cp` reads the ACTIVE Pro's balance — the
 *  whole point of the ledger is that switching Pros switches wallets. */
export function setActivePro(c: CareerState, id: string): CareerState {
  return c.pros.some((p) => p.id === id) ? withTotals({ ...c, activeProId: id }) : c;
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

/**
 * Spend CP on +1 to one attribute of the ACTIVE Pro. Returns the new state,
 * or null when there is no active Pro, the attribute is capped, or the CP
 * falls short (the UI disables, this guards).
 *
 * `upgradeBonus` is what club upgrades already add to this attribute's
 * EFFECTIVE value (storeCatalog.upgradeStatBonus — the driver's +3/tier on
 * power and accuracy). The engine clamps every stat at 100 when it swings
 * (PhysicsEngine.statsForClub), and the card displays the same clamp — so a
 * point that lifts base+bonus past 100 changes NOTHING the player can see
 * or feel. Selling it anyway is taking CP for nothing (owner, with a
 * screenshot: "it shouldn't let me buy if the stat isn't going to go up"),
 * so the buy refuses once base + bonus reaches 100.
 */
export function raiseAttr(c: CareerState, key: StatKey, upgradeBonus = 0): CareerState | null {
  const pro = activePro(c);
  if (!pro) return null;
  const cur = pro.attrs[key];
  if (cur + upgradeBonus >= 100) return null;
  const cost = pointCost(cur);
  if (!Number.isFinite(cost)) return null;
  // Paid out of THIS Pro's own CP — another Pro's savings are unreachable.
  const paid = spendCpFrom(c, pro.id, cost);
  if (!paid) return null;
  return {
    ...paid,
    pros: paid.pros.map((p) => (p.id === pro.id ? { ...p, attrs: { ...p.attrs, [key]: cur + 1 } } : p))
  };
}

/**
 * Credit earned CP to ONE Pro's ledger (round pay, purses, bonuses). Pass
 * null to credit whoever is earning right now — the active Pro, or the
 * unclaimed bucket before a career starts.
 *
 * A named id that is no longer in the stable is still credited: a ledger row
 * is a record of a golfer, and silently redirecting their earnings to
 * somebody else would be worse than keeping an orphan row.
 */
export function grantCpTo(c: CareerState, proId: string | null, amount: number): CareerState {
  const a = Math.max(0, Math.round(amount));
  if (a <= 0) return c;
  const key = proId ?? cpTargetId(c);
  const row = rowOf(c, key);
  return withTotals({ ...c, cpLedger: setRow(c.cpLedger, key, { earned: row.earned + a, spent: row.spent }) });
}

/** Credit earned CP to whoever is earning right now (the active Pro). Kept
 *  as the one-argument form the reward paths have always used. */
export function grantCp(c: CareerState, amount: number): CareerState {
  return grantCpTo(c, null, amount);
}

/**
 * Spend CP from ONE Pro's balance. Returns the new state, or null when that
 * Pro cannot afford it — bounded by their own row alone, so a rich veteran
 * can never bankroll a rookie (and a rookie can never drain the veteran).
 */
export function spendCpFrom(c: CareerState, proId: string, amount: number): CareerState | null {
  const cost = Math.max(0, Math.round(amount));
  if (!Number.isFinite(cost) || proCp(c, proId) < cost) return null;
  if (cost === 0) return c;
  const row = rowOf(c, proId);
  return withTotals({
    ...c,
    cpLedger: setRow(c.cpLedger, proId, { earned: row.earned, spent: row.spent + cost })
  });
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

/** A stored number → a sane counter (finite, whole, never negative). */
function countOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

/** Any stored shape → a valid ledger. A row that carries nothing is dropped
 *  so "is this career split yet?" stays answerable from the ledger alone. */
function migrateLedger(raw: unknown): CpLedger {
  if (!raw || typeof raw !== 'object') return {};
  const out: CpLedger = {};
  for (const [id, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Partial<ProCp>;
    const earned = countOf(r.earned);
    const spent = countOf(r.spent);
    if (earned <= 0 && spent <= 0) continue;
    out[id] = { earned, spent };
  }
  return out;
}

function migrateSplit(raw: unknown): CpSplitStamp | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Partial<CpSplitStamp>;
  if (typeof s.proId !== 'string' || !s.proId) return undefined;
  const earned = countOf(s.earned);
  const spent = countOf(s.spent);
  return earned > 0 || spent > 0 ? { proId: s.proId, earned, spent } : undefined;
}

/**
 * THE ONE-TIME SPLIT: a stored career from before CP was per-Pro carries a
 * single account-wide `cpEarned`/`cpSpent` pair. It lands, whole, on the Pro
 * who was playing when the update arrived — the active Pro, or (a healed
 * activeProId being the most recently used one) the last Pro in the stable,
 * or the unclaimed bucket when no career was ever started, which the first
 * Pro's balance then includes. Nobody loses a balance they had.
 *
 * Runs EXACTLY ONCE and is idempotent three ways: `cpPerPro` is the explicit
 * marker (the season's `cpDenominated` pattern), an existing ledger or split
 * stamp is the evidence in case the marker is ever lost in transit, and the
 * split ASSIGNS rather than adds, so even a third run would write the same
 * numbers instead of doubling them.
 */
function splitLegacyWallet(
  r: Partial<CareerState> & LegacyCareerState,
  activeProId: string | null
): { cpLedger: CpLedger; cpSplit?: CpSplitStamp } {
  const cpLedger = migrateLedger(r.cpLedger);
  const cpSplit = migrateSplit(r.cpSplit);
  const alreadySplit = r.cpPerPro === true || !!cpSplit || Object.keys(cpLedger).length > 0;
  if (alreadySplit) return { cpLedger, ...(cpSplit ? { cpSplit } : {}) };
  const earned = countOf(r.cpEarned);
  // A corrupt copy claiming more spent than earned would otherwise store a
  // row that can never be reconciled; the old balance was 0 either way.
  const spent = Math.min(countOf(r.cpSpent), earned);
  if (earned <= 0) return { cpLedger: {} };
  const proId = activeProId ?? UNCLAIMED_CP;
  return { cpLedger: { [proId]: { earned, spent } }, cpSplit: { proId, earned, spent } };
}

/**
 * Any stored career shape → the current one. Three cases:
 * - the stable shape (possibly a partial RTDB copy: empty arrays dropped);
 * - the LEGACY single-Pro shape → its Pro becomes `pros[0]`, named after the
 *   profile (or 'My Pro'), wearing the profile's character, with the id
 *   derived from createdAt so the SAME legacy Pro migrated on two devices
 *   merges as one;
 * - nothing → an empty career.
 * The CP ledger coalesces row by row, and a pre-ledger account-wide wallet is
 * split onto the Pro who was playing (splitLegacyWallet) exactly once.
 */
export function migrateCareer(
  raw: unknown,
  fallback: { name: string; character: CharacterKey }
): CareerState {
  const r = (raw ?? {}) as Partial<CareerState> & LegacyCareerState;
  if (Array.isArray(r.pros)) {
    const pros = r.pros
      .map((p) => migratePro(p, fallback.character))
      .filter((p): p is CareerPro => p !== null);
    const activeProId = r.activeProId && pros.some((p) => p.id === r.activeProId)
      ? r.activeProId
      : (pros[pros.length - 1]?.id ?? null);
    return withTotals({ pros, activeProId, cpPerPro: true, ...splitLegacyWallet(r, activeProId) });
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
    return withTotals({ pros: [pro], activeProId: pro.id, cpPerPro: true, ...splitLegacyWallet(r, pro.id) });
  }
  return withTotals({ pros: [], activeProId: null, cpPerPro: true, ...splitLegacyWallet(r, null) });
}

/** The ledger of one side of a merge, splitting a legacy account-wide wallet
 *  on the fly if this copy never went through migrateCareer. Defense in depth:
 *  mergeProfiles is documented to normalize both sides first, and a raw cloud
 *  copy that slipped past it must not read as "this Pro has no CP". */
function ledgerSideOf(c: CareerState): { cpLedger: CpLedger; cpSplit?: CpSplitStamp } {
  return splitLegacyWallet(c, c.activeProId ?? null);
}

/** Remove a side's legacy split from its own ledger, so the SAME pre-ledger
 *  balance counted on two devices is only re-applied once (addSplit). */
function stripSplit(side: { cpLedger: CpLedger; cpSplit?: CpSplitStamp }): CpLedger {
  const s = side.cpSplit;
  if (!s) return side.cpLedger;
  const row = side.cpLedger[s.proId];
  if (!row) return side.cpLedger;
  return setRow(side.cpLedger, s.proId, {
    earned: Math.max(0, row.earned - s.earned),
    spent: Math.max(0, row.spent - s.spent)
  });
}

/** Row by row, the coins discipline: earned and spent each take the max, so a
 *  spend on one device sticks and an idle device can never resurrect CP. */
function mergeLedgers(a: CpLedger, b: CpLedger): CpLedger {
  const out: CpLedger = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id] ?? NO_CP;
    const y = b[id] ?? NO_CP;
    const row = { earned: Math.max(x.earned, y.earned), spent: Math.max(x.spent, y.spent) };
    if (row.earned > 0 || row.spent > 0) out[id] = row;
  }
  return out;
}

/** Which side's legacy split survives when two devices migrated the same
 *  pre-ledger balance onto DIFFERENT Pros. The LARGER pool wins (the smaller
 *  one is a staler snapshot of the same wallet, and choosing it would throw
 *  CP away); an exact tie goes to `a`, the newer copy. */
function pickSplit(a?: CpSplitStamp, b?: CpSplitStamp): CpSplitStamp | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.earned > a.earned ? b : a;
}

function addSplit(l: CpLedger, s?: CpSplitStamp): CpLedger {
  if (!s) return l;
  const row = l[s.proId] ?? NO_CP;
  return setRow(l, s.proId, { earned: row.earned + s.earned, spent: row.spent + s.spent });
}

/**
 * Merge two careers from different devices (Profile.mergeProfiles calls
 * this, NEWER FIRST). Same discipline as coins, now PER PRO: each Pro's
 * grow-only earned/spent pair takes the max across devices and their balance
 * is DERIVED, so a spend on one device can never be refunded by the other and
 * an idle device can never wipe a balance. CP is neither duplicated nor lost:
 * two Pros' rows never touch. Pros union by id; a Pro known to both sides
 * keeps the newer side's name/look and takes the per-stat max attrs (points
 * bought anywhere are kept). The active choice follows the newer profile.
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
  const sideA = ledgerSideOf(a);
  const sideB = ledgerSideOf(b);
  const stamp = pickSplit(sideA.cpSplit, sideB.cpSplit);
  const merged = addSplit(mergeLedgers(stripSplit(sideA), stripSplit(sideB)), stamp);
  const activeProId =
    (a.activeProId && byId.has(a.activeProId) ? a.activeProId : null) ??
    (b.activeProId && byId.has(b.activeProId) ? b.activeProId : null) ??
    (pros[pros.length - 1]?.id ?? null);
  return withTotals({ pros, activeProId, cpPerPro: true, cpLedger: merged, ...(stamp ? { cpSplit: stamp } : {}) });
}
