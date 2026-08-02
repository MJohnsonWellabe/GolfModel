import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * THE RECORD BOOK on the real UI (owner, pass 1: "inside the tour screen
 * there should be a way to access past results by golfer. so I can see
 * career wins, major wins and season placements. for any golfer I've used" —
 * pass 2: "stack up the golfer records from career tour seasons differently.
 * show the major wins in a section, tourney wins in a section, season
 * points, seasons played, etc. all separate sections rather than separating
 * by golfer" — pass 3: "make the top part of the career records part
 * somehow a grid that shows golfers names across the top, majors down the
 * left and a number of times they've won in the grid"): the hub carries a
 * Golfer records door — reachable even with no season active — a fresh Pro
 * qualifies for nothing yet, so every section reads "Nobody yet"; recorded
 * results — stamped through the REAL recording functions — land the golfer
 * in the sections (and grid column) they qualify for.
 */

const PHONE = { width: 390, height: 844 };

test('the hub opens the record book: wins, majors, season points and championships by section', async ({
  page
}) => {
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

  // The hub carries the door; a fresh Pro qualifies for nothing, so every
  // section is present but reads its own empty state.
  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  await hub.locator('#thRecords').dispatchEvent('click');
  await expect(hub).toContainText('Golfer records');
  await expect(hub).toContainText('Major wins');
  await expect(hub).toContainText('Tour wins');
  await expect(hub).toContainText('Best season points');
  await expect(hub).toContainText('Seasons played');
  await expect(hub).toContainText('Season championships');
  await expect(hub).toContainText('Nobody yet');
  await expect(hub).not.toContainText('Records Pro');

  // Stamp a career through the real recording functions: two wins (one a
  // major) and two finished seasons — S1 3rd in points, S2 the champion.
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

  // Re-open the book: each qualifying stat lands the Pro in its own section.
  await hub.locator('#thRecBack').dispatchEvent('click');
  await hub.locator('#thRecords').dispatchEvent('click');

  // Major wins is a grid now: golfers across the top, majors down the left,
  // a win COUNT per cell — one column for Records Pro, one won cell (the
  // forged major), the rest of that row's majors at "–".
  const majorsGrid = hub.locator('.majorsGridWrap');
  await expect(majorsGrid).toContainText('Records Pro');
  const wonCells = majorsGrid.locator('td.won');
  await expect(wonCells).toHaveCount(1);
  await expect(wonCells).toContainText('1');

  const winsBlock = hub.locator('.boardBlock', { hasText: 'Tour wins' });
  await expect(winsBlock.locator('.recRow', { hasText: 'Records Pro' })).toContainText('2');

  // Best season points is S2's 3105, not S1's lower 1240 — a max, not a sum.
  const seasonPointsBlock = hub.locator('.boardBlock', { hasText: 'Best season points' });
  await expect(seasonPointsBlock.locator('.recRow', { hasText: 'Records Pro' })).toContainText('3105 pts (S2)');

  const seasonsPlayedBlock = hub.locator('.boardBlock', { hasText: 'Seasons played' });
  await expect(seasonsPlayedBlock.locator('.recRow', { hasText: 'Records Pro' })).toContainText('2/10');

  // Only S2 was a championship (rank 1) — S1's 3rd-place finish must not
  // appear here at all: this section is championships only.
  const championshipsBlock = hub.locator('.boardBlock', { hasText: 'Season championships' });
  const championshipRows = championshipsBlock.locator('.recRow', { hasText: 'Records Pro' });
  await expect(championshipRows).toHaveCount(1);
  await expect(championshipRows).toContainText('S2 · 3105 pts');

  // Back returns to the hub proper — no season was ever started in this
  // test, so it's still the explicit "Start Season" door, not mid-season.
  await hub.locator('#thRecBack').dispatchEvent('click');
  await expect(hub.locator('#thStartSeason')).toBeVisible();
  expect(errors, errors.join('\n')).toHaveLength(0);
});
