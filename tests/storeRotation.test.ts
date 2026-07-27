import { describe, expect, it } from 'vitest';
import {
  currentStoreShelf,
  dropForWeek,
  isOnShelf,
  isRotatable,
  PERMANENT_KINDS,
  ROTATING_KINDS,
  ROTATION_SLATE,
  ROTATION_START,
  rotationPool,
  shelfIds,
  shelfTimeLeft,
  storeRotation,
  storeShelf,
  storeWeekIndex,
  STORE_DROPS
} from '../src/systems/StoreRotation';
import { DEFAULT_OWNED, STORE_BY_ID, STORE_CATALOG } from '../src/data/storeCatalog';
import { buyItem, canBuy, equip, isOwned } from '../src/systems/StoreEngine';
import { defaultProfile } from '../src/profile/Profile';
import { SEASON_1 } from '../src/data/seasonPass';

/** A long horizon: two years of weeks, enough for every pool to cycle many
 *  times over (the largest pool is 16 characters ≈ 6 weeks per pass). */
const HORIZON = 104;

const setOf = (items: { id: string }[]): string => items.map((i) => i.id).sort().join('|');

describe('rotation pools', () => {
  it('every rotating kind has a pool big enough to actually rotate', () => {
    // The no-immediate-repeat guarantee is arithmetic, and it needs a pool of
    // at least ROTATION_SLATE + 2 to hold for every week (see slateFor). A new
    // kind, or a kind trimmed below this, must fail here rather than silently
    // serve the same shelf two weeks running.
    for (const kind of ROTATING_KINDS) {
      expect(rotationPool(kind).length, kind).toBeGreaterThanOrEqual(ROTATION_SLATE + 2);
    }
  });

  it('never pools a season exclusive, a default-owned item, or a freebie', () => {
    for (const kind of ROTATING_KINDS) {
      for (const item of rotationPool(kind)) {
        expect(item.season, item.id).toBeUndefined();
        expect(item.price, item.id).toBeGreaterThan(0);
        expect(DEFAULT_OWNED, item.id).not.toContain(item.id);
      }
    }
  });

  it('isRotatable is the single gate and rejects club upgrades', () => {
    expect(isRotatable(STORE_BY_ID.get('ball_red')!)).toBe(true);
    expect(isRotatable(STORE_BY_ID.get('up_driver_1')!)).toBe(false); // permanent, not rotated
    expect(isRotatable(STORE_BY_ID.get('s1_ball_lagoon')!)).toBe(false); // claim-only
    expect(isRotatable(STORE_BY_ID.get('ball_white')!)).toBe(false); // default-owned
  });
});

