import { expect, test } from '@playwright/test';

/**
 * MENU LAYOUT CONTRACTS, AT PHONE SIZE.
 *
 * Two menu defects the owner reported, both of which are arithmetic rather
 * than taste, and both of which a screenshot alone would not have caught:
 *
 *   - the Locker's character grid fit barely one row inside its fixed-height
 *     shell ("can we make their pictures a little smaller to at least have two
 *     full rows");
 *   - the earned-feat medals rendered in dark body text because `.featGot
 *     .chip` matched no rule in the stylesheet at all ("the menu text for the
 *     new challenges should be white not black").
 *
 * So this measures the row count and reads the computed colour off the
 * cascade. It writes captures too, but the assertions are the point — a CSS
 * regression here is invisible until somebody opens the screen on a phone.
 *
 *   npx playwright test -c playwright.config.ts tests/visual/menuLayout.spec.ts
 */

test('menu · locker character grid fits two full rows', async ({ page }) => {
  test.setTimeout(120_000);
  // A real phone, not the 720x1280 default — the grid is the one screen whose
  // defect only shows at phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __startRound?: unknown }).__startRound);
  await page.evaluate(() => (document.getElementById('landingLocker') as HTMLElement)?.click());
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/visual/__shots__/menu/locker-character.png' });

  const fit = await page.evaluate(() => {
    const grid = document.querySelector('.charGrid') as HTMLElement | null;
    const scroll = document.querySelector('.lkScroll') as HTMLElement | null;
    const card = document.querySelector('.charCard') as HTMLElement | null;
    if (!grid || !scroll || !card) return null;
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const row = card.getBoundingClientRect().height + gap;
    return { rows: scroll.clientHeight / row, cols, rowPx: row, viewPx: scroll.clientHeight };
  });
  expect(fit, 'locker did not open on the Character tab').not.toBeNull();
  // Two FULL rows, with the third starting — that is what "at least two full
  // rows" means, and it is what tells the player the grid scrolls.
  expect(fit!.rows, `only ${fit!.rows.toFixed(2)} rows fit (${JSON.stringify(fit)})`).toBeGreaterThan(2);
});

test('menu · the locker cards stand off the room behind them', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __startRound?: unknown }).__startRound);
  await page.evaluate(() => (document.getElementById('landingLocker') as HTMLElement)?.click());
  await page.waitForTimeout(900);
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tests/visual/__shots__/menu/locker-style.png' });

  // The panel used to declare no background AT ALL — `.storeInner` has none and
  // `.lockerInner` only set a height — so every card composited straight onto a
  // photograph of planks (owner: "they're hard to see on the locker
  // background"). Assert the panel is actually opaque enough to sit on.
  const panel = await page.evaluate(() => {
    const el = document.querySelector('.lockerInner') as HTMLElement | null;
    if (!el) return null;
    const bg = getComputedStyle(el).backgroundImage + ' ' + getComputedStyle(el).backgroundColor;
    return bg;
  });
  expect(panel, 'locker panel missing').not.toBeNull();
  expect(panel, `locker panel has no background: ${panel}`).not.toMatch(/^none rgba\(0, 0, 0, 0\)$/);

  // ...and each card carries its own fill on top of it.
  const cardAlpha = await page.evaluate(() => {
    const card = document.querySelector('#lockerRoom .archCard') as HTMLElement | null;
    if (!card) return null;
    const img = getComputedStyle(card).backgroundImage;
    const m = img.match(/rgba?\([^)]*\)/g) ?? [];
    // Highest alpha among the gradient stops.
    return Math.max(0, ...m.map((c) => {
      const parts = c.match(/[\d.]+/g) ?? [];
      return parts.length > 3 ? parseFloat(parts[3]) : 1;
    }));
  });
  expect(cardAlpha, 'no .archCard in the Locker Style tab').not.toBeNull();
  expect(cardAlpha!, `card fill is only ${cardAlpha} opaque`).toBeGreaterThanOrEqual(0.12);
});

test('menu · earned challenge medals are white', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __startRound?: unknown }).__startRound);
  await page.evaluate(() => (document.getElementById('landingProfile') as HTMLElement)?.click());
  await page.waitForTimeout(600);
  // The tab binds pointerdown, not click.
  await page.locator('.profTab[data-tab="progress"]').dispatchEvent('pointerdown');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tests/visual/__shots__/menu/feats.png' });

  // A fresh profile has no earned feats, so inject one chip into the real
  // container and read what the CASCADE gives it — the bug was that
  // `.featGot .chip` matched no rule at all and inherited dark body text.
  const colour = await page.evaluate(() => {
    const list = document.querySelector('.featList');
    if (!list) return null;
    const box = document.createElement('div');
    box.className = 'featGot';
    box.innerHTML = '<span class="chip">🏅 probe</span>';
    list.appendChild(box);
    return getComputedStyle(box.firstElementChild as Element).color;
  });
  expect(colour, 'feat list never rendered').not.toBeNull();
  const [r, g, b] = (colour ?? '').match(/\d+/g)!.map(Number);
  expect(
    Math.min(r, g, b),
    `earned-feat chip renders ${colour} — it must be near-white on the dark panel`
  ).toBeGreaterThan(200);
});
