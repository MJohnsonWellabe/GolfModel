import { expect, test } from '@playwright/test';

/** The setup menu shows today's daily challenge banner (Phase 6). */
test('menu shows the daily challenge banner', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#dailyBanner');
  const text = await page.locator('#dailyBanner').innerText();
  expect(text).toContain('DAILY');
  await page.screenshot({ path: 'tests/visual/__shots__/menu-daily.png' });
});
