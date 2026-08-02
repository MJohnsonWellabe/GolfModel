import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * THE CAREER LANDING and the sticky menu actions.
 *
 * Owner: "You should rework the career menu there should be a career landing,
 * button to look at schedule, play the next event, see career records, improve
 * your player, whatever else makes sense." And: "From tour season there should
 * be a button to take you directly to the screen to spend your cp." And: "On
 * any menu if there are buttons at the bottom make sure they're always there
 * and you don't have to scroll down to see them just freeze the pane."
 *
 * The last one is worth automating hardest, because it is invisible until a
 * pane gets long: the way OUT of a menu sat below the fold, and nothing in the
 * suite would have noticed it come back.
 */

const PHONE = { width: 390, height: 844 };

/** A device with a career Pro, parked on the career landing. */
async function openCareer(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown');
  await page.locator('#proName').fill('Landing Pro');
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');
  await page.locator('#lkBack').dispatchEvent('click');
  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  // No season starts itself anymore (owner: "there shouldn't be an instant
  // new season started") — every test below wants a live one to land on.
  await hub.locator('#thStartSeason').dispatchEvent('click');
  await expect(hub.locator('#thPlay')).toBeVisible();
}

test('the career landing offers each destination and names the CP waiting', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openCareer(page);
  await page.evaluate(() => (window as never as { __grantCp: (n: number) => void }).__grantCp(120));
  // Re-enter so the landing repaints with the banked CP.
  await page.locator('#tourHub #thBack').dispatchEvent('click');
  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');

  // Every destination the owner asked for, on one screen.
  await expect(hub.locator('#thPlay')).toBeVisible();
  await expect(hub.locator('#thSched')).toBeVisible();
  await expect(hub.locator('#thRecords')).toBeVisible();
  await expect(hub.locator('#thTrain')).toBeVisible();

  // The CP button carries the balance, so "have I got anything to spend?" is
  // answered without opening it — and is highlighted while CP is unspent.
  await expect(hub.locator('#thTrain')).toContainText('CP to spend');
  await expect(hub.locator('#thTrain')).toHaveClass(/hot/);

  // The schedule is a SUB-screen now: the landing must not carry the rows.
  expect(await hub.locator('.thSched').count()).toBe(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('schedule and standings open, list the season, and come back', async ({ page }) => {
  test.setTimeout(180_000);
  await openCareer(page);
  await page.locator('#tourHub #thSched').dispatchEvent('click');
  await expect(page.locator('#tourHub .thSched')).toBeVisible();
  // Every event of the season is listed there, and nowhere else.
  expect(await page.locator('#tourHub .thEv').count()).toBeGreaterThan(8);
  await page.locator('#tourHub #thSchedBack').dispatchEvent('click');
  await expect(page.locator('#tourHub #thPlay')).toBeVisible();
});

test('improve-your-Pro lands directly on the stat spend', async ({ page }) => {
  test.setTimeout(180_000);
  await openCareer(page);
  await page.locator('#tourHub #thTrain').dispatchEvent('click');
  // The Locker's Style tab IS the spend screen — one tap, not three.
  await expect(page.locator('#lockerRoom')).toBeVisible();
  await expect(page.locator('#lockerRoom .lkTab[data-tab="style"]')).toHaveClass(/sel|on/);
});

test('a menu that overflows keeps its buttons on screen', async ({ page }) => {
  test.setTimeout(180_000);
  await openCareer(page);
  // The record book is the longest pane in the game once a career has history.
  await page.locator('#tourHub #thRecords').dispatchEvent('click');
  const back = page.locator('#tourHub #thRecBack');
  await expect(back).toBeVisible();
  // The rule must be in force whether or not this particular pane overflows.
  await expect(back).toHaveCSS('position', 'sticky');

  const pane = page.locator('#tourHub .recInner');
  const overflows = await pane.evaluate((el) => el.scrollHeight > el.clientHeight + 4);
  if (overflows) {
    // Scroll to the TOP — the state in which an unpinned trailing button is off
    // screen — and require the button still be inside the pane's visible box.
    // This is the assertion the owner's complaint is about.
    await pane.evaluate((el) => (el.scrollTop = 0));
    const inView = await back.evaluate((btn) => {
      const scroller = btn.closest('.recInner') as HTMLElement;
      const b = btn.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      return b.bottom <= s.bottom + 2 && b.top >= s.top - 2;
    });
    expect(inView, 'the trailing button is pinned inside the scrolled pane').toBe(true);
  }
});
