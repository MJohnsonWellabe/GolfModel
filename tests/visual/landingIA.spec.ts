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

  // The Choose-course action and the tiles are reachable too — an action you
  // must scroll to find is the same failure one row further down.
  const choose = (await page.locator('#landingChoose').boundingBox())!;
  expect(choose.y + choose.height, 'Choose course is below the fold').toBeLessThanOrEqual(PHONE.height);
  for (const dest of ['destTour', 'destBoards', 'destLocker', 'destMore']) {
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
    // 'today' retired (career round 2b): the Tour tile acts directly and the
    // daily surfaces live under the 🔥 chip's popup.
    ['locker', 'Locker'],
    // The id stays 'more'; what the player READS is Profile now.
    ['more', 'Profile']
  ] as const) {
    await openDestination(page, dest);
    await expect(page.locator('#destSheetTitle')).toHaveText(title);
    // Exactly one pane is showing — panes that leak into each other are the
    // usual way a sheet-based menu rots.
    await expect(page.locator('.destPane.on')).toHaveCount(1);
    await page.locator('#destSheetClose').dispatchEvent('click');
    await expect(page.locator('#destSheet')).not.toHaveClass(/on/);
  }
});

test('nothing that used to be on the landing became unreachable', async ({ page }) => {
  await page.setViewportSize(PHONE);
  // The FULL game's inventory. The strip-down (`focusedGame`) deliberately
  // removes several of these; that shape is asserted separately below, and
  // conflating the two would let a genuine regression hide behind the flag.
  await landing(page, '?ff.focusedGame=off');

  // The exact list of things the old stack used to offer, at their NEW homes.
  // If a rework ever drops one, this is what says so.
  const behind: Array<[Parameters<typeof openDestination>[1], string]> = [
    ['locker', '#landingSeason'],
    ['locker', '#landingStore'],
    ['locker', '#landingLocker'],
    ['more', '#landingProfile'],
    ['more', '#landingSettings']
  ];
  for (const [dest, sel] of behind) {
    await openDestination(page, dest);
    await expect(page.locator(sel), `${sel} is not reachable under ${dest}`).toBeVisible();
    await page.locator('#destSheetClose').dispatchEvent('click');
  }

  // The rest moved to direct surfaces rather than panes:
  // the wizard is the Choose button, the records are the Leaderboards tile,
  // and EVERYTHING daily is the streak chip's popup (owner, career 2b: "just
  // put all the daily parts under there") — challenge, hole of the day,
  // ghost race, weekly.
  await expect(page.locator('#landingChoose')).toBeVisible();
  await expect(page.locator('#destTour')).toBeVisible();
  await page.locator('#destBoards').dispatchEvent('click');
  await expect(page.locator('#records')).toBeVisible();
  await page.locator('#recBack').dispatchEvent('click');
  await page.locator('#psStreak').dispatchEvent('click');
  await expect(page.locator('#dailyPopup')).toHaveClass(/on/);
  await expect(page.locator('#dailyCard')).toBeVisible();
  await expect(page.locator('#dailyHoleCard')).not.toBeEmpty();
  await expect(page.locator('#ghostCard')).toBeVisible();
  await expect(page.locator('#weeklyCard')).toBeVisible();
  await page.locator('#dpClose').dispatchEvent('click');
  // And About the game lives in the profile's Settings tab.
  await openDestination(page, 'more');
  await page.locator('#landingSettings').dispatchEvent('click');
  await expect(page.locator('.aboutGameRow')).toBeVisible();
});

test('each tile says what is behind it', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await landing(page);
  // A door with nothing written on it is worse than the stack of cards it
  // replaced: the daily hole and the streak have to keep advertising themselves
  // from the top level, or the retention layer is buried.
  for (const dest of ['destTour', 'destBoards', 'destLocker', 'destMore']) {
    const sub = await page.locator(`#${dest} .dtSub`).innerText();
    expect(sub.trim().length, `${dest} has no headline`).toBeGreaterThan(0);
  }
  // The Tour tile names the gate or the event — never a blank door.
  expect(await page.locator('#destTour .dtSub').innerText()).toMatch(/career|event/i);
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

  // Course choice and leaderboards are core golf and stay.
  await expect(page.locator('#landingChoose')).toBeVisible();
  await expect(page.locator('#destBoards')).toBeVisible();

  // The ghost race is one of three opponent systems; the daily hole carries it.
  await page.locator('#psStreak').dispatchEvent('click');
  await expect(page.locator('#dailyPopup')).toHaveClass(/on/);
  await expect(page.locator('#ghostCard')).toBeEmpty();
  await expect(page.locator('#dailyHoleCard')).not.toBeEmpty();
});

