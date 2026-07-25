import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * THE MENUS BELOW THE LANDING: the profile, the tools, and the post-round card.
 *
 * The landing was rebuilt first (tests/visual/landingIA.spec.ts). The screens
 * behind it had the same disease:
 *
 *   - the PROFILE was one column about two thousand pixels tall, with the
 *     Admin panel and the Dev tools — two surfaces used constantly during
 *     development — at the very bottom of it;
 *   - the POST-ROUND CARD stacked up to ten notice lines and seven buttons
 *     above and below the two actions that actually matter.
 *
 * Both are measured here on the reference phone, because a layout rule nobody
 * measures decays: the previous landing passed every spec in the suite while
 * failing on the owner's phone.
 */

const PHONE = { width: 360, height: 800 };

async function landing(page: import('@playwright/test').Page): Promise<void> {
  await seedReturningDevice(page);
  await page.goto('/');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 30_000 });
}

test('the profile is sections, not a scroll — and one is showing at a time', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await landing(page);
  await openDestination(page, 'more');
  await page.locator('#landingProfile').dispatchEvent('click');

  await page.locator('.profTab').first().waitFor({ state: 'visible', timeout: 20_000 });
  const tabs = await page.locator('.profTab').allInnerTexts();
  expect(tabs, tabs.join(', ')).toEqual(expect.arrayContaining(['Player', 'Progress', 'Settings']));
  // Exactly one pane open, and exactly one tab marked.
  await expect(page.locator('.profPane.on')).toHaveCount(1);
  await expect(page.locator('.profTab.sel')).toHaveCount(1);

  // Each section opens, and shows its own content.
  await page.locator('.profTab', { hasText: 'Progress' }).dispatchEvent('pointerdown');
  await expect(page.locator('.profPane.on .profMastery')).toBeVisible();
  await page.locator('.profTab', { hasText: 'Settings' }).dispatchEvent('pointerdown');
  await expect(page.locator('#resetRecords')).toBeVisible();
  // Career stats are NOT also on screen — that is the point of the split.
  await expect(page.locator('.profStats')).toBeHidden();
});

test('Settings is its own entry from the front door', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await landing(page);
  await openDestination(page, 'more');
  await page.locator('#landingSettings').dispatchEvent('click');
  // Straight onto the tab, not to the top of a scroll.
  await expect(page.locator('#resetRecords')).toBeVisible();
  await expect(page.locator('.profTab.sel')).toContainText('Settings');
});

test('the dev tools are two taps from the front door, not a scroll to the bottom', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  // `devTools` is a dev-default flag; ask for it explicitly so this spec states
  // its own precondition instead of inheriting one.
  // With the strip-down ON there is ONE admin door and no separate dev entry,
  // which is the point of it; this spec is about the dev tools being reachable
  // at all, so it asks for the shape that has them.
  await page.goto('/?ff.devTools=on&ff.focusedGame=off');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 30_000 });
  await openDestination(page, 'more');

  const dev = page.locator('#landingDev');
  await expect(dev, 'no route to the dev tools').toBeVisible();
  await dev.dispatchEvent('click');
  // Opens ON the dev tab — the whole point of deep-linking it.
  await expect(page.locator('.profTab.sel')).toContainText('Dev');
  await expect(page.locator('#devVeteran')).toBeVisible();
  await expect(page.locator('#profDevZone .devFlagRow').first()).toBeVisible();
  // And the hole builder is offered beside it, since both are dev-gated.
  await page.locator('#profBack').dispatchEvent('click');
  await openDestination(page, 'more');
  await expect(page.locator('#landingBuilder')).toBeVisible();
});

test('the tools stay hidden from a player who is neither an admin nor in dev', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?ff.devTools=off');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 30_000 });
  await openDestination(page, 'more');
  await expect(page.locator('#landingDev')).toBeHidden();
  await expect(page.locator('#landingBuilder')).toBeHidden();
  // Admin follows the signed-in ACCOUNT, not the environment — signed out,
  // there is nothing to show.
  await expect(page.locator('#landingAdmin')).toBeHidden();
  // A profile opened here has no Admin or Dev tab at all.
  await page.locator('#landingProfile').dispatchEvent('click');
  await page.locator('.profTab').first().waitFor({ state: 'visible', timeout: 20_000 });
  const tabs = await page.locator('.profTab').allInnerTexts();
  expect(tabs.join(' ')).not.toMatch(/Dev|Admin/);
});

test('the post-round card leads with the two actions that start the next round', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(PHONE);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__startRound);
  await page.evaluate(() =>
    (window as never as { __startRound: (o: unknown) => void }).__startRound({ name: 'Loop', courseId: 'sablebay' })
  );
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, {
    timeout: 90_000
  });
  // Wait for the hole to actually be playable before finishing it — finishing a
  // scene that is still building is a race, and a flaky layout spec is worse
  // than none.
  await page.evaluate(() => (window as never as { __slice3d: { skipIntro(): void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 90_000 }
  );
  await page.evaluate(() => (window as never as { __finishRound: (s: number[]) => void }).__finishRound([4, 3, 5]));
  await expect(page.locator('#summary')).toBeVisible();

  // Both primary actions above the fold, with the objective they follow.
  for (const id of ['#replayBtn', '#playNextBtn']) {
    const box = (await page.locator(id).boundingBox())!;
    expect(box.y + box.height, `${id} ends at ${Math.round(box.y + box.height)}px`).toBeLessThanOrEqual(PHONE.height);
  }
  await expect(page.locator('#summary .objLine')).toHaveCount(1);

  // The scorecard and the two always-available destinations fold away, so the
  // card is a result and a next step rather than a dashboard.
  await expect(page.locator('#summary details.roundDetails')).toBeVisible();
  await expect(page.locator('#recBtn')).toBeHidden();
  await expect(page.locator('#profBtn')).toBeHidden();
  await page.locator('#summary details.roundDetails summary').click();
  await expect(page.locator('#recBtn')).toBeVisible();
  await expect(page.locator('#profBtn')).toBeVisible();

  // Menu is always there — leaving must never need a disclosure opened first.
  await expect(page.locator('#againBtn')).toBeVisible();
});

test('the strip-down leaves ONE door to the owner controls', async ({ page }) => {
  // Admin panel, admin dashboard and dev tools were three entries to three
  // surfaces that all mean "the owner's controls".
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?ff.devTools=on&ff.focusedGame=on');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 30_000 });
  await openDestination(page, 'more');
  await expect(page.locator('#landingAdminSite'), 'no way in to the owner controls').toBeVisible();
  await expect(page.locator('#landingAdmin')).toBeHidden();
  await expect(page.locator('#landingDev')).toBeHidden();
});
