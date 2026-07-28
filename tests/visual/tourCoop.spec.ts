import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * SHARED SEASONS on the real UI (owner pass 9). The RTDB is mocked through the
 * `?lb=` override (the tournaments spec's precedent), so this exercises the
 * whole client path — create, share link, join from the link, and the hub's
 * partner row — without a live Firebase.
 */

const PHONE = { width: 390, height: 844 };

/** A tiny in-memory RTDB: PUT/PATCH store, GET reads back. */
async function mockRtdb(page: import('@playwright/test').Page, store: Record<string, unknown>): Promise<void> {
  await page.route('**rtdb.test/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/\.json$/, '');
    if (req.method() === 'PUT' || req.method() === 'PATCH') {
      const body = JSON.parse(req.postData() || 'null');
      if (req.method() === 'PUT') store[path] = body;
      else store[path] = { ...(store[path] as object), ...body };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }
    // GET: assemble the node from every stored path beneath it.
    const own = store[path];
    const kids: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(store)) {
      if (k.startsWith(path + '/')) {
        const rest = k.slice(path.length + 1).split('/');
        let cur = kids;
        rest.forEach((seg, i) => {
          if (i === rest.length - 1) cur[seg] = v;
          else cur = (cur[seg] ??= {}) as Record<string, unknown>;
        });
      }
    }
    const merged = own && typeof own === 'object' ? deepMerge(own as Record<string, unknown>, kids) : Object.keys(kids).length ? kids : own ?? null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(merged ?? null) });
  });
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && out[k] && typeof out[k] === 'object'
      ? deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>)
      : v;
  }
  return out;
}

/** Start a career Pro so the tour is available. */
async function startCareer(page: import('@playwright/test').Page, name: string): Promise<void> {
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown');
  await page.locator('#proName').fill(name);
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');
  await page.locator('#lkBack').dispatchEvent('click');
}

test('start a shared season, then join it from the invite link', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const store: Record<string, unknown> = {};
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await mockRtdb(page, store);
  // The share sheet and clipboard are unavailable in headless Chromium; stub
  // both so the invite path completes and hands us the link.
  await page.addInitScript(() => {
    (window as never as Record<string, unknown>).__shared = [];
    Object.defineProperty(navigator, 'share', {
      value: (d: { url?: string; text?: string }) => {
        (window as never as { __shared: unknown[] }).__shared.push(d.url ?? d.text);
        return Promise.resolve();
      },
      configurable: true
    });
  });
  await page.goto('/?lb=https://rtdb.test&freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });
  await startCareer(page, 'Host Pro');

  // The hub offers a shared season; starting one produces a ?coop= link.
  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  await expect(hub.locator('#thCoop')).toContainText(/with a friend/i);
  await hub.locator('#thCoop').dispatchEvent('click');
  await expect(hub.locator('#thCoopShare')).toBeVisible({ timeout: 20_000 });
  await expect(hub).toContainText('Shared season');
  const link = await page.evaluate(() => (window as never as { __shared: string[] }).__shared[0]);
  expect(link, 'the invite link was never shared').toMatch(/\?coop=cs/);
  const sid = /coop=([A-Za-z0-9_-]+)/.exec(link)![1];
  // The doc really was written, carrying the seed both players will run.
  const doc = store[`/coopSeasons/${sid}`] as { seed: number; seasonNo: number };
  expect(typeof doc.seed).toBe('number');

  // A SECOND player (fresh device, same mocked RTDB) opens the link and joins.
  const ctx = await page.context().browser()!.newContext({ viewport: PHONE });
  const p2 = await ctx.newPage();
  await seedReturningDevice(p2);
  await mockRtdb(p2, store);
  // NOTE the order: the invite link is opened FIRST and the career started
  // without reloading. A guest profile lives in memory only, so a reload
  // between the two would throw the Pro away (the same trap tour.spec calls
  // out) and the join would bounce to the Locker.
  await p2.goto(`/?lb=https://rtdb.test&freeze=1&coop=${sid}`);
  await p2.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });
  const banner = p2.locator('#challengeBanner');
  await expect(banner).toContainText(/shared season/i, { timeout: 30_000 });
  await expect(banner).toContainText('Host Pro'); // the inviter, by their Pro's name
  await startCareer(p2, 'Guest Pro');
  await banner.locator('#coopJoin').dispatchEvent('pointerdown');
  // The joiner's season now runs the HOST's seed — the same schedule and the
  // same ten rivals — and the hub shows the partner row.
  await expect(p2.locator('#tourHub')).toBeVisible({ timeout: 30_000 });
  const seeds = await p2.evaluate(() => {
    const w = window as never as { __tour: () => { seasonNo: number } };
    return w.__tour();
  });
  expect(seeds.seasonNo).toBe(doc.seasonNo);
  await expect(p2.locator('#tourHub')).toContainText('Shared season');
  await expect(p2.locator('#tourHub')).toContainText('Host Pro');

  expect(errors, errors.join('\n')).toHaveLength(0);
  await ctx.close();
});

