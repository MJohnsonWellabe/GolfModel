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
/**
 * Seed the device as one that has already finished a round.
 *
 * PROGRESSIVE DISCLOSURE hides the secondary systems — Records, Store, Season
 * Pass, tournaments, the daily surfaces — until a device completes its first
 * round, so a first-time player sees core golf and nothing else. Every spec that
 * opens one of those surfaces has to say it is a returning device, or it waits
 * forever on an element that is deliberately hidden and reports a timeout that
 * looks like a broken overlay.
 *
 * Must run BEFORE `page.goto` — it is an init script, and the landing reads the
 * flag as it paints.
 */
export async function seedReturningDevice(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'johnsons-golf-device-settings-v1',
      JSON.stringify({ sound: 0.8, ambience: 0.2, reducedMotion: false, clipCapture: false, firstRoundDone: true })
    );
  });
}

/**
 * Open one of the landing's four destinations.
 *
 * The landing is ONE PRIMARY ACTION plus four doors — Today, Compete, Locker,
 * More — and everything that used to be a stacked card or a nav button now
 * lives behind one of them. A spec that reaches for `#landingStore` or
 * `#recordsLink` has to open its door first; without this it waits forever on
 * an element that is deliberately behind a closed sheet, and reports a timeout
 * that reads like a broken overlay.
 */
export async function openDestination(
  page: Page,
  dest: 'today' | 'compete' | 'locker' | 'more'
): Promise<void> {
  const tile = page.locator(`.destTile[data-dest="${dest}"]`);
  await tile.waitFor({ state: 'visible', timeout: 30_000 });
  // 'click', because the tiles open the sheet on the RELEASE — a pointerdown
  // binding let the release land on whatever the sheet had just put under the
  // finger, which under More is the About link (an anchor: it navigated).
  await tile.dispatchEvent('click');
  await page.locator('#destSheet.on').waitFor({ timeout: 10_000 });
}

/**
 * Open the course/mode setup wizard.
 *
 * Which control does this depends on the `quickPlay` flag: with it OFF, "Play
 * Now" (`#landingPlay`) opens the wizard; with it ON, Play Now tees off
 * immediately and the wizard is "Course & mode" (`#landingSetup`) under the
 * Compete destination.
 */
export async function openSetupWizard(page: Page): Promise<void> {
  const play = page.locator('#landingPlay');
  const quick = await page.evaluate(() => {
    const el = document.getElementById('landingSetup');
    return !!el && el.style.display !== 'none';
  });
  if (!quick) {
    await play.dispatchEvent('pointerdown');
    return;
  }
  await openDestination(page, 'compete');
  await page.locator('#landingSetup').dispatchEvent('pointerdown');
}
