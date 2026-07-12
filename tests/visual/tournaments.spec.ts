import { expect, test } from '@playwright/test';

/** The online-tournaments overlay opens from the menu (Phase 8). With no
 *  Firebase configured it degrades to an honest "connect online" notice
 *  rather than erroring. */
test('online tournaments overlay opens from the menu', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#tournyLink');
  await page.evaluate(() => (document.getElementById('tournyLink') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('#tournaments .recInner');
  await expect(page.locator('#tournaments h2')).toContainText('Online Tournaments');
  await page.screenshot({ path: 'tests/visual/__shots__/tournaments.png' });
});

test('AI tournament is a wizard mode that skips the course step', async ({ page }) => {
  // The AI Tournament (which replaced the Ace Challenge) draws its own
  // three-course rota, so selecting it jumps the wizard straight from Mode to
  // Name — no Course step.
  await page.goto('/');
  await page.waitForSelector('.modeCard[data-mode="aitour"]');
  await page.evaluate(() =>
    (document.querySelector('.modeCard[data-mode="aitour"]') as HTMLElement).dispatchEvent(new Event('pointerdown'))
  );
  await page.evaluate(() => (document.getElementById('nextBtn') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('#nameInput');
  await expect(page.locator('.stepTitle')).toContainText("Who's playing?");
  await page.screenshot({ path: 'tests/visual/__shots__/aitour-wizard.png' });
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
