import { test } from '@playwright/test';

/** Timberline art check — frozen capture of the rebuilt course from the review
 *  cameras so the shrub scatter + horizon read in context. Not a gate. */
for (const hole of [1, 2, 3] as const) {
  for (const cam of ['tee', 'aerial'] as const) {
    test(`timberline h${hole} ${cam}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/?course=timberline&hole=${hole}&cam=${cam}&freeze=1`);
      await page.waitForFunction(() => (window as unknown as { __shotReady?: boolean }).__shotReady === true, undefined, {
        timeout: 90_000
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `tests/visual/__shots__/timberline-h${hole}-${cam}.png` });
    });
  }
}
