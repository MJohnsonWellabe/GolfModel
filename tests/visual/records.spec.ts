import { expect, test } from '@playwright/test';

/** Records covers every course via tabs — not just the last-played one. */
test('records overlay offers a tab per course', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#recordsLink');
  await page.evaluate(() => (document.getElementById('recordsLink') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('.recTab');
  await expect(page.locator('.recTab')).toHaveCount(3);
  await expect(page.locator('.recTab.sel')).toContainText('Wildwood Glen');
  // Switching course re-filters the list without leaving the overlay.
  await page.locator('.recTab', { hasText: 'Timberline' }).dispatchEvent('pointerdown');
  await expect(page.locator('.recTab.sel')).toContainText('Timberline');
  await expect(page.locator('#recList')).toBeVisible();
  // Let the round list settle (rows or the empty note) so the committed
  // baseline isn't a transient "Loading…" frame; tolerate offline runs.
  await page.waitForSelector('.recRow, .recEmpty', { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: 'tests/visual/__shots__/records.png' });
});
