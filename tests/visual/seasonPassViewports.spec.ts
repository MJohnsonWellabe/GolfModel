import { Page, test } from '@playwright/test';

/**
 * Season-pass overlay + landing across the v1.0 viewport classes (D2 nav/
 * viewport verification). Read-only contact-sheet capture — writes PNGs, never
 * asserts against goldens. Run ALONE (`npm run shots -- seasonPassViewports`).
 */
const SIZES = [
  { name: '390x844', width: 390, height: 844 }, // phone portrait
  { name: '844x390', width: 844, height: 390 }, // phone landscape
  { name: '768x1024', width: 768, height: 1024 }, // tablet portrait
  { name: '1280x800', width: 1280, height: 800 } // desktop
];

/** A fresh context shows the one-time name modal over the landing; fill it in
 *  like a first-time player so it can't intercept the landing buttons. */
async function dismissNameModal(page: Page): Promise<void> {
  const input = page.locator('#nmInput');
  try {
    await input.waitFor({ state: 'visible', timeout: 3000 });
    await input.fill('Tester');
    await page.locator('#nmSave').click();
    await input.waitFor({ state: 'hidden', timeout: 3000 });
  } catch {
    /* never appeared — nothing to dismiss */
  }
}

for (const s of SIZES) {
  test(`season pass + landing @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto('/');
    await dismissNameModal(page);
    // Landing is the entry screen; #landingSeason opens the season-pass overlay.
    await page.waitForSelector('#landingSeason', { state: 'visible' });
    await page.screenshot({ path: `tests/visual/__shots__/landing-${s.name}.png` });
    await page.locator('#landingSeason').dispatchEvent('pointerdown');
    await page.waitForSelector('#seasonPass', { state: 'visible' });
    await page.waitForSelector('.spWallet', { state: 'visible' });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `tests/visual/__shots__/seasonpass-${s.name}.png` });
  });
}
