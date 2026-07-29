import { expect, test } from '@playwright/test';

/**
 * TWO SEASONS, REACHED BY CLICKING.
 *
 * The picker and the archive already had coverage (stage2to6.spec.ts), but it
 * forged the state with `__seasons(true)` — so it proved the SCREENS worked
 * while the thing the owner actually reported went unnoticed: no solo path ever
 * added a season, so the picker had nothing to pick from and the "Switch
 * season" row (gated on `otherSeasons.length`) never rendered. The feature was
 * complete and unreachable, twice reported as missing.
 *
 * This spec forges nothing. It walks from the landing to the career hub and
 * starts a second season with the button a player would press.
 *
 *   npx playwright test -c playwright.config.ts tests/visual/seasonAdd.spec.ts
 */

type Seasons = { keys: string[]; activeId: string | null };

const seasons = (page: import('@playwright/test').Page): Promise<Seasons> =>
  page.evaluate(() => (window as unknown as { __seasons: (s?: boolean) => Seasons }).__seasons());

test('season · a solo player can start a second season from the hub', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __seasons?: unknown }).__seasons);

  // A career first — the tour is the Pro's story, and the hub sends a
  // career-less player to the Locker instead of minting a season.
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown');
  await page.locator('#proName').fill('Season Tester');
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');
  await page.locator('#lkBack').dispatchEvent('click');

  // The first season is born in the hub, exactly as in real play — nothing
  // here is forged.
  await page.evaluate(() => (window as unknown as { __seasonView: (v: string) => void }).__seasonView('hub'));
  await page.waitForTimeout(700);
  const before = await seasons(page);
  expect(before.keys.length, 'the hub mints the first season on arrival').toBe(1);

  // THE ROW MUST BE THERE WITH ONLY ONE SEASON. This is the regression: it was
  // gated on a second season already existing.
  const row = page.locator('#thSwitch');
  await expect(row, 'no way in to the season picker from a single-season hub').toBeVisible();
  await row.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/visual/__shots__/season/picker-one-season.png' });

  await expect(page.locator('#thAddSeason')).toBeVisible();
  await page.locator('#thAddSeason').click();
  await page.waitForTimeout(700);

  const after = await seasons(page);
  expect(after.keys.length, `keys: ${after.keys.join(',')}`).toBe(2);
  expect(after.activeId, 'the new season becomes the one being played').not.toBe(before.activeId);
  // The first season is still THERE — added alongside, not replaced.
  expect(after.keys).toContain(before.keys[0]);

  // And the picker now offers both, by name, with distinct numbers.
  await page.locator('#thSwitch').click();
  await page.waitForTimeout(500);
  const names = await page.locator('.seasonPick .cnName').allInnerTexts();
  expect(names.length).toBe(2);
  expect(new Set(names.map((n) => n.replace(' — playing now', ''))).size, `duplicate names: ${names.join(' | ')}`).toBe(2);
  await page.screenshot({ path: 'tests/visual/__shots__/season/picker-two-seasons.png' });

  // Switching back reaches the original, and the new one is still in the map.
  await page.locator(`.seasonPick[data-season="${before.keys[0]}"]`).click();
  await page.waitForTimeout(500);
  const back = await seasons(page);
  expect(back.activeId).toBe(before.keys[0]);
  expect(back.keys.length).toBe(2);

  if (errors.length) throw new Error(errors.join('\n'));
});
