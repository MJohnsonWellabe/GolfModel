import { expect, test } from '@playwright/test';
import { openDestination, openSetupWizard, seedReturningDevice } from './support/wizard';

/** The online-tournaments overlay opens from the menu (Phase 8). With no
 *  Firebase configured it degrades to an honest "connect online" notice
 *  rather than erroring. */
test('online tournaments overlay opens from the menu', async ({ page }) => {
  await seedReturningDevice(page);
  // The strip-down (`focusedGame`) removes online tournaments outright, so a
  // spec ABOUT that surface asks for the un-stripped game. Not a stale
  // expectation — a different product shape, and both are real.
  await page.goto('/?ff.focusedGame=off');
  // Online Tournaments lives in the Profile pane now (outside the strip-down;
  // the Today pane retired in career round 2b).
  await openDestination(page, 'more');
  await page.waitForSelector('#tournyLink');
  await page.evaluate(() => (document.getElementById('tournyLink') as HTMLElement).dispatchEvent(new Event('click')));
  await page.waitForSelector('#tournaments .recInner');
  await expect(page.locator('#tournaments h2')).toContainText('Online Tournaments');
  await page.screenshot({ path: 'tests/visual/__shots__/tournaments.png' });
});

test('AI tournament is a wizard mode that skips the course step', async ({ page }) => {
  // The AI Tournament (which replaced the Ace Challenge) draws its own
  // three-course rota, so selecting it collapses the wizard to the Mode step
  // alone — there is nothing left to choose.
  //
  // This spec used to wait on `#nameInput` and a "Who's playing?" title. Both
  // predate the Locker Room: name, character, pal and style moved out of the
  // round flow entirely, so the wizard is now the per-round choices only. It
  // was waiting on a screen that had been deliberately deleted.
  await seedReturningDevice(page);
  await page.goto('/?ff.focusedGame=off'); // AI tournaments are a stripped mode
  // The mode cards live in the setup wizard. This spec pre-dates one-tap Play,
  // when the landing WAS the wizard, so it waited on a card that no longer
  // paints until the wizard is opened.
  await openSetupWizard(page);
  await page.waitForSelector('.modeCard[data-mode="aitour"]');
  await page.evaluate(() =>
    (document.querySelector('.modeCard[data-mode="aitour"]') as HTMLElement).dispatchEvent(new Event('pointerdown'))
  );
  await expect(page.locator('.modeCard[data-mode="aitour"]')).toHaveClass(/sel/);
  const steps = await page.$$eval('.sdot .lbl', (els) => els.map((e) => e.textContent));
  expect(steps, `steps: ${steps.join(', ')}`).toEqual(['Mode']);
  // The tell that matters: no Course step, because the rota picks the courses.
  expect(steps).not.toContain('Course');
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
  await page.goto('/?lb=https://rtdb.test&ff.focusedGame=off');
  await openDestination(page, 'more');
  await page.waitForSelector('#tournyLink');
  await page.evaluate(() => (document.getElementById('tournyLink') as HTMLElement).dispatchEvent(new Event('click')));
  await page.waitForSelector('#tourCreate');
  await page.evaluate(() => (document.getElementById('tourCreate') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  // Creating now starts with a course picker — everyone plays the creator's pick.
  await page.waitForSelector('#tourBody .modeCard');
  await page.evaluate(() => (document.querySelector('#tourBody .modeCard') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('.tourCode');
  await expect(page.locator('.tourCode')).toHaveText(/^JG-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await expect(page.locator('.tourShare')).toContainText('?t=JG-');

  // "Play my round" routes through the setup wizard, where mode and course are
  // both locked to the creator's pick — so there is exactly one step left, and
  // it is a confirmation. (This asserted a Name/Character/Pals/Style wizard,
  // which moved wholesale into the Locker Room.)
  await page.evaluate(() => (document.getElementById('tourPlay') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('#setup .sdot');
  const steps = await page.$$eval('.sdot .lbl', (els) => els.map((e) => e.textContent));
  expect(steps, `steps: ${steps.join(', ')}`).toEqual(['Ready']);
  await expect(page.locator('.stepTitle')).toContainText('Ready to play');
});
