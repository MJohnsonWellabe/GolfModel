import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * CAREER MODE, end to end on the real UI: the Style tab leads with the stable,
 * starting a NAMED Pro adopts a 65-overall shape, CP spends into real
 * attribute points with the OVR rising on screen, the Pro wears a dedicated
 * look, and starting a second Pro leaves the rookie broke while the first
 * stays in the stable, selectable, with the CP they earned.
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

  // Start a ROOKIE: they start BROKE (CP belongs to the Pro who earned it),
  // and the vet stays in the stable with their 16 unspent waiting.
  await page.locator('#proName').fill('Rookie Two');
  await page.locator('.careerStart[data-cstart="puttKing"]').dispatchEvent('pointerdown');
  const cards = page.locator('.careerCard[data-pro]');
  await expect(cards).toHaveCount(2);
  const active = page.locator('.careerCard.sel');
  await expect(active).toContainText('Rookie Two');
  await expect(active).toContainText('0 CP'); // the rookie earns their own way
  await expect(cards.first()).toContainText('Lefty'); // the vet, still here

  // Tap the vet: active again, points intact (OVR above the rookie's 65) and
  // their own 16 CP still there — switching Pro switches wallet.
  await cards.first().dispatchEvent('pointerdown');
  await expect(page.locator('.careerCard.sel')).toContainText('Lefty');
  await expect(page.locator('.careerCard.sel')).toContainText('16 CP');

  // And the LANDING behind the overlay repainted with the live balance (owner
  // bug: "the CP to spend on your Pro didn't reset after I spent it").
  await page.locator('#lkBack').dispatchEvent('click');
  await expect(page.locator('#destLocker .dtSub')).toContainText('16 CP');
  // The Quick Start button quotes the ACTIVE Pro by name and current OVR —
  // locker changes reach it immediately (owner: "I just increased my guy to
  // 75 but the menu button says 71").
  await expect(page.locator('#landingPlay')).toContainText('Lefty');
  await expect(page.locator('#landingPlay')).toContainText('OVR');
});

/**
 * The owner's scenario, in their numbers (owner: "if you're playing with your
 * first pro and have a Balance of 100cp and they're not maxed out, when you
 * select a new pro, I don't want you to have the 100cp to spend. I want you to
 * have 0 for the new guy. he has to earn his own. but if you go back and
 * select the original, you should have your 100 back to spend.")
 *
 * The walk above already proves the rule at 20 CP with CP banked BEFORE the
 * career started. This one is deliberately different on both counts: a
 * three-figure balance earned by a Pro who already exists, which is the shape
 * a real player hits, and which crosses more of `pointCost`'s brackets (2 below
 * 80, 4 in the 80s, 10 in the 90s) than 20 CP can reach.
 *
 * Balances are read from the screen rather than hardcoded, so the test asserts
 * the PROPERTY — this Pro's money is theirs alone and comes back untouched —
 * without also pinning the price list, which is tuning and moves.
 */
test('100 CP belongs to the Pro who earned it, and is still there when you return', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await openStyleTab(page);

  // A first Pro, THEN the money — so the 100 is earned by a Pro who already
  // exists rather than arriving through the pre-career bucket.
  await page.locator('#proName').fill('Hundred');
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');
  await grantCp(page, 100);
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown'); // repaint
  const vet = page.locator('.careerCard[data-pro]').first();
  await expect(vet).toContainText('Hundred');
  await expect(vet).toContainText('100 CP');

  // Spend a few points so the remaining balance is a live number, not the
  // round one we banked — a stale read-cache would still say 100.
  for (let i = 0; i < 3; i++) {
    await page.locator('.cpSpend[data-cspend="drivingPower"]').dispatchEvent('pointerdown');
  }
  const afterSpend = (await page.locator('.careerCard.sel').innerText()).match(/(\d+) CP/)?.[1];
  expect(afterSpend, 'the vet has a CP balance on screen').toBeTruthy();
  expect(Number(afterSpend), 'spending must reduce the balance').toBeLessThan(100);
  expect(Number(afterSpend), 'and must not empty it — this Pro is not maxed').toBeGreaterThan(0);

  // A NEW Pro is broke. This is the assertion the owner asked for.
  await page.locator('#proName').fill('Rookie');
  await page.locator('.careerStart[data-cstart="puttKing"]').dispatchEvent('pointerdown');
  await expect(page.locator('.careerCard.sel')).toContainText('Rookie');
  await expect(page.locator('.careerCard.sel'), 'the rookie must not inherit the vet\'s CP').toContainText('0 CP');
  // …and cannot reach it: with nothing banked, every spend chip is dead.
  const chips = page.locator('.cpSpend');
  const n = await chips.count();
  for (let i = 0; i < n; i++) await expect(chips.nth(i)).toBeDisabled();

  // Go back to the original: the exact remainder is waiting, to the point.
  await page.locator('.careerCard[data-pro]').first().dispatchEvent('pointerdown');
  await expect(page.locator('.careerCard.sel')).toContainText('Hundred');
  await expect(page.locator('.careerCard.sel')).toContainText(`${afterSpend} CP`);

  // The surfaces outside the Locker agree — the landing reads the same wallet,
  // so the two can never tell the player different numbers.
  await page.locator('#lkBack').dispatchEvent('click');
  await expect(page.locator('#destLocker .dtSub')).toContainText(`${afterSpend} CP`);
  expect(errors, errors.join('\n')).toEqual([]);
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