describe('storeRotation', () => {
  it('is deterministic — the same week always yields the same shelf', () => {
    for (const week of [0, 1, 7, 42, 500]) {
      expect(setOf(storeRotation(week))).toBe(setOf(storeRotation(week)));
      expect(storeRotation(week).map((i) => i.id)).toEqual(storeRotation(week).map((i) => i.id));
    }
  });

  it('offers exactly ROTATION_SLATE per rotating kind (a drop week may run longer)', () => {
    for (let w = 0; w < HORIZON; w++) {
      const shelf = storeShelf(w);
      const drop = dropForWeek(w);
      for (const kind of ROTATING_KINDS) {
        const slate = shelf.byKind[kind];
        const pinned = (drop?.itemIds ?? []).filter((id) => STORE_BY_ID.get(id)?.kind === kind);
        expect(slate.length, `week ${w} ${kind}`).toBe(Math.max(ROTATION_SLATE, pinned.length));
        expect(new Set(slate.map((i) => i.id)).size, `week ${w} ${kind} duplicates`).toBe(slate.length);
      }
    }
  });

  it('keeps EVERY club upgrade on the shelf, every week, and never rotates them', () => {
    const upgrades = STORE_CATALOG.filter((i) => i.kind === 'clubUpgrade');
    expect(upgrades.length).toBe(8);
    for (let w = 0; w < HORIZON; w++) {
      const shelf = storeShelf(w);
      expect(setOf(shelf.byKind.clubUpgrade)).toBe(setOf(upgrades));
      expect(setOf(shelf.permanent)).toBe(setOf(upgrades));
      for (const u of upgrades) expect(isOnShelf(u.id, w), `${u.id} week ${w}`).toBe(true);
    }
    expect(PERMANENT_KINDS).toEqual(['clubUpgrade']);
  });

  it('never shelves a season-pass exclusive', () => {
    const seasonIds = new Set(STORE_CATALOG.filter((i) => i.season).map((i) => i.id));
    expect(seasonIds.size).toBeGreaterThan(20);
    for (let w = 0; w < HORIZON; w++) {
      for (const item of storeRotation(w)) expect(seasonIds.has(item.id), `${item.id} week ${w}`).toBe(false);
    }
    // Belt and braces: the pass's own reward ids can never be bought.
    for (const reward of SEASON_1.rewards) {
      if ('item' in reward) expect(isOnShelf(reward.item, 0)).toBe(false);
    }
  });

  it('never shelves a default-owned item', () => {
    for (let w = 0; w < HORIZON; w++) {
      for (const item of storeRotation(w)) expect(DEFAULT_OWNED, `week ${w}`).not.toContain(item.id);
    }
  });

  it('never repeats a kind’s slate two weeks running', () => {
    for (const kind of ROTATING_KINDS) {
      for (let w = 0; w < HORIZON; w++) {
        const a = setOf(storeShelf(w).byKind[kind]);
        const b = setOf(storeShelf(w + 1).byKind[kind]);
        expect(a, `${kind} weeks ${w}/${w + 1}`).not.toBe(b);
      }
    }
  });

  it('brings every rotatable item around over a long horizon', () => {
    const seen = new Set<string>();
    for (let w = 0; w < HORIZON; w++) for (const item of storeRotation(w)) seen.add(item.id);
    for (const kind of ROTATING_KINDS) {
      for (const item of rotationPool(kind)) expect(seen.has(item.id), `${item.id} never appeared`).toBe(true);
    }
    // And the pools cycle briskly: nothing should need more than a season to
    // come around (the biggest pool is 16 characters, ~6 weeks per pass).
    const early = new Set<string>();
    for (let w = 0; w < 13; w++) for (const item of storeRotation(w)) early.add(item.id);
    for (const kind of ROTATING_KINDS) {
      for (const item of rotationPool(kind)) expect(early.has(item.id), `${item.id} took over a quarter`).toBe(true);
    }
  });

  it('treats a negative or fractional week as week 0 (a clock set before launch)', () => {
    expect(setOf(storeRotation(-5))).toBe(setOf(storeRotation(0)));
    expect(setOf(storeRotation(2.7))).toBe(setOf(storeRotation(2)));
  });
});

describe('the first ball drop', () => {
  const DROP_BALLS = ['ball_inkwash', 'ball_sightline', 'ball_cavity', 'ball_paintfall'];

  it('is week 0 and puts all four designed balls on the launch shelf', () => {
    const shelf = storeShelf(0);
    expect(shelf.drop?.id).toBe('drop_paint_shop');
    expect(shelf.byKind.ball.map((i) => i.id)).toEqual(DROP_BALLS);
    for (const id of DROP_BALLS) expect(isOnShelf(id, 0), id).toBe(true);
  });

  it('every drop only pins items that really exist and really can rotate', () => {
    for (const drop of STORE_DROPS) {
      for (const id of drop.itemIds) {
        const item = STORE_BY_ID.get(id);
        expect(item, `drop ${drop.id} pins unknown id ${id}`).toBeTruthy();
        expect(isRotatable(item!), `drop ${drop.id} pins un-rotatable ${id}`).toBe(true);
      }
    }
  });

  it('each designed ball carries pattern art plus a flat fallback colour', () => {
    for (const id of DROP_BALLS) {
      const item = STORE_BY_ID.get(id)!;
      expect(item.kind).toBe('ball');
      expect(typeof item.color, id).toBe('number');
      expect(item.ballArt, id).toBeTruthy();
      expect([200, 300], `${id} is off the tint price ladder`).toContain(item.price);
    }
    // The four are one of each style — the drop is a range, not four variants.
    expect(DROP_BALLS.map((id) => STORE_BY_ID.get(id)!.ballArt!.style)).toEqual([
      'splatter',
      'alignment',
      'band',
      'drip'
    ]);
  });
});

