import { test } from '@playwright/test';

/** Dev-only asset contact sheet. Renders the tree + shrub catalog
 *  (treecatalog.html) through the game's own nature pipeline and captures a
 *  labelled grid for art review. Not a pass/fail gate. */
for (const set of ['trees', 'bushes', 'mountains'] as const) {
  test(`asset catalog — ${set}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto(`/treecatalog.html?set=${set}`);
    await page.waitForFunction(() => (window as any).__ready === true, undefined, { timeout: 60_000 });
    await page.screenshot({ path: `tests/visual/__shots__/catalog-${set}.png` });
  });
}

// Each horizon massif solo — they're too wide to tell apart when tiled.
for (const key of ['mountain_alps', 'mountain_alps_b', 'mountain_red', 'mountain_range_red', 'mountain_range_alpine'] as const) {
  test(`mountain solo — ${key}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto(`/treecatalog.html?set=mountains&only=${key}`);
    await page.waitForFunction(() => (window as any).__ready === true, undefined, { timeout: 60_000 });
    await page.screenshot({ path: `tests/visual/__shots__/mtn-${key}.png` });
  });
}

test('asset catalog — ground', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/treecatalog.html?set=ground');
  await page.waitForFunction(() => (window as any).__ready === true, undefined, { timeout: 60_000 });
  await page.screenshot({ path: `tests/visual/__shots__/catalog-ground.png` });
});
