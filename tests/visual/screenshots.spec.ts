import { expect, test } from '@playwright/test';

/**
 * Course contact sheet: every hole from the four review cameras, frozen for
 * reproducibility. Output lands in tests/visual/__shots__/ — regenerate with
 * `npm run shots` after any visual change and eyeball the diff against the
 * committed baseline (and docs/visual-bar.md).
 */
const HOLES = [1, 2, 3];
const CAMS = ['tee', 'aerial', 'approach', 'green'] as const;

for (const hole of HOLES) {
  for (const cam of CAMS) {
    test(`hole ${hole} — ${cam}`, async ({ page }) => {
      await page.goto(`/?hole=${hole}&cam=${cam}&freeze=1`);
      await page.waitForFunction(() => (window as unknown as { __shotReady?: boolean }).__shotReady === true, undefined, {
        timeout: 90_000
      });
      // One extra beat so the final texture uploads/instances hit the frame
      await page.waitForTimeout(400);
      expect(await page.locator('#scene').isVisible()).toBe(true);
      await page.screenshot({ path: `tests/visual/__shots__/h${hole}-${cam}.png` });
    });
  }
}
