/**
 * THE WEEKLY SHELF — which of the catalog the store actually offers this week.
 *
 * The store used to render `STORE_CATALOG` whole: sixteen characters, nine
 * balls, six trails, six colorways, six club skins, seven pals and the club
 * upgrades, all on one scroll, all forever. Two things go wrong with that.
 * Nothing is ever an EVENT — a shelf that has looked identical for three months
 * is furniture, and a player stops opening it — and the character grid alone
 * needed a see-more toggle to keep the other categories reachable.
 *
 * So the shelf shrinks and moves. Every week the store offers
 * `ROTATION_SLATE` (3) items per cosmetic kind plus EVERY club upgrade, which
 * never rotate: the upgrades are the one thing a player may be saving toward
 * across weeks, and pulling a half-bought tier ladder off the shelf would be a
 * broken promise rather than a tease (owner: "only leave in the club upgrades
 * always").
 *
 * WHAT ROTATION IS NOT. Nothing is removed from the catalog and nothing is
 * removed from anybody's inventory. `STORE_CATALOG` keeps every id it has ever
 * shipped — saved profiles, cloud merges and Season Pass rewards all reference
 * those ids — and an item that is off the shelf is still owned, still
 * equippable, still rendered. It is simply not purchasable this week.
 *
 * DESIGN
 *  - Pure and deterministic from a week INDEX. No clock inside the picker, so
 *    the whole schedule is testable and previewable; `storeWeekIndex()` is the
 *    only thing that reads a date, and it derives it from the game's existing
 *    notion of a week (`WeeklyFeatured.weeklyEventFor`) rather than inventing a
 *    second calendar.
 *  - Three per kind. Three cards fill exactly one row of the store grid on a
 *    phone, so every category is one glance rather than one scroll, and against
 *    the smallest rotatable pool (5 trails, 5 colorways, 5 club skins) three is
 *    the largest slate that can still change every single week.
 *  - Season-pass exclusives and default-owned items are never on the shelf:
 *    the first can never be bought, the second is already owned by everyone.
 *  - Consecutive weeks never serve the same slate for a kind, and every
 *    rotatable item comes around. See `slateFor` for why that is arithmetic
 *    rather than luck.
 *  - DROPS. A week may headline an authored collection (`STORE_DROPS`), which
 *    is pinned onto that week's slate for the kinds it touches. That is how the
 *    four patterned balls launch together in week 0 — shipping three quarters
 *    of a collection because the slate says three would be silly. A drop
 *    smaller than the slate is topped up from the normal rotation.
 */

import { DEFAULT_OWNED, STORE_CATALOG, StoreItem, StoreKind } from '../data/storeCatalog';
import { mulberry32 } from '../utils/Random';
import { weeklyEventFor, weeklyTimeLeft } from './WeeklyFeatured';

/** Kinds that rotate. Everything else (club upgrades) is permanent. */
export const ROTATING_KINDS: readonly StoreKind[] = ['character', 'ball', 'trail', 'outfit', 'clubskin', 'pal'];
/** Kinds that are always on the shelf, in full, every week. */
export const PERMANENT_KINDS: readonly StoreKind[] = ['clubUpgrade'];
/** How many items of each rotating kind the store offers per week. */
export const ROTATION_SLATE = 3;

/** Monday the rotation starts counting from — week index 0, the first drop. */
export const ROTATION_START = '2026-07-27';

const WEEK_MS = 7 * 86_400_000;

// --------------------------------------------------------------------- drops

/** An authored collection that headlines one week of the rotation. */
export interface StoreDrop {
  id: string;
  name: string;
  /** Rotation week index this drop lands on (0 = the first week). */
  week: number;
  /** Catalog ids pinned onto that week's slate, in display order. */
  itemIds: string[];
}

/**
 * The drop schedule. Week 0 is the first ball drop: four designed balls that
 * are a set and launch as one.
 */
