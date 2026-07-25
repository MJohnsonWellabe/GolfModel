import { expect, test } from '@playwright/test';
import { openSetupWizard } from './support/wizard';

/** Each course boots into a playable scene through the test hook (Phase 9).
 *  Guards the new Sable Bay (heavy water, island par 3) and Timberline
 *  (wooded, tree-in-fairway) geometry against render/loader crashes. */
for (const courseId of ['wildwood', 'sablebay', 'timberline', 'portjohnson']) {
  test(`${courseId} boots and reaches the aiming phase`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__startRound);
    await page.evaluate((id) => (window as any).__startRound({ name: 'Smoke', courseId: id }), courseId);
    await page.waitForFunction(() => !!(window as any).__slice3d);
    await page.evaluate(() => (window as any).__slice3d.skipIntro());
    await page.waitForFunction(() => (window as any).__slice3d.state.phase === 'aiming', undefined, { timeout: 20_000 });
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
}

/** A flaky/failed fetch for one nature prop must not blank the whole forest
 *  or crash the scene — natureModels.ts retries once before giving up on a
 *  key. Simulates the failure by aborting the FIRST nature-prop request the
 *  course makes; everything after it, including that key's retry, is allowed
 *  through normally.
 *
 *  Deliberately NOT pinned to a named asset. It was (`tree_spruce.glb`), and
 *  when the v2 Timberline rebuild changed its tree mix the route stopped
 *  matching anything — the spec then asserted a retry that never happened
 *  rather than the recovery it is named for. */
test('a flaky nature-prop fetch recovers via retry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let aborted = '';
  await page.route('**/models/nature/*.glb', (route) => {
    if (!aborted) {
      aborted = route.request().url();
      route.abort('failed');
    } else {
      route.continue();
    }
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  await page.evaluate((id) => (window as any).__startRound({ name: 'Smoke', courseId: id }), 'timberline');
  await page.waitForFunction(() => !!(window as any).__slice3d);
  await page.evaluate(() => (window as any).__slice3d.skipIntro());
  await page.waitForFunction(() => (window as any).__slice3d.state.phase === 'aiming', undefined, { timeout: 20_000 });
  expect(aborted, 'no nature prop was ever fetched — this course loaded no props').not.toBe('');
  expect(errors, errors.join('\n')).toHaveLength(0);
});

/** The wizard exposes a Course step listing all three courses. */
test('wizard course step lists every course', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  // Boot lands on the menu, not the wizard — open the setup wizard first, then
  // advance from Mode (step 0) to the Course step (step 1).
  await openSetupWizard(page);
  await page.evaluate(() => (document.getElementById('nextBtn') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('.modeCard[data-course]');
  const count = await page.locator('.modeCard[data-course]').count();
  // Tests run against the dev environment, so the wizard lists the full dev
  // roster: the original four (Wildwood, Sable Bay, Timberline East, Port
  // Johnson), the two `newCourses` expansions (Red Hollow, Wild Prairie), and
  // Timberline West from `courseRebuilds`.
  expect(count).toBe(7);
});
