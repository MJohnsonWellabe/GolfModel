import { expect, test } from '@playwright/test';

/** The store overlay renders sections with buyable items (Phase 7). */
test('store overlay shows purchasable items', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#storeLink');
  await page.evaluate(() => (document.getElementById('storeLink') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('.storeCard');
  const cards = await page.locator('.storeCard').count();
  expect(cards).toBeGreaterThanOrEqual(25);
  await page.screenshot({ path: 'tests/visual/__shots__/store.png' });
});

/** Buying asks "Spend X coins now?" first; cancel spends nothing, confirm
 *  deducts and unlocks. A broke player never even sees the popup. */
test('purchases go through a spend confirmation', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#storeLink');
  const tap = (sel: string) =>
    page.evaluate((s) => document.querySelector<HTMLElement>(s)!.dispatchEvent(new Event('pointerdown')), sel);
  await tap('#storeLink');
  await page.waitForSelector('.storeCard');

  // 0 coins (signed-out session): tapping a priced card must NOT open the
  // confirm — the "Not enough coins" toast path still guards the wallet.
  await tap('.storeCard.locked');
  await expect(page.locator('.storeConfirm')).toHaveCount(0);

  // With coins granted, the same tap arms the confirmation popup.
  await page.evaluate(() => (window as unknown as { __grantCoins: (n: number) => void }).__grantCoins(5000));
  await tap('#storeBack');
  await tap('#storeLink'); // reopen so cards re-render as affordable
  const firstCard = page.locator('.storeCard:not(.owned):not(.equipped)').first();
  const itemId = await firstCard.getAttribute('data-item');
  await firstCard.dispatchEvent('pointerdown');
  await expect(page.locator('.storeConfirm')).toBeVisible();
  await expect(page.locator('.scAsk')).toContainText('Spend');

  // Cancel: popup closes, nothing bought.
  await tap('#buyNo');
  await expect(page.locator('.storeConfirm')).toHaveCount(0);
  await expect(
    page.locator(`.storeCard[data-item="${itemId}"].owned, .storeCard[data-item="${itemId}"].equipped`)
  ).toHaveCount(0);

  // Confirm: item becomes owned (auto-equips where equippable).
  await page.locator(`.storeCard[data-item="${itemId}"]`).dispatchEvent('pointerdown');
  await page.waitForSelector('.storeConfirm');
  await tap('#buyYes');
  await expect(page.locator('.storeConfirm')).toHaveCount(0);
  await expect(page.locator(`.storeCard[data-item="${itemId}"]`)).toHaveClass(/owned|equipped/);
});
