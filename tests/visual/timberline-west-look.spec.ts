import { test } from '@playwright/test';

/** Timberline West art check — frozen capture of the new dev course (production
 *  routing, East presentation) from the review cameras. Not a gate. */
for (const hole of [1, 2, 3] as const) {
  for (const cam of ['tee', 'aerial'] as const) {
    test(`timberline-west h${hole} ${cam}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/?course=timberlinewest&hole=${hole}&cam=${cam}&freeze=1`);
      await page.waitForFunction(() => (window as unknown as { __shotReady?: boolean }).__shotReady === true, undefined, {
        timeout: 90_000
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `tests/visual/__shots__/timberline-west-h${hole}-${cam}.png` });
    });
  }
}
