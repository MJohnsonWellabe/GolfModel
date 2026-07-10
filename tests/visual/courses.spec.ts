import { expect, test } from '@playwright/test';

/** Each course boots into a playable scene through the test hook (Phase 9).
 *  Guards the new Sable Bay (heavy water, island par 3) and Timberline
 *  (wooded, tree-in-fairway) geometry against render/loader crashes. */
for (const courseId of ['wildwood', 'sablebay', 'timberline']) {
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
 *  key. Simulates the failure by aborting the FIRST request for a Timberline
 *  tree glb; the retry request is allowed through normally. */
test('a flaky nature-prop fetch recovers via retry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let aborted = false;
  await page.route('**/models/nature/tree_spruce.glb', (route) => {
    if (!aborted) {
      aborted = true;
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
  expect(aborted).toBe(true);
  expect(errors, errors.join('\n')).toHaveLength(0);
});

/** The wizard exposes a Course step listing all three courses. */
test('wizard course step lists every course', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  // Advance to the Course step (step index 1) via the Next button.
  await page.evaluate(() => (document.getElementById('nextBtn') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('.modeCard[data-course]');
  const count = await page.locator('.modeCard[data-course]').count();
  expect(count).toBe(3);
});
