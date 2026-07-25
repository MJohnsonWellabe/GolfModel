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

/**
 * Raise a panel if this viewport puts them behind sheets.
 *
 * Below 900px the plan owns the screen and the two panels become bottom sheets
 * — which is the entire point of the phone layout, and means a spec that wants
 * a control inside one has to ask for it, exactly as a person would.
 */
async function openSheet(page: import('@playwright/test').Page, which: 'side' | 'lib'): Promise<void> {
  const bar = page.locator('#sheetBar');
  if (await bar.isVisible()) await bar.locator(`button[data-sheet="${which}"]`).click();
}

test('the library lists real assets and filters', async ({ page }) => {
  const errors = await openBuilder(page);
  await openSheet(page, 'lib');
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

  await openSheet(page, 'lib');
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
  await openSheet(page, 'side');
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
  await openSheet(page, 'side');
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

/**
 * THE PHONE.
 *
 * The tool was a fixed three-column desktop grid with no media queries at all:
 * on a ~390px screen the two panels consumed 520px and the plan — the thing you
 * place onto — was pushed off the side entirely. And the library used HTML5
 * drag-and-drop, which does not fire on touch devices at all. So on a phone
 * there was nothing to drag, and nowhere to drag it to.
 *
 * Neither failure was visible to the old gate, which ran at 720px wide and
 * placed assets with `.click()`. These run at 390x844 with touch enabled.
 */
test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the plan is on screen and takes the room', async ({ page }) => {
    const errors = await openBuilder(page);
    const canvas = page.locator('#c');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    // The whole bug in one assertion: the canvas must actually be in the
    // viewport, not shoved off the right-hand side by fixed-width panels.
    expect(box.x, `plan starts at x=${Math.round(box.x)} — pushed off screen`).toBeLessThan(40);
    expect(box.width, `plan is only ${Math.round(box.width)}px wide`).toBeGreaterThan(300);
    expect(box.height, `plan is only ${Math.round(box.height)}px tall`).toBeGreaterThan(400);
    // The panels are sheets, closed by default, reachable from the tab bar.
    await expect(page.locator('#sheetBar')).toBeVisible();
    await expect(page.locator('#lib')).toBeHidden();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('an asset can be placed by touch alone', async ({ page }) => {
    const errors = await openBuilder(page);
    const before = await page.evaluate(() => (window as never as { __builder(): { hazards: number } }).__builder().hazards);

    await page.locator('#sheetBar button[data-sheet="lib"]').tap();
    await expect(page.locator('#lib')).toBeVisible();
    await page.locator('#libSearch').fill('bunker');
    await page.locator('#libList .asset').first().tap();

    // Back to the plan, then tap it — the gesture a person actually makes.
    await page.locator('#sheetBar button[data-sheet=""]').tap();
    const box = (await page.locator('#c').boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    const after = await page.evaluate(() => (window as never as { __builder(): { hazards: number } }).__builder().hazards);
    expect(after, 'a tapped asset never reached the hole').toBe(before + 1);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('a hole can be drawn from a blank canvas by touch', async ({ page }) => {
    const errors = await openBuilder(page);
    await page.locator('#sheetBar button[data-sheet="side"]').tap();
    await page.locator('#newHole').tap();

    const blank = await page.evaluate(() => (window as never as { __builder(): { hazards: number; fairways: number } }).__builder());
    expect(blank.hazards, 'a new hole should start empty').toBe(0);

    const tapPlan = async (fx: number, fy: number): Promise<void> => {
      await page.locator('#sheetBar button[data-sheet=""]').tap();
      const box = (await page.locator('#c').boundingBox())!;
      await page.touchscreen.tap(box.x + box.width * fx, box.y + box.height * fy);
    };

    // Tee.
    await page.locator('#sheetBar button[data-sheet="side"]').tap();
    await page.locator('#toolBar button[data-tool="tee"]').tap();
    await tapPlan(0.5, 0.8);

    // Fairway: a route up the hole, then Done.
    await page.locator('#sheetBar button[data-sheet="side"]').tap();
    await page.locator('#toolBar button[data-tool="fairway"]').tap();
    await tapPlan(0.5, 0.7);
    await tapPlan(0.5, 0.5);
    await tapPlan(0.5, 0.3);
    await page.locator('#sheetBar button[data-sheet="side"]').tap();
    await page.locator('#drawDone').tap();

    // Three pin positions.
    await page.locator('#toolBar button[data-tool="pin"]').tap();
    await tapPlan(0.45, 0.2);
    await page.locator('#sheetBar button[data-sheet="side"]').tap();
    await page.locator('#toolBar button[data-tool="pin"]').tap();
    await tapPlan(0.5, 0.18);
    await page.locator('#sheetBar button[data-sheet="side"]').tap();
    await page.locator('#toolBar button[data-tool="pin"]').tap();
    await tapPlan(0.55, 0.2);

    const built = await page.evaluate(() =>
      (window as never as { __builder(): { fairways: number; pins: number } }).__builder()
    );
    expect(built.fairways, 'the drawn fairway did not reach the hole').toBeGreaterThan(0);
    expect(built.pins, 'the pin positions did not reach the hole').toBeGreaterThan(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

/**
 * The end of the loop: a hole drawn from nothing has to be a hole the GAME will
 * accept. Drawing is only worth anything if what comes out the other side is
 * playable — the fairway ribbon has to compile, the green has to be a green, and
 * the pin has to be on it.
 */
test('a hole drawn from a blank canvas is playable in the real game', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openBuilder(page);
  await openSheet(page, 'side');
  await page.locator('#newHole').click();

  const plan = async (fx: number, fy: number): Promise<void> => {
    const box = (await page.locator('#c').boundingBox())!;
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  };

  await page.locator('#toolBar button[data-tool="tee"]').click();
  await plan(0.5, 0.82);
  await page.locator('#toolBar button[data-tool="fairway"]').click();
  await plan(0.5, 0.72);
  await plan(0.52, 0.5);
  await plan(0.5, 0.3);
  await page.locator('#drawDone').click();
  await page.locator('#toolBar button[data-tool="green"]').click();
  await plan(0.5, 0.22);

  // The critique is the designer's own check that it is a real hole.
  await page.locator('#runCritique').click();
  await expect(page.locator('#critique .verdict')).toBeVisible({ timeout: 30_000 });
  const verdict = await page.locator('#critique').innerText();
  expect(verdict, verdict).not.toMatch(/pin is not on the green/);

  // Then hand it to the game and make sure it reaches the tee.
  const payload = await page.evaluate(() =>
    (window as never as { __builder(): { handover(): string } }).__builder().handover()
  );
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
  expect(errors, errors.join('\n')).toEqual([]);
});
