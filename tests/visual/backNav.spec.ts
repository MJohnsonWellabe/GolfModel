import { expect, test } from '@playwright/test';

/**
 * BACK GOES WHERE YOU CAME FROM.
 *
 * Every overlay in main.ts closes by hiding itself and letting whatever is
 * underneath show through. That is correct only while a screen has ONE caller,
 * and the Locker Room has seven. Six of them hide their own screen on the way
 * in, so hiding the Locker on the way out dropped the player on the landing —
 * the owner: "the menus when you improve your pro always go back to the main
 * menu rather than where you came from."
 *
 * The regression is invisible to a unit test (it is all DOM display state) and
 * invisible to a screenshot (both destinations look fine on their own), so it
 * needs a walk.
 */
test('nav · Improve your Pro returns to the tour hub, not the landing', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __seasons?: unknown }).__seasons);
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });

  // A career, so the hub is the real thing rather than its career-less variant.
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown');
  await page.locator('#proName').fill('Nav Tester');
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');
  await page.locator('#lkBack').dispatchEvent('click');
  await expect(page.locator('#lockerRoom')).toBeHidden();

  // Landing → tour hub → Improve your Pro → Done.
  await page.evaluate(() => (window as unknown as { __seasonView: (v: string) => void }).__seasonView('hub'));
  await expect(page.locator('#tourHub')).toBeVisible();
  await page.locator('#thTrain').click();
  await expect(page.locator('#lockerRoom')).toBeVisible();
  await expect(page.locator('#tourHub'), 'the hub hides itself on the way in').toBeHidden();

  await page.locator('#lkBack').click();
  await expect(page.locator('#lockerRoom')).toBeHidden();
  // THE ASSERTION. Before the fix this was the landing.
  await expect(page.locator('#tourHub'), 'Done should return to the tour hub').toBeVisible();

  if (errors.length) throw new Error(errors.join('\n'));
});

test('nav · the Locker opened from the landing still closes to the landing', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __startRound?: unknown }).__startRound);
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });

  // The other half of the contract: a screen reached from the root must NOT
  // acquire a return, or Back would bounce somewhere the player never was.
  await page.locator('#landingLocker').dispatchEvent('click');
  await expect(page.locator('#lockerRoom')).toBeVisible();
  await page.locator('#lkBack').click();
  await expect(page.locator('#lockerRoom')).toBeHidden();
  await expect(page.locator('#tourHub')).toBeHidden();
  await expect(page.locator('#landingPlay')).toBeVisible();

  if (errors.length) throw new Error(errors.join('\n'));
});

test('nav · Store opened from the Locker returns to the Locker', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __startRound?: unknown }).__startRound);
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('#landingLocker').dispatchEvent('click');
  await expect(page.locator('#lockerRoom')).toBeVisible();
  await page.locator('#lkStore').click();
  await expect(page.locator('#store')).toBeVisible();
  await expect(page.locator('#lockerRoom'), 'the Locker hides itself on the way in').toBeHidden();

  await page.locator('#storeBack').click();
  await expect(page.locator('#store')).toBeHidden();
  await expect(page.locator('#lockerRoom'), 'Back should return to the Locker').toBeVisible();

  // ...and one more Back unwinds to the landing, not to the Store again.
  await page.locator('#lkBack').click();
  await expect(page.locator('#lockerRoom')).toBeHidden();
  await expect(page.locator('#landingPlay')).toBeVisible();

  if (errors.length) throw new Error(errors.join('\n'));
});
