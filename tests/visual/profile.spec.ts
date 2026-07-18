import { expect, test } from '@playwright/test';

/** The profile overlay exposes a two-step Reset Records control (Phase 9). The
 *  destructive controls fire on `click` (a deliberate tap), not `pointerdown`,
 *  so a scroll flick that merely starts on the button can't trigger a wipe. */
test('reset records asks for confirmation before wiping', async ({ page }) => {
  await page.goto('/');
  // #landingProfile is the landing's Profile entry (the old #acctProfileLinkOut
  // sign-in block no longer exists in the landing DOM).
  await page.waitForSelector('#landingProfile');
  await page.evaluate(() => (document.getElementById('landingProfile') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('#resetRecords');
  // First tap only opens the confirm modal — no wipe yet.
  await page.evaluate(() => (document.getElementById('resetRecords') as HTMLElement).dispatchEvent(new Event('click')));
  await page.waitForSelector('#resetYes');
  await expect(page.locator('.storeConfirmBox .scTitle')).toContainText('Reset Records?');
  // Cancel removes the modal and returns to the normal profile view.
  await page.evaluate(() => (document.getElementById('resetNo') as HTMLElement).dispatchEvent(new Event('click')));
  await page.waitForFunction(() => !document.querySelector('.storeConfirmBox'));
  await page.waitForSelector('#resetRecords');
});

/** With Firebase configured, the profile offers a Link Google account control
 *  and an account-status line (Phase 5). The default development environment is
 *  intentionally local-only (dormant cloud — src/config/env.ts), which correctly
 *  hides this control; `?env=prod` resolves the configured production Firebase so
 *  we can capture the account row. No sign-in happens, so nothing is written. */
test('profile shows the cloud account row when auth is configured', async ({ page }) => {
  await page.goto('/?env=prod');
  await page.waitForSelector('#landingProfile');
  await page.evaluate(() => (document.getElementById('landingProfile') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('#linkGoogle');
  // Signed out the control reads "Sign in with Google"; signed in, "Log out".
  await expect(page.locator('#linkGoogle')).toContainText('Google');
  await expect(page.locator('#acctStatus')).toBeVisible();
});
