import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * THE LANDING'S INFORMATION ARCHITECTURE.
 *
 * The panel had grown to ten stacked cards, so the screen answered "what can
 * this game do" rather than "what shall I do now", and on a phone the one thing
 * a player came for was below the fold. Design constitution rule 5 makes that a
 * hard requirement rather than a preference: **every primary action reachable
 * without scrolling**.
 *
 * A layout rule nobody measures is a layout rule that decays — the previous
 * version passed every spec in the suite while failing on the owner's phone —
 * so it is measured here, on the reference device, in pixels.
 */

/** The reference phone. Small enough to be honest, common enough to matter. */
const PHONE = { width: 360, height: 800 };

async function landing(page: import('@playwright/test').Page, query = ''): Promise<void> {
  await seedReturningDevice(page);
  await page.goto(`/${query}`);
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 30_000 });
}

test('the primary action is above the fold on a 360x800 phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await landing(page);

  const play = (await page.locator('#landingPlay').boundingBox())!;
  expect(play.y + play.height, `Play ends at ${Math.round(play.y + play.height)}px`).toBeLessThanOrEqual(
    PHONE.height
  );
  expect(play.y, 'Play starts off the top of the screen').toBeGreaterThanOrEqual(0);

  // And the doors are reachable too — an action you must scroll to find is the
  // same failure one row further down.
  for (const dest of ['destToday', 'destCompete', 'destLocker', 'destMore']) {
    const box = (await page.locator(`#${dest}`).boundingBox())!;
    expect(box.y + box.height, `${dest} ends at ${Math.round(box.y + box.height)}px`).toBeLessThanOrEqual(
      PHONE.height
    );
  }

  // Nothing scrolls in either direction.
  const over = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - window.innerWidth,
    y: (document.getElementById('landing') as HTMLElement).scrollHeight - window.innerHeight
  }));
  expect(over.x, 'the landing scrolls sideways').toBeLessThanOrEqual(0);
  expect(over.y, `the landing overflows by ${over.y}px`).toBeLessThanOrEqual(0);
});

test('every destination opens, names itself, and closes', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await landing(page);

  for (const [dest, title] of [
    ['today', 'Today'],
    ['compete', 'Compete'],
    ['locker', 'Locker'],
    ['more', 'More']
  ] as const) {
    await openDestination(page, dest);
    await expect(page.locator('#destSheetTitle')).toHaveText(title);
    // Exactly one pane is showing — panes that leak into each other are the
    // usual way a sheet-based menu rots.
    await expect(page.locator('.destPane.on')).toHaveCount(1);
    await page.locator('#destSheetClose').dispatchEvent('pointerdown');
    await expect(page.locator('#destSheet')).not.toHaveClass(/on/);
  }
});

test('nothing that used to be on the landing became unreachable', async ({ page }) => {
  await page.setViewportSize(PHONE);
  // The FULL game's inventory. The strip-down (`focusedGame`) deliberately
  // removes several of these; that shape is asserted separately below, and
  // conflating the two would let a genuine regression hide behind the flag.
  await landing(page, '?ff.focusedGame=off');

  // The exact list of things the ten-card stack used to offer. If a rebuild
  // ever drops one, this is what says so.
  const behind: Array<[Parameters<typeof openDestination>[1], string]> = [
    ['today', '#dailyHoleCard'],
    ['today', '#ghostCard'],
    ['today', '#dailyCard'],
    ['today', '#weeklyCard'],
    ['compete', '#landingSetup'],
    ['compete', '#tournyLink'],
    ['compete', '#recordsLink'],
    ['locker', '#landingSeason'],
    ['locker', '#landingStore'],
    ['locker', '#landingLocker'],
    ['more', '#landingProfile'],
    ['more', '#landingAbout']
  ];
  for (const [dest, sel] of behind) {
    await openDestination(page, dest);
    await expect(page.locator(sel), `${sel} is not reachable under ${dest}`).toBeVisible();
    await page.locator('#destSheetClose').dispatchEvent('pointerdown');
  }
});

test('each tile says what is behind it', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await landing(page);
  // A door with nothing written on it is worse than the stack of cards it
  // replaced: the daily hole and the streak have to keep advertising themselves
  // from the top level, or the retention layer is buried.
  for (const dest of ['destToday', 'destCompete', 'destLocker', 'destMore']) {
    const sub = await page.locator(`#${dest} .dtSub`).innerText();
    expect(sub.trim().length, `${dest} has no headline`).toBeGreaterThan(0);
  }
  expect(await page.locator('#destToday .dtSub').innerText()).toMatch(/hole of the day|challenge|streak|tomorrow/i);
});

test('opening a destination does not press the thing underneath it', async ({ page }) => {
  // THE BUG: the tiles opened the sheet on POINTERDOWN, so the release landed
  // on whatever the sheet had just put under the finger. Under More that is the
  // "About the game" link — an anchor — so tapping More navigated straight off
  // the page and the menu was unusable. Same trap the locker room documents.
  //
  // Driven with real input rather than a dispatched event, because a synthetic
  // pointerdown cannot reproduce it: the whole failure lives in the gap between
  // the press and the release.
  await page.setViewportSize(PHONE);
  await landing(page);
  const tile = page.locator('#destMore');
  const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  await expect(page.locator('#destSheet')).toHaveClass(/on/);
  await expect(page.locator('#paneMore')).toHaveClass(/on/);
  // Still on the game, not on the marketing page.
  expect(page.url(), 'tapping More navigated away').not.toContain('marketing');
  await expect(page.locator('#landingPlay')).toBeVisible();
});

test('the strip-down removes systems rather than burying them', async ({ page }) => {
  // `focusedGame` is the decision to stop shipping four ways to play a round
  // and three ways to race somebody for a game with 21 holes. What it removes
  // has to be GONE from the menus — a hidden entry that still half-works is the
  // worst of both shapes.
  await page.setViewportSize(PHONE);
  await landing(page, '?ff.focusedGame=on');

  await openDestination(page, 'compete');
  await expect(page.locator('#tournyLink'), 'online tournaments survived the strip-down').toBeHidden();
  // Course & mode and Records are core golf and stay.
  await expect(page.locator('#landingSetup')).toBeVisible();
  await expect(page.locator('#recordsLink')).toBeVisible();
  await page.locator('#destSheetClose').dispatchEvent('pointerdown');

  // The ghost race is one of three opponent systems; the daily hole carries it.
  await openDestination(page, 'today');
  await expect(page.locator('#ghostCard')).toBeEmpty();
  await expect(page.locator('#dailyHoleCard')).not.toBeEmpty();
});