/**
 * THE SCHEDULE BUTTON IN A SHARED SEASON (owner: "the schedule and standings
 * button doesn't work in a multiplayer season").
 *
 * It was never the button. Four screens share the `#tourHub` element, and
 * `renderTourHub` kicked off a background partner sync whose completion
 * repainted — always as the HUB, whatever was actually on screen. So the
 * schedule painted and was overwritten a moment later, which from the player's
 * side is a button that does nothing. Worse, the repaint re-entered
 * `renderTourHub`, which started another sync: an unbounded read loop that
 * rebuilt this screen's DOM every time a read landed.
 *
 * A solo season never showed either symptom — `syncCoopSeason` returns
 * immediately when there is no partner — which is exactly why it reached the
 * owner.
 */
test('the schedule opens and STAYS open in a shared season', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const store: Record<string, unknown> = {};
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await mockRtdb(page, store);
  // Count the partner reads, so the read loop is measured rather than inferred.
  await page.addInitScript(() => {
    (window as never as Record<string, unknown>).__coopReads = 0;
  });
  await page.route('**rtdb.test/coopSeasons/**', async (route) => {
    if (route.request().method() === 'GET') {
      await page.evaluate(() => {
        (window as never as { __coopReads: number }).__coopReads++;
      }).catch(() => undefined);
    }
    await route.fallback();
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: () => Promise.resolve(), configurable: true });
  });
  await page.goto('/?lb=https://rtdb.test&freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });
  await startCareer(page, 'Host Pro');

  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  await hub.locator('#thCoop').dispatchEvent('click');
  await expect(hub.locator('#thCoopShare')).toBeVisible({ timeout: 20_000 });
  await expect(hub).toContainText('Shared season');

  // Open the schedule and leave it alone for long enough that several syncs
  // would have landed on top of it.
  await hub.locator('#thSched').dispatchEvent('click');
  await expect(hub.locator('.thEv')).toHaveCount(16);
  await page.waitForTimeout(4000);

  // Still the schedule — not the hub wearing its clothes.
  await expect(hub.locator('.thEv'), 'a background sync repainted over the schedule').toHaveCount(16);
  await expect(hub.locator('#thSchedBack')).toBeVisible();
  await expect(hub.locator('#thPlay')).toHaveCount(0);

  // And the reads are bounded. The loop issued one per repaint for as long as
  // the hub was open; a handful over four seconds is fine, dozens is the bug.
  const reads = await page.evaluate(() => (window as never as { __coopReads: number }).__coopReads);
  expect(reads, `partner reads ran away (${reads}) — the sync/repaint loop is back`).toBeLessThan(12);

  // Back still returns to the hub.
  await hub.locator('#thSchedBack').dispatchEvent('click');
  await expect(hub.locator('#thPlay')).toBeVisible();

  expect(errors, errors.join('\n')).toHaveLength(0);
});
