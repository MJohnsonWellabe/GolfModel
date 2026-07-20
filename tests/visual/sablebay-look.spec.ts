import { test } from '@playwright/test';

/** Sable Bay art check — frozen capture of the coastal teardown (Breakwater,
 *  The Anchorage island green, Tide's Turn) from the review cameras. Not a gate. */
for (const hole of [1, 2, 3] as const) {
  for (const cam of ['tee', 'aerial'] as const) {
    test(`sablebay h${hole} ${cam}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/?course=sablebay&hole=${hole}&cam=${cam}&freeze=1`);
      await page.waitForFunction(() => (window as unknown as { __shotReady?: boolean }).__shotReady === true, undefined, {
        timeout: 90_000
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `tests/visual/__shots__/sablebay-h${hole}-${cam}.png` });
    });
  }
}
