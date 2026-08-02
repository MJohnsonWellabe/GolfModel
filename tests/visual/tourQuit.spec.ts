import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * QUITTING A SEASON on the real UI (owner pass 9b: "you should be able to quit
 * a season and start a new one whenever you want. the partial season counts
 * for the golfer"). The two halves of that promise are what this walks: the
 * door is always there, and going through it puts a line on the golfer's
 * record.
 */

const PHONE = { width: 390, height: 844 };

async function startCareer(page: import('@playwright/test').Page, name: string): Promise<void> {
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown');
  await page.locator('#proName').fill(name);
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');
  await page.locator('#lkBack').dispatchEvent('click');
}

type TourProbe = { seasonNo: number; played: number };
const probe = (page: import('@playwright/test').Page): Promise<TourProbe> =>
  page.evaluate(() => (window as never as { __tour: () => TourProbe }).__tour());

test('end a season part-way: it counts, and a fresh one is up', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });
  await startCareer(page, 'Quitter Pro');

  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  // No season starts itself anymore — start one so there's something to quit.
  await hub.locator('#thStartSeason').dispatchEvent('click');

  // A season nobody has played offers a free reroll, not an ending.
  await expect(hub.locator('#thQuit')).toContainText('New schedule');

  // Bank a few events without playing them out shot by shot (the round path
  // has its own specs); this is about the season boundary.
  await page.evaluate(() => {
    const w = window as never as { __forgeTourResult: (k: string, s?: number, r?: number, p?: number) => boolean };
    return w.__forgeTourResult('win'); // gives the Pro a record to sit beside
  });
  await page.evaluate(() => {
    const p = (window as never as { __seasonProgress: (n: number) => void }).__seasonProgress;
    p(6);
  });
  await page.locator('#destSheetClose').dispatchEvent('click').catch(() => undefined);
  await page.locator('#destTour').dispatchEvent('click');
  await expect(hub).toContainText('6/16 events');
  await expect(hub.locator('#thQuit')).toContainText('End this season');

  // CANCEL leaves everything exactly as it was.
  await hub.locator('#thQuit').dispatchEvent('click');
  const modal = page.locator('.storeConfirm');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('counts as one of their 10 seasons');
  await expect(modal).toContainText('purse is forfeited');
  await modal.locator('#quitSeasonNo').dispatchEvent('click');
  await expect(modal).toBeHidden();
  expect((await probe(page)).played).toBe(6);
  expect((await probe(page)).seasonNo).toBe(1);

  // Confirm for real. The arming window means the Yes has to be a second,
  // deliberate tap — wait it out, as a human would.
  await hub.locator('#thQuit').dispatchEvent('click');
  await page.waitForTimeout(400);
  await page.locator('.storeConfirm #quitSeasonYes').dispatchEvent('click');
  await expect(page.locator('.storeConfirm')).toHaveCount(0);

  // Season 2 is up, empty…
  await expect.poll(async () => (await probe(page)).seasonNo, { timeout: 20_000 }).toBe(2);
  expect((await probe(page)).played).toBe(0);
  await expect(hub).toContainText('Tour Season 2');

  // …and the abandoned one still counts toward the golfer's career — the
  // record book is organized by stat now (see tourRecords.spec.ts), and
  // "Seasons played" counts a quit season exactly like a finished one.
  await hub.locator('#thRecords').dispatchEvent('click');
  const seasonsPlayedBlock = hub.locator('.boardBlock', { hasText: 'Seasons played' });
  await expect(seasonsPlayedBlock.locator('.recRow', { hasText: 'Quitter Pro' })).toContainText('1/10');

  expect(errors, errors.join('\n')).toHaveLength(0);
});
