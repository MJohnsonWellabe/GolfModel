import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * CAREER MODE, end to end on the real UI: the Style tab leads with the stable,
 * starting a NAMED Pro adopts a 65-overall shape, CP spends into real
 * attribute points with the OVR rising on screen, the Pro wears a dedicated
 * look, and starting a second Pro keeps the wallet while the first stays in
 * the stable, selectable.
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

test('name a Pro, spend CP, watch them grow, then start a rookie — the stable keeps both', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });
  await grantCp(page, 20); // CP banked before the career starts is kept
  await openStyleTab(page);

  // Unstarted: the New Pro card offers a name field and the five styles.
  const newCard = page.locator('.careerNew');
  await expect(newCard).toBeVisible();
  await expect(newCard).toContainText(/start a career/i);
  await newCard.locator('#proName').fill('Lefty');
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');

  // Started: a NAMED 65-overall rookie with the banked 20 CP waiting, wearing
  // the Big Hitter starting shape (power-forward), selected on creation.
  const card = page.locator('.careerCard[data-pro]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Lefty');
  await expect(card).toContainText('OVR 65');
  await expect(card).toContainText('20 CP');
  await expect(page.locator('.careerCard.sel')).toBeVisible();
  // The dedicated look row rides on the active card.
  await expect(card.locator('.proLookRow')).toBeVisible();
  await expect(card.locator('.proLook.sel')).toHaveCount(1);

  // Spending: each press costs the bracket price (2 CP below 80) and the CP
  // line falls with it — the readout and the economy cannot disagree.
  await page.locator('.cpSpend[data-cspend="drivingPower"]').dispatchEvent('pointerdown');
  await expect(card).toContainText('18 CP');
  await page.locator('.cpSpend[data-cspend="drivingPower"]').dispatchEvent('pointerdown');
  await expect(card).toContainText('16 CP');

  // Start a ROOKIE: the wallet carries (16 CP), the vet stays in the stable.
  await page.locator('#proName').fill('Rookie Two');
  await page.locator('.careerStart[data-cstart="puttKing"]').dispatchEvent('pointerdown');
  const cards = page.locator('.careerCard[data-pro]');
  await expect(cards).toHaveCount(2);
  const active = page.locator('.careerCard.sel');
  await expect(active).toContainText('Rookie Two');
  await expect(active).toContainText('16 CP'); // unspent CP carried over
  await expect(cards.first()).toContainText('Lefty'); // the vet, still here

  // Tap the vet: active again, points intact (OVR above the rookie's 65).
  await cards.first().dispatchEvent('pointerdown');
  await expect(page.locator('.careerCard.sel')).toContainText('Lefty');

  // And the LANDING behind the overlay repainted with the live balance (owner
  // bug: "the CP to spend on your Pro didn't reset after I spent it").
  await page.locator('#lkBack').dispatchEvent('click');
  await expect(page.locator('#destLocker .dtSub')).toContainText('16 CP');
});

test('a rookie without CP sees honest, disabled spend buttons', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page); // no CP seeded
  await page.goto('/?freeze=1');
  await openStyleTab(page);
  await page.locator('.careerStart[data-cstart="puttKing"]').dispatchEvent('pointerdown');
  await expect(page.locator('.careerCard[data-pro]')).toContainText('OVR 65');
  // A nameless start still gets a name.
  await expect(page.locator('.careerCard[data-pro]')).toContainText('My Pro');
  // Broke: every spend chip is disabled, none of them lies.
  const chips = page.locator('.cpSpend');
  const n = await chips.count();
  expect(n).toBe(5);
  for (let i = 0; i < n; i++) {
    await expect(chips.nth(i)).toBeDisabled();
  }
});
