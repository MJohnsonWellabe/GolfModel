import { expect, test } from '@playwright/test';

/** The tournaments + ace-challenge overlays open from the menu (Phase 8). With
 *  no Firebase configured they degrade to an honest "connect online" notice
 *  rather than erroring. */
test('tournaments overlay opens from the menu', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#tournyLink');
  await page.evaluate(() => (document.getElementById('tournyLink') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('#tournaments .recInner');
  await expect(page.locator('#tournaments h2')).toContainText('Tournaments');
  await page.screenshot({ path: 'tests/visual/__shots__/tournaments.png' });
});

test('ace challenge is a wizard mode that frames a par-3 choice', async ({ page }) => {
  // Ace Challenge moved from a menu link to a game mode (after Scramble); the
  // Course step then lets you choose which course's par 3 to tee off.
  await page.goto('/');
  await page.waitForSelector('.modeCard[data-mode="aces"]');
  await page.evaluate(() =>
    (document.querySelector('.modeCard[data-mode="aces"]') as HTMLElement).dispatchEvent(new Event('pointerdown'))
  );
  await page.evaluate(() => (document.getElementById('nextBtn') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('.modeCard[data-course]');
  await expect(page.locator('.stepTitle')).toContainText('par 3');
  await page.screenshot({ path: 'tests/visual/__shots__/aces.png' });
});

/** Create a tournament against a mocked RTDB (via the ?lb= override) and verify
 *  the shareable code and standings glue render (Phase 8). */
test('create a tournament surfaces a shareable code', async ({ page }) => {
  const store: Record<string, unknown> = {};
  await page.route('**rtdb.test/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/\.json$/, '');
    if (req.method() === 'PUT') {
      store[path] = JSON.parse(req.postData() || 'null');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(store[path]) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(store[path] ?? null) });
  });
  await page.goto('/?lb=https://rtdb.test');
  await page.waitForSelector('#tournyLink');
  await page.evaluate(() => (document.getElementById('tournyLink') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('#tourCreate');
  await page.evaluate(() => (document.getElementById('tourCreate') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('.tourCode');
  await expect(page.locator('.tourCode')).toHaveText(/^JG-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await expect(page.locator('.tourShare')).toContainText('?t=JG-');
});
