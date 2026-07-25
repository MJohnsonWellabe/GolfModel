import type { Page } from '@playwright/test';

/**
 * Open the course/mode setup wizard from the landing screen.
 *
 * Which control does this depends on the `quickPlay` flag: with it OFF, "Play
 * Now" (`#landingPlay`) opens the wizard; with it ON, Play Now tees off
 * immediately and the wizard moves to an explicit "Course & mode" entry
 * beneath it (`#landingSetup`).
 *
 * Three specs hard-coded `#landingPlay` and went red the moment quickPlay
 * defaulted on in dev — each one timing out on a wizard that never opened,
 * which reads like a broken wizard rather than a moved button. Taking whichever
 * entry the build actually offers keeps them testing what they mean to test on
 * either side of the flag.
 */
export async function openSetupWizard(page: Page): Promise<void> {
  const wizard = page.locator('#landingSetup');
  if (await wizard.isVisible()) await wizard.dispatchEvent('pointerdown');
  else await page.locator('#landingPlay').dispatchEvent('pointerdown');
}
