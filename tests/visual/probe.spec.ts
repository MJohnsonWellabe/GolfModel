import { test } from '@playwright/test';

// Ad-hoc capture: PROBE="course:hole:cam,course:hole:cam,..." npx playwright test probe
const spec = process.env.PROBE || 'sablebay:1:aerial';
for (const item of spec.split(',')) {
  const [course, hole, cam] = item.split(':');
  test(`probe ${course}-${hole}-${cam}`, async ({ page }) => {
    await page.goto(`/?course=${course}&hole=${hole}&cam=${cam}&freeze=1`);
    await page.waitForFunction(() => (window as unknown as { __shotReady?: boolean }).__shotReady === true, undefined, {
      timeout: 90_000
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `tests/visual/__shots__/probe-${course}-${hole}-${cam}.png` });
  });
}
