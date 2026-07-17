import { expect, test } from '@playwright/test';

/**
 * Admin landing + staging workspaces (v1.0 Final UX items 6/7/8). Uses the
 * __adminLandingPreview hook to render the landing SHELL without a live Google
 * session (the hook exposes only menu chrome; data stays Firebase-rules-gated),
 * then opens each destination. Firebase reads fail cleanly offline, so the
 * editors seed a default draft and still render for the capture. Contact sheet
 * only — writes PNGs, no golden assertions beyond "the screen rendered".
 */
const ADMIN_EMAIL = 'mattjohnson912@gmail.com';

test('admin landing + staging areas render', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1200 });
  await page.goto('/admin.html');
  // Wait for the module to boot and expose the preview hook.
  await page.waitForFunction(() => '__adminLandingPreview' in window, { timeout: 15000 });
  // boot() is async (it awaits Firebase auth) and renders the sign-in screen when
  // no session persists. Wait for that to settle FIRST, so its late render can't
  // clobber the landing the preview hook is about to paint.
  await page.waitForSelector('#signin', { timeout: 15000 }).catch(() => {});
  await page.evaluate((email) => {
    (window as unknown as { __adminLandingPreview: (e: string) => void }).__adminLandingPreview(email);
  }, ADMIN_EMAIL);

  // Landing: four destination cards.
  await page.waitForSelector('.adminGrid .adminCard', { state: 'visible' });
  const cards = await page.locator('.adminGrid .adminCard').count();
  expect(cards).toBe(4);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/visual/__shots__/admin-landing.png', fullPage: true });

  // Next Season Pass staging.
  await page.locator('.adminCard[data-card="season"] .acOpen').click();
  await page.waitForSelector('#sps, [data-role="draftBadge"], .sps-badge', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/visual/__shots__/admin-seasonpass-staging.png', fullPage: true });

  // Back to landing, then Future Store Items staging.
  await page.evaluate((email) => {
    (window as unknown as { __adminLandingPreview: (e: string) => void }).__adminLandingPreview(email);
  }, ADMIN_EMAIL);
  await page.waitForSelector('.adminGrid .adminCard', { state: 'visible' });
  await page.locator('.adminCard[data-card="store"] .acOpen').click();
  await page.waitForSelector('#ssg, .ssg-badge', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/visual/__shots__/admin-store-staging.png', fullPage: true });

  // Back to landing, then Marketing Manager.
  await page.evaluate((email) => {
    (window as unknown as { __adminLandingPreview: (e: string) => void }).__adminLandingPreview(email);
  }, ADMIN_EMAIL);
  await page.waitForSelector('.adminGrid .adminCard', { state: 'visible' });
  await page.locator('.adminCard[data-card="marketing"] .acOpen').click();
  await page.waitForSelector('#mm', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/visual/__shots__/admin-marketing-manager.png', fullPage: true });
});