export const STORE_DROPS: readonly StoreDrop[] = [
  {
    id: 'drop_paint_shop',
    name: 'The Paint Shop',
    week: 0,
    itemIds: ['ball_inkwash', 'ball_sightline', 'ball_cavity', 'ball_paintfall']
  }
];

export function dropForWeek(weekIndex: number): StoreDrop | null {
  return STORE_DROPS.find((d) => d.week === weekIndex) ?? null;
}

// ---------------------------------------------------------------- the picker

/** FNV-1a 32-bit — the same hash the weekly event uses to seed from a string. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic Fisher-Yates. Never mutates the input. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const DEFAULTS = new Set<string>(DEFAULT_OWNED);

/**
 * May this item ever appear on a rotating shelf?
 *
 * No to season-pass exclusives (claim-only — shelving one would dangle
 * something the player can never buy), no to default-owned items and anything
 * free (everybody already has them), and no to kinds that do not rotate.
 * This is the single gate: `rotationPool` and the drop pins both go through it,
 * so an authoring mistake in `STORE_DROPS` cannot put a season item on sale.
 */
export function isRotatable(item: StoreItem): boolean {
  return !item.season && item.price > 0 && !DEFAULTS.has(item.id) && ROTATING_KINDS.includes(item.kind);
}

/** Every item of `kind` that can rotate, in a fixed, deterministic order. */
export function rotationPool(kind: StoreKind, catalog: readonly StoreItem[] = STORE_CATALOG): StoreItem[] {
  const pool = catalog.filter((i) => i.kind === kind && isRotatable(i));
  // Shuffled ONCE, by kind — not by week. The week picks a window into this
  // order; the order itself is a fixed property of the catalog, so the schedule
  // is stable and previewable arbitrarily far ahead.
  return shuffled(pool, hash32(`store-rotation:${kind}`));
}

/**
 * This week's slate for one kind.
 *
 * The slate is a window of `ROTATION_SLATE` consecutive items in the pool's
 * fixed order, and the window's start advances by the slate size each week PLUS
 * one extra step per completed pass over the pool. Both properties fall out of
 * that arithmetic rather than out of a retry loop:
 *
 *  - NO IMMEDIATE REPEAT. Consecutive starts differ by K or K+1 (mod n), and
 *    with n >= K+2 neither is 0 — so consecutive windows are different arcs of
 *    the same cycle, and two distinct arcs of equal length K < n are always
 *    different SETS. (A pool of exactly K+1 drops the extra step, where K+1
 *    would wrap to 0; a pool of K or fewer cannot rotate at all and is served
 *    whole.)
 *  - FULL COVERAGE. The starts walk the whole cycle, so every item is on the
 *    shelf on a schedule, not a lottery — and the extra step per pass means the
 *    pool is not merely re-served in the same fixed groups of three.
 */
function slateFor(kind: StoreKind, weekIndex: number, catalog: readonly StoreItem[]): StoreItem[] {
  const pool = rotationPool(kind, catalog);
  const n = pool.length;
  if (n === 0) return [];

  const drop = dropForWeek(weekIndex);
  const pinned = drop
    ? drop.itemIds
        .map((id) => catalog.find((i) => i.id === id))
        .filter((i): i is StoreItem => !!i && i.kind === kind && isRotatable(i))
    : [];

  if (n <= ROTATION_SLATE) return dedupe([...pinned, ...pool]);

  const k = ROTATION_SLATE;
  const bump = n === k + 1 ? 0 : Math.floor((weekIndex * k) / n);
  const start = (((weekIndex * k + bump) % n) + n) % n;
  const out = pinned.slice();
  const target = Math.max(k, pinned.length);
  for (let j = 0; j < n && out.length < target; j++) {
    const item = pool[(start + j) % n];
    if (!out.some((o) => o.id === item.id)) out.push(item);
  }
  return out;
}

function dedupe(items: StoreItem[]): StoreItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

// ---------------------------------------------------------------- the shelf

