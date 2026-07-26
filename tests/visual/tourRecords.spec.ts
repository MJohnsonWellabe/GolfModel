import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * THE RECORD BOOK on the real UI (owner: "inside the tour screen there should
 * be a way to access past results by golfer. so I can see career wins, major
 * wins and season placements. for any golfer I've used"): the hub carries a
 * Golfer records door; a fresh Pro reads as a blank page; recorded results —
 * stamped through the REAL recording functions — render as wins, majors, and
 * season placements per Pro.
 */

const PHONE = { width: 390, height: 844 };

test('the hub opens the record book: wins, majors, season placements per Pro', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });

  // A career Pro to hold the records.
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown');
  await page.locator('#proName').fill('Records Pro');
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');
  await page.locator('#lkBack').dispatchEvent('click');

  // The hub carries the door; a fresh Pro's page is blank but PRESENT.
  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  await hub.locator('#thRecords').dispatchEvent('click');
  await expect(hub).toContainText('Golfer records');
  await expect(hub).toContainText('Records Pro');
  await expect(hub).toContainText('Tour wins');
  await expect(hub).toContainText('No season finished yet');

  // Stamp a career through the real recording functions: two wins (one a
  // major) and two finished seasons.
  const forged = await page.evaluate(() => {
    const w = window as never as { __forgeTourResult: (k: string, s?: number, r?: number, p?: number) => boolean };
    return (
      w.__forgeTourResult('win') &&
      w.__forgeTourResult('major') &&
      w.__forgeTourResult('season', 1, 3, 1240) &&
      w.__forgeTourResult('season', 2, 1, 3105)
    );
  });
  expect(forged).toBe(true);

  // Re-open the book: the tallies and placements read per the design —
  // career wins, major wins, and one line per season.
  await hub.locator('#thRecBack').dispatchEvent('click');
  await hub.locator('#thRecords').dispatchEvent('click');
  const card = hub.locator('.thProCard', { hasText: 'Records Pro' });
  await expect(card).toContainText('Tour wins');
  await expect(card.locator('.recRow', { hasText: 'Tour wins' })).toContainText('2');
  await expect(card.locator('.recRow', { hasText: 'Majors' })).toContainText('1');
  await expect(card.locator('.recRow', { hasText: /^S1/ })).toContainText('3rd in points');
  await expect(card.locator('.recRow', { hasText: /^S1/ })).toContainText('1240 pts');
  await expect(card.locator('.recRow', { hasText: /^S2/ })).toContainText('Season champion');

  // Back returns to the hub proper.
  await hub.locator('#thRecBack').dispatchEvent('click');
  await expect(hub.locator('#thPlay')).toBeVisible();
  expect(errors, errors.join('\n')).toHaveLength(0);
});
