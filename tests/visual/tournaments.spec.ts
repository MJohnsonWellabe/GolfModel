import { expect, test } from '@playwright/test';
import { openSetupWizard, seedReturningDevice } from './support/wizard';

/** The AI TOURNAMENT mode (three rounds, three courses, a simulated field).
 *  The online code-sharing tournaments this file also covered were removed in
 *  pass 9 at the owner's request — the Tour Season is the competitive spine
 *  now, and a shared season is the social one. */

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
