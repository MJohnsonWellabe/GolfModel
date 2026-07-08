import { expect, test } from '@playwright/test';

/** The profile overlay exposes a two-step Reset Records control (Phase 9). */
test('reset records asks for confirmation before wiping', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#profileLink');
  await page.evaluate(() => (document.getElementById('profileLink') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('#resetRecords');
  // First tap only reveals the confirm/cancel — no wipe yet.
  await page.evaluate(() => (document.getElementById('resetRecords') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('#resetYes');
  await expect(page.locator('.resetWarn')).toBeVisible();
  // Cancel returns to the normal profile view.
  await page.evaluate(() => (document.getElementById('resetNo') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('#resetRecords');
});