export interface StoreShelf {
  weekIndex: number;
  /** Club upgrades — every one, every week. */
  permanent: StoreItem[];
  /** This week's rotating slates, flattened in `ROTATING_KINDS` order. */
  rotating: StoreItem[];
  /** `permanent` + `rotating` — the complete purchasable shelf. */
  items: StoreItem[];
  /** The shelf split by kind (empty array for a kind with nothing on it). */
  byKind: Record<StoreKind, StoreItem[]>;
  /** The collection headlining this week, if any. */
  drop: StoreDrop | null;
}

/** The shelf for a week, as one flat list. Pure; `weekIndex` is the only input
 *  that varies (negative indices are treated as week 0 — see storeWeekIndex). */
export function storeRotation(weekIndex: number, catalog: readonly StoreItem[] = STORE_CATALOG): StoreItem[] {
  return storeShelf(weekIndex, catalog).items;
}

/** The shelf for a week, grouped and annotated — what the store UI renders. */
export function storeShelf(weekIndex: number, catalog: readonly StoreItem[] = STORE_CATALOG): StoreShelf {
  const week = Math.max(0, Math.floor(weekIndex));
  const byKind = {} as Record<StoreKind, StoreItem[]>;
  const permanent: StoreItem[] = [];
  const rotating: StoreItem[] = [];
  for (const kind of PERMANENT_KINDS) {
    const items = catalog.filter((i) => i.kind === kind && !i.season);
    byKind[kind] = items;
    permanent.push(...items);
  }
  for (const kind of ROTATING_KINDS) {
    const items = slateFor(kind, week, catalog);
    byKind[kind] = items;
    rotating.push(...items);
  }
  return { weekIndex: week, permanent, rotating, items: [...permanent, ...rotating], byKind, drop: dropForWeek(week) };
}

/** The ids on a week's shelf — the set `StoreEngine.canBuy` gates against. */
export function shelfIds(weekIndex: number, catalog: readonly StoreItem[] = STORE_CATALOG): Set<string> {
  return new Set(storeRotation(weekIndex, catalog).map((i) => i.id));
}

/** Is this item purchasable in this week? */
export function isOnShelf(itemId: string, weekIndex: number, catalog: readonly StoreItem[] = STORE_CATALOG): boolean {
  return storeRotation(weekIndex, catalog).some((i) => i.id === itemId);
}

// ----------------------------------------------------------------- the clock

/** Absolute week number of a date, on the game's existing weekly calendar. */
function absWeek(date: Date): number {
  return Math.floor(weeklyEventFor(date).startMs / WEEK_MS);
}

const ZERO_WEEK = absWeek(new Date(`${ROTATION_START}T12:00:00`));

/**
 * Which rotation week `date` falls in. The ONLY function here that reads a
 * clock, and it borrows the week boundary from `WeeklyFeatured` so the store,
 * the Weekly Featured round and the Live Ops preview all turn over together.
 * A device whose clock is set before launch sees week 0 rather than a negative
 * week — the launch shelf is the honest answer to "before the beginning".
 */
export function storeWeekIndex(date: Date = new Date()): number {
  return Math.max(0, absWeek(date) - ZERO_WEEK);
}

export interface CurrentStoreShelf extends StoreShelf {
  /** The weekly event id this shelf shares ('w2026-31') — a stable label. */
  weekId: string;
  /** The shelf's window (epoch ms), for a "new items in 3d 4h" countdown. */
  startMs: number;
  endMs: number;
}

/** The shelf the store should render right now. */
export function currentStoreShelf(date: Date = new Date()): CurrentStoreShelf {
  const ev = weeklyEventFor(date);
  return { ...storeShelf(storeWeekIndex(date)), weekId: ev.id, startMs: ev.startMs, endMs: ev.endMs };
}

/** "3d 4h" until this shelf turns over — the same compact format the Weekly
 *  Featured card already uses, so the two countdowns read alike. */
export function shelfTimeLeft(shelf: Pick<CurrentStoreShelf, 'endMs'>, nowMs: number): string {
  return weeklyTimeLeft(shelf, nowMs);
}
