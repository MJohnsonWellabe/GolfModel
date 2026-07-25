import { expect, test } from '@playwright/test';
import { seedReturningDevice } from './support/wizard';

/** Records covers every course via tabs — not just the last-played one. */
test('records overlay offers a tab per course', async ({ page }) => {
  await seedReturningDevice(page);
  await page.goto('/');
  // Leaderboards is a first-class landing tile now — one tap.
  await page.waitForSelector('#destBoards');
  await page.evaluate(() => (document.getElementById('destBoards') as HTMLElement).dispatchEvent(new Event('click')));
  await page.waitForSelector('.recTab');
  // ONE TAB PER COURSE — derived, not remembered. This was pinned to 4 and went
  // red the moment the roster grew to 7; a hard-coded count tests the roster's
  // size, which nobody cares about, instead of the promise that no course is
  // missing from Records, which is the whole point of the tabs.
  const courses = await page.locator('.modeCard[data-course]').count().catch(() => 0);
  const tabs = await page.locator('.recTab').count();
  expect(tabs, `${tabs} tabs`).toBeGreaterThanOrEqual(4);
  if (courses) expect(tabs).toBe(courses);
  // Exactly one course is selected on open — WHICH one follows the last course
  // played, so naming it here would pin the spec to a default rather than to
  // the behaviour.
  await expect(page.locator('.recTab.sel')).toHaveCount(1);
  const first = await page.locator('.recTab.sel').innerText();
  // Switching course re-filters the list without leaving the overlay.
  const other = page.locator('.recTab').filter({ hasNotText: first }).first();
  const otherName = await other.innerText();
  await other.dispatchEvent('pointerdown');
  await expect(page.locator('.recTab.sel')).toHaveText(otherName);
  await expect(page.locator('#recList')).toBeVisible();
  // Let the round list settle (rows or the empty note) so the committed
  // baseline isn't a transient "Loading…" frame; tolerate offline runs.
  await page.waitForSelector('.recRow, .recEmpty', { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: 'tests/visual/__shots__/records.png' });
});