describe('the shelf clock', () => {
  it('week 0 is the launch week and the index advances one per calendar week', () => {
    const launch = new Date(`${ROTATION_START}T12:00:00`);
    expect(storeWeekIndex(launch)).toBe(0);
    expect(storeWeekIndex(new Date(launch.getTime() + 6 * 86_400_000))).toBe(0); // same week
    expect(storeWeekIndex(new Date(launch.getTime() + 7 * 86_400_000))).toBe(1);
    expect(storeWeekIndex(new Date(launch.getTime() + 70 * 86_400_000))).toBe(10);
  });

  it('clamps a clock set before launch to the launch shelf', () => {
    const before = new Date(`${ROTATION_START}T12:00:00`).getTime() - 30 * 86_400_000;
    expect(storeWeekIndex(new Date(before))).toBe(0);
  });

  it('currentStoreShelf carries the weekly window and a countdown', () => {
    const launch = new Date(`${ROTATION_START}T12:00:00`);
    const shelf = currentStoreShelf(launch);
    expect(shelf.weekIndex).toBe(0);
    expect(shelf.weekId).toMatch(/^w\d{4}-\d{2}$/);
    expect(shelf.endMs - shelf.startMs).toBe(7 * 86_400_000);
    expect(shelfTimeLeft(shelf, shelf.endMs - 3 * 3_600_000)).toBe('3h 0m');
    expect(shelfTimeLeft(shelf, shelf.endMs + 1)).toBe('0m');
  });
});

describe('leaving the shelf never touches ownership', () => {
  it('an owned item that has rotated off is still owned, still equippable', () => {
    const p = defaultProfile();
    p.coins = 1000;
    // Buy on the week it is offered…
    const offered = storeShelf(0).byKind.ball[0];
    expect(buyItem(p, offered.id, shelfIds(0)).ok).toBe(true);
    // …then find a week it is NOT offered in.
    const gone = Array.from({ length: HORIZON }, (_, w) => w).find((w) => !isOnShelf(offered.id, w))!;
    expect(gone).toBeGreaterThan(0);
    expect(isOwned(p, offered)).toBe(true);
    expect(equip(p, offered.id).ok).toBe(true);
    expect(p.cosmetics.equipped.ball).toBe(offered.id);
    // Buying it again still reports ownership, not the rotation.
    const again = canBuy(p, offered, shelfIds(gone));
    expect(again.ok === false && again.reason).toBe('Already owned');
  });

  it('an UNOWNED off-shelf item cannot be bought while the shelf is passed', () => {
    const p = defaultProfile();
    p.coins = 5000;
    const gone = STORE_CATALOG.find((i) => i.kind === 'ball' && isRotatable(i) && !isOnShelf(i.id, 0))!;
    const r = buyItem(p, gone.id, shelfIds(0));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('Back another week');
    expect(p.coins).toBe(5000);
    expect(isOwned(p, gone)).toBe(false);
  });

  it('omitting the shelf leaves every existing caller ungated', () => {
    const p = defaultProfile();
    p.coins = 5000;
    const gone = STORE_CATALOG.find((i) => i.kind === 'ball' && isRotatable(i) && !isOnShelf(i.id, 0))!;
    expect(buyItem(p, gone.id).ok).toBe(true);
  });

  it('the shelf gate can never sell a season exclusive, even if one were pinned', () => {
    const p = defaultProfile();
    p.coins = 5000;
    const forced = new Set(['s1_ball_lagoon']);
    expect(buyItem(p, 's1_ball_lagoon', forced).ok).toBe(false);
    expect(p.coins).toBe(5000);
  });
});
