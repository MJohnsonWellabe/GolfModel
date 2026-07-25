import { expect, Page, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/** A fresh profile (every isolated test context) shows a one-time "what's
 *  your name?" modal before the menu is usable — fill it in like a real
 *  first-time player so it can't intercept a later click on the menu below
 *  (Locator.click() correctly refuses to click through a blocking overlay).
 *  No-ops if the modal never appears (already named, or simply hasn't shown
 *  up yet within the short wait). */
async function dismissNameModal(page: Page): Promise<void> {
  const modal = page.locator('#nameModal');
  try {
    await modal.waitFor({ state: 'visible', timeout: 3000 });
    await page.locator('#nmInput').fill('Tester');
    await page.locator('#nmSave').click();
    await modal.waitFor({ state: 'hidden', timeout: 3000 });
  } catch {
    /* never appeared — nothing to dismiss */
  }
}

/** The store overlay renders sections with buyable items (Phase 7). */
test('store overlay shows purchasable items', async ({ page }) => {
  await seedReturningDevice(page);
  await page.goto('/');
  await dismissNameModal(page);
  // The Store lives behind the Locker destination now, alongside the Season
  // Pass — the two places a player spends, in one place.
  await openDestination(page, 'locker');
  await page.locator('#landingStore').click();
  await page.waitForSelector('.storeCard');
  const cards = await page.locator('.storeCard').count();
  expect(cards).toBeGreaterThanOrEqual(25);
  await page.screenshot({ path: 'tests/visual/__shots__/store.png' });
});

/** Buying asks "Spend X coins now?" first; cancel spends nothing, confirm
 *  deducts and unlocks. A broke player never even sees the popup. */
test('purchases go through a spend confirmation', async ({ page }) => {
  await seedReturningDevice(page);
  await page.goto('/');
  await dismissNameModal(page);
  await openDestination(page, 'locker');
  // Store cards use a scroll-safe tap gesture (onTap, main.ts) that only fires
  // on a real pointerdown+pointerup pair close together — a single synthetic
  // dispatchEvent('pointerdown') arms it but never fires. Locator.click()
  // drives a real input sequence (down+up at real coordinates), which is both
  // the Playwright-idiomatic approach and what the gesture actually needs.
  await page.locator('#landingStore').click();
  await page.waitForSelector('.storeCard');

  // 0 coins (signed-out session): tapping a priced card must NOT open the
  // confirm — the "Not enough coins" toast path still guards the wallet.
  await page.locator('.storeCard.locked').first().click();
  await expect(page.locator('.storeConfirm')).toHaveCount(0);

  // With coins granted, the same tap arms the confirmation popup.
  await page.evaluate(() => (window as unknown as { __grantCoins: (n: number) => void }).__grantCoins(5000));
  await page.locator('#storeBack').click();
  // Back lands on the landing, not inside the door that was open.
  await openDestination(page, 'locker');
  await page.locator('#landingStore').click(); // reopen so cards re-render as affordable
  const firstCard = page.locator('.storeCard:not(.owned):not(.equipped)').first();
  const itemId = await firstCard.getAttribute('data-item');
  await firstCard.click();
  await expect(page.locator('.storeConfirm')).toBeVisible();
  await expect(page.locator('.scAsk')).toContainText('Spend');

  // Cancel: popup closes, nothing bought.
  await page.locator('#buyNo').click();
  await expect(page.locator('.storeConfirm')).toHaveCount(0);
  await expect(
    page.locator(`.storeCard[data-item="${itemId}"].owned, .storeCard[data-item="${itemId}"].equipped`)
  ).toHaveCount(0);

  // Confirm: item becomes owned (auto-equips where equippable).
  await page.locator(`.storeCard[data-item="${itemId}"]`).click();
  await page.waitForSelector('.storeConfirm');
  await page.locator('#buyYes').click();
  await expect(page.locator('.storeConfirm')).toHaveCount(0);
  await expect(page.locator(`.storeCard[data-item="${itemId}"]`)).toHaveClass(/owned|equipped/);
});
