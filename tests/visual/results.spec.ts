import { expect, test } from '@playwright/test';

/**
 * End-of-round results loop (retention Part 1): the results card must show
 * the compact score header, ONE contextual objective and the two primary
 * actions; Replay restarts the SAME course, Play Next starts the rotation's
 * next course (sablebay → wildwood → timberline → portjohnson → sablebay)
 * with no course-select menu. Uses __finishRound to reach the real
 * showSummary flow without playing meter golf under software GL.
 *
 * Also captures the mobile results screenshot (360×800) for the deliverables.
 */

async function bootRound(page: import('@playwright/test').Page, courseId: string): Promise<void> {
  const prevSeq = await page.evaluate(() => (window as any).__slice3d?.seq ?? 0);
  await page.evaluate((id) => (window as any).__startRound({ name: 'Loop', courseId: id }), courseId);
  await page.waitForFunction((prev) => ((window as any).__slice3d?.seq ?? 0) > prev, prevSeq, {
    timeout: 90_000
  });
  await page.evaluate(() => (window as any).__slice3d.skipIntro());
  await page.waitForFunction(() => (window as any).__slice3d?.state?.phase === 'aiming', undefined, {
    timeout: 90_000
  });
}

test('results screen: Replay repeats the course, Play Next follows the rotation', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);

  // ---- Round 1 on Sable Bay → results card -------------------------------
  await bootRound(page, 'sablebay');
  await page.evaluate(() => (window as any).__finishRound([4, 3, 5]));
  await expect(page.locator('#summary')).toBeVisible();
  // Compact header + the two primary actions + exactly one objective.
  await expect(page.locator('#summary .scoreHead .big')).toHaveText('12');
  await expect(page.locator('#replayBtn')).toBeVisible();
  await expect(page.locator('#playNextBtn')).toContainText('Wildwood');
  await expect(page.locator('#summary .objLine')).toHaveCount(1);
  // Primary content fits the phone viewport: both primary actions on screen.
  const replayBox = await page.locator('#replayBtn').boundingBox();
  expect(replayBox, 'Replay button rendered').not.toBeNull();
  expect(replayBox!.y + replayBox!.height, 'primary actions inside 800px viewport').toBeLessThanOrEqual(800);
  await page.screenshot({ path: 'tests/visual/__shots__/results-mobile.png' });

  // ---- Replay: same course, fresh scene ----------------------------------
  const seqBefore = await page.evaluate(() => (window as any).__slice3d?.seq ?? 0);
  await page.locator('#replayBtn').dispatchEvent('pointerdown');
  await page.waitForFunction((prev) => ((window as any).__slice3d?.seq ?? 0) > prev, seqBefore, {
    timeout: 90_000
  });
  await page.evaluate(() => (window as any).__slice3d.skipIntro());
  await page.waitForFunction(() => (window as any).__slice3d?.state?.phase === 'aiming', undefined, {
    timeout: 90_000
  });
  const replayCourse = await page.evaluate(() => (window as any).__golfSoak().course);
  expect(replayCourse).toBe('Sable Bay');

  // ---- Play Next: rotation moves to Wildwood -----------------------------
  await page.evaluate(() => (window as any).__finishRound());
  await expect(page.locator('#playNextBtn')).toContainText('Wildwood');
  const seqBefore2 = await page.evaluate(() => (window as any).__slice3d?.seq ?? 0);
  await page.locator('#playNextBtn').dispatchEvent('pointerdown');
  await page.waitForFunction((prev) => ((window as any).__slice3d?.seq ?? 0) > prev, seqBefore2, {
    timeout: 90_000
  });
  await page.evaluate(() => (window as any).__slice3d.skipIntro());
  await page.waitForFunction(() => (window as any).__slice3d?.state?.phase === 'aiming', undefined, {
    timeout: 90_000
  });
  const nextCourse = await page.evaluate(() => (window as any).__golfSoak().course);
  expect(nextCourse).toBe('Wildwood Glen');

  // ---- And from Wildwood the rotation continues to Timberline ------------
  await page.evaluate(() => (window as any).__finishRound());
  await expect(page.locator('#playNextBtn')).toContainText('Timberline');
});

test('landing shows ONE concise daily card', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  await expect(page.locator('#dailyCard')).toBeVisible();
  await expect(page.locator('#dailyCard .dcName')).toHaveCount(1);
  // No horizontal overflow at 360px (mobile acceptance).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'tests/visual/__shots__/landing-daily-mobile.png' });
});
