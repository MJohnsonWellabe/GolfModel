import { expect, test } from '@playwright/test';

/**
 * The Hole Builder's new working loop.
 *
 * The unit tests cover the catalog and the oracle. What they cannot cover is
 * the loop a designer actually performs: find a thing, put it on the hole, ask
 * whether the hole is any good, and play it. Every one of those is a separate
 * wire between the page and modules it imports, and a broken one leaves a tool
 * that looks completely fine and does nothing.
 */

async function openBuilder(page: import('@playwright/test').Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/holebuilder.html');
  // The first bundled course is fetched on boot; the plan is up once the hole
  // selector has options.
  await page.waitForFunction(() => (document.getElementById('hole') as HTMLSelectElement)?.options.length > 0, undefined, {
    timeout: 30_000
  });
  return errors;
}

test('the library lists real assets and filters', async ({ page }) => {
  const errors = await openBuilder(page);
  const assets = page.locator('#libList .asset');
  // The catalog is a few dozen entries; anything near zero means the import
  // failed and the page is silently a viewer again.
  expect(await assets.count()).toBeGreaterThan(40);
  await expect(page.locator('#libList .libGroup').first()).toBeVisible();

  await page.locator('#libSearch').fill('bunker');
  await expect(assets).toHaveCount(1);
  await expect(assets.first()).toContainText('Bunker');

  // Hovering explains what it does to PLAY — the difference between a library
  // and a list of filenames.
  await assets.first().hover();
  expect(await page.locator('#libNote').innerText()).toMatch(/sand|plug/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('an asset can be placed on the plan and lands in the hole JSON', async ({ page }) => {
  const errors = await openBuilder(page);
  const before = await page.evaluate(() => (window as never as { __builder(): { hazards: number } }).__builder().hazards);

  await page.locator('#libSearch').fill('bunker');
  await page.locator('#libList .asset').first().click();
  // Armed: the stage says so, which is the only feedback that the click landed.
  await expect(page.locator('#placeBadge')).toBeVisible();

  const box = (await page.locator('#c').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const after = await page.evaluate(() => (window as never as { __builder(): { hazards: number } }).__builder().hazards);
  expect(after, 'the placed bunker did not reach the hole').toBe(before + 1);

  // Still armed, because a treeline is a row of clicks, not a row of trips back
  // to the library.
  await expect(page.locator('#placeBadge')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#placeBadge')).toBeHidden();

  // And it is undoable like every other mutation.
  await page.keyboard.press('Control+z');
  const undone = await page.evaluate(() => (window as never as { __builder(): { hazards: number } }).__builder().hazards);
  expect(undone).toBe(before);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the critique reads the hole across three standards', async ({ page }) => {
  const errors = await openBuilder(page);
  await page.locator('#runCritique').click();
  const crit = page.locator('#critique');
  await expect(crit.locator('.verdict')).toBeVisible({ timeout: 30_000 });
  const text = await crit.innerText();
  for (const tier of ['Casual', 'Regular', 'Strong']) expect(text, text).toContain(tier);
  // A verdict a designer can act on, not just numbers.
  expect(text).toMatch(/Good|Too hard|Too easy|Punishing|skill|structural/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the Claude brief carries the hole, the evidence and the rules', async ({ page }) => {
  const errors = await openBuilder(page);
  await page.locator('#intent').fill('Make the tee shot a real decision.');
  const brief = await page.evaluate(() =>
    (window as never as { __builder(): { brief(): string } }).__builder().brief()
  );
  const parsed = JSON.parse(brief);
  expect(parsed.format).toBe('bsgolf.hole.v1');
  expect(parsed.hole.tee).toBeTruthy();
  expect(parsed.critique.tiers).toHaveLength(3);
  expect(parsed.intent).toContain('decision');
  // The unit rule is the one that has actually bitten this project.
  expect(JSON.stringify(parsed.constraints)).toMatch(/1\.25 ft/);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a hole handed over by the builder plays in the real game', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openBuilder(page);
  // The builder writes the hole to sessionStorage and opens the game; drive
  // that handover directly so the assertion is about the GAME accepting it.
  const payload = await page.evaluate(() =>
    (window as never as { __builder(): { handover(): string } }).__builder().handover()
  );
  expect(errors, errors.join('\n')).toEqual([]);

  await page.addInitScript((p) => sessionStorage.setItem('bsg.builderHole.v1', p as string), payload);
  await page.goto('/?builderHole=1&freeze=1');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, {
    timeout: 90_000
  });
  await page.evaluate(() => (window as never as { __slice3d: { skipIntro(): void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 60_000 }
  );
  // Reaching the aiming phase means the scene built, the terrain baked and the
  // ball is on the tee — the hole is genuinely playable, not merely parsed.
  expect(errors, errors.join('\n')).toEqual([]);
});