/**
 * THE LANDING NEVER SCROLLS SIDEWAYS.
 *
 * Owner, with a screenshot of the menu shifted off its right edge: "sometimes
 * the menu loads with left to right scroll when you have a major that's 2/3
 * rounds complete."
 *
 * The destination tiles are grid items, so `min-width: auto` applied: a tile
 * could not shrink below its min-content width, and `.dtSub` is
 * `white-space: nowrap`, whose min-content width is the ENTIRE string.
 * `overflow: hidden` on the sub made it ellipsis once the tile was narrow, but
 * did nothing about the min-content it handed up — so a long subtitle widened
 * the column, the grid, and then the whole page. A major mid-play is what makes
 * one long enough ("Event 4/16 · The Spring Invitational · round 2/3").
 *
 * Driven by writing the subtitle directly rather than by playing two rounds of
 * a major: the rule under test is a layout invariant, and it should hold for
 * ANY subtitle the game ever puts there, not just today's longest one.
 */
test('no tile subtitle, however long, can scroll the landing sideways', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(PHONE);
  await landing(page);

  const overflow = async (): Promise<number> =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  expect(await overflow(), 'the landing overflowed before we even touched it').toBeLessThanOrEqual(0);

  // The reported case, then something considerably worse.
  for (const sub of [
    'Event 4/16 · The Spring Invitational · round 2/3',
    'Event 16/16 · The Grand Championship of the Long Sands · round 3/3 · playoff'
  ]) {
    await page.evaluate((text) => {
      document.querySelectorAll<HTMLElement>('.destTile .dtSub').forEach((el) => (el.textContent = text));
    }, sub);
    expect(await overflow(), `"${sub}" widened the page`).toBeLessThanOrEqual(0);
    // And the tile still fits its half of the grid.
    const tile = await page.locator('#destTour').boundingBox();
    expect(tile!.width, 'the tile outgrew the viewport').toBeLessThanOrEqual(PHONE.width);
  }
});

/**
 * THE PLAYER WITH NOWHERE TO SAVE.
 *
 * Owner: *"For anyone who hasn't created an account, on the main menu swap the
 * quick start button and the profile button and make the profile button say
 * 'create an account to save progress'… make the CTA more prevalent."*
 *
 * A guest's coins, Pro and records live on one device and die with it, so the
 * account is the most valuable thing on the screen — and it used to be a
 * `.destLink` behind a door called "Profile". The swap is by WEIGHT, not by
 * moving nodes (the landing has been burned by per-repaint DOM moves before —
 * see `updateLearnEntry`), so what this measures is which button is bigger.
 */
test('signed out, the account CTA outranks Quick Start', async ({ page }) => {
  await page.setViewportSize(PHONE);
  // `?env=prod` is the suite's existing way to get a build where accounts EXIST
  // (profile.spec.ts uses it for the same reason). Development ships an empty
  // Firebase key, so the whole account layer — this CTA included — is correctly
  // dormant there, and a test against the dev build would measure nothing.
  await landing(page, '?env=prod');

  const cta = page.locator('#landingAccountCta');
  const play = page.locator('#landingPlay');
  await expect(cta, 'a guest is offered an account up front').toBeVisible();
  await expect(cta).toContainText(/create an account/i);

  const ctaBox = (await cta.boundingBox())!;
  const playBox = (await play.boundingBox())!;
  // Above it, and taller than it — "more prevalent" measured rather than
  // asserted. Quick Start is still there and still one tap; it is simply no
  // longer the loudest thing on a screen that cannot save anything.
  expect(ctaBox.y, 'the CTA comes first').toBeLessThan(playBox.y);
  expect(ctaBox.height, `CTA ${ctaBox.height}px vs Quick Start ${playBox.height}px`).toBeGreaterThan(playBox.height);
  // …and they are not welded together. The panel spaces its children by margin
  // and .landingPlay has none (nothing used to sit above it), so the first
  // version of this shipped with the two buttons flush — the gate measured
  // their order and size but never the gap between them.
  const gap = playBox.y - (ctaBox.y + ctaBox.height);
  expect(gap, `only ${Math.round(gap)}px between the CTA and Quick Start`).toBeGreaterThanOrEqual(8);

  // …and the WHOLE guest layout still obeys rule 5. Adding a hero is exactly
  // how a landing grows past the fold, and a guest is the player least willing
  // to hunt for the button that starts the game.
  for (const id of ['landingAccountCta', 'landingPlay', 'landingChoose', 'destTour', 'destBoards', 'destLocker', 'destMore']) {
    const box = (await page.locator(`#${id}`).boundingBox())!;
    expect(box.y + box.height, `${id} ends at ${Math.round(box.y + box.height)}px`).toBeLessThanOrEqual(PHONE.height);
  }

  // The door that also holds Settings stays in the grid — a guest needs sound,
  // graphics and the crash readout exactly as much as anyone — but it now says
  // what it is really for.
  const more = page.locator('#destMore');
  await expect(more).toBeVisible();
  await expect(more).toContainText(/account/i);
  await expect(more).toContainText(/save your progress/i);
});

test('the CTA lands on the screen with the sign-in button, in one tap', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await landing(page, '?env=prod');
  await page.locator('#landingAccountCta').click();
  // Profile → Settings, where the account row lives. A call to action that
  // drops you in a menu is not a call to action.
  await expect(page.locator('#linkGoogle')).toBeVisible({ timeout: 15_000 });
});
