import { expect, test } from '@playwright/test';

/** The setup menu shows today's daily challenge banner (Phase 6). Progressive
 *  disclosure (Part 11) hides the daily systems until a device's first round
 *  completes, so the spec seeds the returning-device flag — the same approach
 *  as results.spec's landing-card test. (This spec predated progressive
 *  disclosure and was red on fresh profiles ever since.) */
test('menu shows the daily challenge banner', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'johnsons-golf-device-settings-v1',
      JSON.stringify({ sound: 0.8, ambience: 0.2, reducedMotion: false, clipCapture: false, firstRoundDone: true })
    );
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  // The banner lives on the setup wizard — open Play first.
  await page.locator('#landingPlay').dispatchEvent('pointerdown');
  await page.waitForSelector('#dailyBanner');
  const text = await page.locator('#dailyBanner').innerText();
  expect(text).toContain('DAILY');
  await page.screenshot({ path: 'tests/visual/__shots__/menu-daily.png' });
});
