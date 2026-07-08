import { expect, test } from '@playwright/test';

/** The store overlay renders sections with buyable items (Phase 7). */
test('store overlay shows purchasable items', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#storeLink');
  await page.evaluate(() => (document.getElementById('storeLink') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('.storeCard');
  const cards = await page.locator('.storeCard').count();
  expect(cards).toBeGreaterThanOrEqual(25);
  await page.screenshot({ path: 'tests/visual/__shots__/store.png' });
});
