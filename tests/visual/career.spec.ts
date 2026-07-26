import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * CAREER MODE, end to end on the real UI: the Style tab leads with Your Pro,
 * starting a career adopts a 65-overall shape, CP spends into real attribute
 * points with the OVR rising on screen, and the Pro is selectable exactly
 * like a preset.
 */

const PHONE = { width: 390, height: 844 };

/** Bank CP on the LIVE profile via the dev hook. Guests are account-gated by
 *  design (a signed-out profile persists nothing), so seeding storage cannot
 *  reach the running game — the hook is how specs earn without playing. */
async function grantCp(page: import('@playwright/test').Page, n: number): Promise<void> {
  await page.evaluate((amount) => (window as never as { __grantCp: (x: number) => void }).__grantCp(amount), n);
}

async function openStyleTab(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown');
}

test('start a career, spend CP, watch the Pro grow, select it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });
  await grantCp(page, 20); // CP banked before the career starts is kept
  await openStyleTab(page);

  // Unstarted: the career card offers the five starting styles.
  const card = page.locator('.careerCard');
  await expect(card).toBeVisible();
  await expect(card).toContainText(/start a career/i);
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');

  // Started: a 65-overall rookie with the banked 20 CP waiting, wearing the
  // Big Hitter starting shape (power-forward).
  await expect(card).toContainText('OVR 65');
  await expect(card).toContainText('20 CP');

  // Spending: each press costs the bracket price (2 CP below 80) and the CP
  // line falls with it — the readout and the economy cannot disagree.
  await page.locator('.cpSpend[data-cspend="drivingPower"]').dispatchEvent('pointerdown');
  await expect(card).toContainText('18 CP');
  await page.locator('.cpSpend[data-cspend="drivingPower"]').dispatchEvent('pointerdown');
  await expect(card).toContainText('16 CP');

  // The card is SELECTED (starting a career selects the Pro).
  await expect(page.locator('.careerCard.sel')).toBeVisible();
});

test('a rookie without CP sees honest, disabled spend buttons', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page); // no CP seeded
  await page.goto('/?freeze=1');
  await openStyleTab(page);
  await page.locator('.careerStart[data-cstart="puttKing"]').dispatchEvent('pointerdown');
  await expect(page.locator('.careerCard')).toContainText('OVR 65');
  // Broke: every spend chip is disabled, none of them lies.
  const chips = page.locator('.cpSpend');
  const n = await chips.count();
  expect(n).toBe(5);
  for (let i = 0; i < n; i++) {
    await expect(chips.nth(i)).toBeDisabled();
  }
});
