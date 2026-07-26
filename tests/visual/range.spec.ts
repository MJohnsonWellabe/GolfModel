import { expect, test } from '@playwright/test';
import { openSetupWizard, seedReturningDevice } from './support/wizard';

/**
 * THE RANGE (owner pass 6): a thin full-width bar across the top of the course
 * chooser. Tap it, answer one question — which shot? — and the range deals
 * endless random stations for it: a random spot for that shot on a random
 * hole, another ball as soon as the last one settles. Backing out to the menu
 * is the only way it ends.
 *
 * The putting drill is the one whose station is cheapest to verify honestly:
 * the ball MUST start on a green, which no ordinary round start ever does.
 */

const PHONE = { width: 390, height: 844 };

test('the range deals a putting station on a green, and the menu is the way out', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });

  await openSetupWizard(page);
  // The bar is thin but FULL WIDTH across the top of the chooser.
  const bar = page.locator('#rangeBar');
  await expect(bar).toBeVisible();
  const [barBox, setupBox] = [await bar.boundingBox(), await page.locator('#setupInner').boundingBox()];
  // (Against the chooser's border box, so the comparison absorbs its padding.)
  expect(barBox!.width, 'the range bar does not span the chooser').toBeGreaterThan(setupBox!.width * 0.8);
  expect(barBox!.height, 'the range bar is not thin').toBeLessThan(60);

  await bar.dispatchEvent('click');
  await expect(page.locator('#rangeRow')).toBeVisible();
  await page.locator('#rangePutt').dispatchEvent('click');

  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, {
    timeout: 120_000
  });
  // The drill placed the ball ON a green — something no round start ever does
  // — with the swing armed. This is the whole promise in one predicate.
  await page.waitForFunction(
    () => {
      const s = (window as never as { __slice3d?: { state?: { phase: string; lie: string } } }).__slice3d;
      return s?.state?.phase === 'aiming' && s.state.lie === 'green';
    },
    undefined,
    { timeout: 120_000 }
  );

  // Backing out is the only exit — and it must actually leave. (The landing
  // element itself, not a specific button: which primary button shows depends
  // on tutorial/hero state, and that is not this spec's business.)
  await page.locator('#pauseBtn').dispatchEvent('pointerdown');
  await page.locator('#landing.on').waitFor({ timeout: 30_000 });
});

test('the chipping drill starts off the green with a real shot in hand', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });

  await openSetupWizard(page);
  await page.locator('#rangeBar').dispatchEvent('click');
  await page.locator('#rangeChip').dispatchEvent('click');

  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, {
    timeout: 120_000
  });
  await page.waitForFunction(
    () => {
      const s = (window as never as { __slice3d?: { state?: { phase: string; lie: string } } }).__slice3d;
      return s?.state?.phase === 'aiming' && s.state.lie !== 'green' && s.state.lie !== 'water';
    },
    undefined,
    { timeout: 120_000 }
  );
});
