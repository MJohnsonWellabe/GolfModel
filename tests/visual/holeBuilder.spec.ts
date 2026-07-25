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

/**
 * NAVIGATING THE PLAN.
 *
 * Three faults the owner hit after the phone rebuild, and none of them were
 * visible to a spec that only ever placed one asset in the middle of a fitted
 * view:
 *
 *   - the instruction chips floated OVER the plan without
 *     `pointer-events: none`, so the strip of canvas under them — the top
 *     centre, which is exactly where you place a tee — swallowed every tap;
 *   - the plan could only be zoomed with a mouse wheel, so a phone had no zoom
 *     at all, and could only be panned by dragging empty space, so while a draw
 *     tool was armed there was no pan either. A fairway that ran off the edge of
 *     the screen was a fairway you were stuck with;
 *   - `touch-action` was left at its default, so the browser claimed each touch
 *     for its own scrolling and the canvas saw a truncated pointer stream.
 */
test('the instruction chips do not swallow taps meant for the plan', async ({ page }) => {
  await openBuilder(page);
  // Arm a tool so the badges are actually up.
  await openSheet(page, 'side');
  await page.locator('#toolBar button').first().click();
  for (const id of ['#placeBadge', '#snapBadge', '#hud', '#toast']) {
    const el = page.locator(id);
    if (!(await el.count())) continue;
    const pe = await el.evaluate((n) => getComputedStyle(n as HTMLElement).pointerEvents);
    expect(pe, `${id} is still eating pointer events`).toBe('none');
  }
  // And the canvas is what is actually under the badge's own position.
  const badge = await page.locator('#placeBadge').boundingBox();
  if (badge) {
    const under = await page.evaluate(
      ([x, y]) => (document.elementFromPoint(x as number, y as number) as HTMLElement)?.id,
      [badge.x + badge.width / 2, badge.y + badge.height / 2]
    );
    expect(under, 'the badge is still on top of the plan').toBe('c');
  }
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the plan can be zoomed without a mouse wheel', async ({ page }) => {
    const errors = await openBuilder(page);
    const scale = (): Promise<number> =>
      page.evaluate(() => (window as never as { __builder(): { view(): { scale: number } } }).__builder().view().scale);

    const start = await scale();
    await page.locator('#zoomIn').tap();
    const zoomedIn = await scale();
    expect(zoomedIn, `${start} -> ${zoomedIn}`).toBeGreaterThan(start);

    await page.locator('#zoomOut').tap();
    await page.locator('#zoomOut').tap();
    expect(await scale()).toBeLessThan(zoomedIn);

    // Fit puts it back to the whole hole.
    await page.locator('#zoomFit').tap();
    expect(Math.abs((await scale()) - start), 'fit did not restore the framing').toBeLessThan(start * 0.05);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('the plan pans by touch while a draw tool is armed', async ({ page }) => {
    const errors = await openBuilder(page);
    await page.locator('#sheetBar button[data-sheet="side"]').tap();
    // Arm the fairway tool — the mode where a single tap places a point, and
    // where panning used to be impossible.
    await page.locator('#toolBar button', { hasText: /fairway/i }).first().tap();
    await page.locator('#sheetBar button[data-sheet=""]').tap();

    const before = await page.evaluate(
      () => (window as never as { __builder(): { view(): { x: number } } }).__builder().view().x
    );
    const points = await page.evaluate(
      () => (window as never as { __builder(): { fairways: number } }).__builder().fairways
    );

    // Two fingers: the gesture that has to work in every mode.
    const box = (await page.locator('#c').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.evaluate(
      ([x, y]) => {
        const c = document.getElementById('c')!;
        const send = (type: string, id: number, px: number, py: number): void => {
          c.dispatchEvent(
            new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: px, clientY: py, bubbles: true })
          );
        };
        send('pointerdown', 1, (x as number) - 40, y as number);
        send('pointerdown', 2, (x as number) + 40, y as number);
        for (let i = 1; i <= 6; i++) {
          send('pointermove', 1, (x as number) - 40 - i * 12, y as number);
          send('pointermove', 2, (x as number) + 40 - i * 12, y as number);
        }
        send('pointerup', 1, (x as number) - 112, y as number);
        send('pointerup', 2, (x as number) - 32, y as number);
      },
      [cx, cy]
    );

    const after = await page.evaluate(
      () => (window as never as { __builder(): { view(): { x: number } } }).__builder().view().x
    );
    expect(after, `view.x ${before} -> ${after}`).not.toBeCloseTo(before, 1);
    // And the pinch left no stray fairway point behind — the reason touch
    // placement waits for the finger to lift.
    const pointsAfter = await page.evaluate(
      () => (window as never as { __builder(): { fairways: number } }).__builder().fairways
    );
    expect(pointsAfter, 'a two-finger gesture dropped a point on the hole').toBe(points);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

/**
 * FLY MODE — placing on the hole you actually play.
 *
 * The plan is an abstract diagram. It is the right tool for drawing a fairway
 * corridor and the wrong one for deciding where a tree looks right, which is
 * the owner's complaint in his own words: "a grid that doesn't look like the
 * hole". Fly mode puts the asset library over the REAL rendered hole.
 *
 * Every step of that loop is a wire between the page, the renderer and the
 * builder's own data model, and a broken one leaves a mode that looks correct
 * and changes nothing.
 */
test('fly mode places assets on the rendered hole, and the builder gets them back', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openBuilder(page);
  const payload = await page.evaluate(() =>
    (window as never as { __builder(): { handover(): string } }).__builder().handover()
  );

  // Seed the handover ONLY if it is not already there: this init script runs on
  // every navigation, and the trip home is a navigation — overwriting the slot
  // then would wipe the very edits this spec exists to follow.
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('bsg.builderHole.v1')) sessionStorage.setItem('bsg.builderHole.v1', p as string);
  }, payload);
  await page.goto('/?builderHole=1&freeze=1');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, {
    timeout: 90_000
  });
  await page.evaluate(() => (window as never as { __slice3d: { skipIntro(): void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 90_000 }
  );

  // The way in is offered — a preview with no route into design mode, or out of
  // it, is the one-way trip this whole pass is fixing.
  await expect(page.locator('#designBtn')).toBeVisible();
  await expect(page.locator('#builderBackBtn')).toBeVisible();

  await page.locator('#designBtn').dispatchEvent('pointerdown');
  await expect(page.locator('#designBar')).toBeVisible();
  // Fly mode SNAPS its camera rather than gliding to it, because picking
  // unprojects through the current view matrix: a tap made mid-glide resolves
  // against the old vantage and places the asset where nobody pointed. This is
  // the assertion that keeps the snap.
  const settled = await page.evaluate(() => {
    const s3 = (window as never as { __slice3d: { scene: { activeCamera: { position: { y: number } } } } }).__slice3d;
    return s3.scene.activeCamera.position.y;
  });
  expect(settled, 'the design camera never got off the deck').toBeGreaterThan(30);
  expect(await page.evaluate(() => (window as never as { __slice3d: { designActive(): boolean } }).__slice3d.designActive())).toBe(true);

  // Gameplay chrome is down: a swing meter while you are placing trees is an
  // invitation to hit a shot into a hole you are halfway through editing.
  await expect(page.locator('#swingBtn')).toBeHidden();
  await expect(page.locator('#clubBar')).toBeHidden();

  // The catalog is here, not a subset of it.
  const chips = await page.locator('#designAssets .dmAsset').count();
  expect(chips, 'the asset library did not reach fly mode').toBeGreaterThan(20);

  const before = await page.evaluate(() =>
    (window as never as { __slice3d: { holeCounts(): { props: number; hazards: number } } }).__slice3d.holeCounts()
  );

  // Arm a tree and tap the middle of the hole. A tap, not a drag — a drag is a
  // camera pan, and telling them apart is the whole of the pointer logic.
  await page.locator('#designAssets .dmAsset').first().dispatchEvent('pointerdown');
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  const after = await page.evaluate(() =>
    (window as never as { __slice3d: { holeCounts(): { props: number; hazards: number } } }).__slice3d.holeCounts()
  );
  expect(
    after.props + after.hazards,
    `hole went from ${before.props + before.hazards} to ${after.props + after.hazards} placements`
  ).toBe(before.props + before.hazards + 1);

  // Undo is honest about what it removes.
  await page.locator('#designUndo').dispatchEvent('pointerdown');
  const undone = await page.evaluate(() =>
    (window as never as { __slice3d: { holeCounts(): { props: number; hazards: number } } }).__slice3d.holeCounts()
  );
  expect(undone.props + undone.hazards).toBe(before.props + before.hazards);

  // Place again, then leave — the edits must ride back to the builder, or the
  // whole mode is a sandbox that throws your work away. A DIFFERENT chip,
  // because tapping the armed one disarms (that is the way out of a placement
  // mode you have stopped wanting).
  await page.locator('#designAssets .dmAsset').nth(1).dispatchEvent('pointerdown');
  await page.mouse.move(vp.width / 2, vp.height / 2 + 40);
  await page.mouse.down();
  await page.mouse.up();
  await page.locator('#designExit').dispatchEvent('pointerdown');
  await expect(page.locator('#designBar')).toBeHidden();
  // Leaving fly mode gives the round its controls back.
  await expect(page.locator('#clubBar')).toBeVisible();

  // Back to the builder. The preview tab was opened by the builder, so closing
  // it is the real path home; a Playwright-driven tab cannot be closed by
  // script, which is exactly the case the navigation fallback exists for.
  await page.locator('#builderBackBtn').dispatchEvent('pointerdown');
  await page.waitForURL(/holebuilder\.html/, { timeout: 30_000 });
  await page.waitForFunction(() => (document.getElementById('hole') as HTMLSelectElement)?.options.length > 0, undefined, {
    timeout: 30_000
  });

  // THE END OF THE LOOP: what was placed on the rendered hole is on the plan.
  // Without this the mode is a sandbox that throws your work away.
  await page.waitForFunction(
    (want) => {
      const b = (window as never as { __builder(): { hazards: number; props: number } }).__builder();
      return b.hazards + b.props === want;
    },
    before.props + before.hazards + 1,
    { timeout: 15_000 }
  );
  expect(errors, errors.join('\n')).toEqual([]);
});

/**
 * WHAT THE PLAN AND THE FLY VIEW OWED THE DESIGNER.
 *
 * Six reports from using the tool in anger, each of which looks like a
 * different problem and is actually the same one: the builder knew things it
 * never told you, and did things you never asked for.
 */
test('a blank hole measures itself instead of claiming par 4, 400 yards', async ({ page }) => {
  const errors = await openBuilder(page);
  await openSheet(page, 'side');
  await page.locator('#newHole').click();
  // The old blank hole was a literal "par 4 / 400 yd" whatever you then drew,
  // so a 180-yard one-shotter stayed labelled a 400-yard par 4 until somebody
  // remembered to retype both.
  const before = await page.evaluate(() => (window as never as { __builder(): { metrics(): { par: number; yardage: number } } }).__builder().metrics());
  expect(before.yardage, `blank hole claims ${before.yardage} yd`).toBeLessThan(400);

  // Move the green: the length follows, and so does the par.
  await page.evaluate(() => {
    const b = window as never as { __builder(): { setGreen(x: number, y: number): void } };
    b.__builder().setGreen(550, 200);
  });
  const long = await page.evaluate(() => (window as never as { __builder(): { metrics(): { par: number; yardage: number } } }).__builder().metrics());
  expect(long.yardage, 'yardage did not follow the green').toBeGreaterThan(before.yardage);
  expect(long.par, `par ${long.par} at ${long.yardage} yd`).toBeGreaterThanOrEqual(before.par);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the plan can say how far everything is', async ({ page }) => {
  const errors = await openBuilder(page);
  // Golf is a game about distance and the plan was drawn purely in world
  // pixels, so "how far is that bunker" needed arithmetic against a 2 px/yd
  // scale, in your head, every time.
  await expect(page.locator('#zoomYards')).toBeVisible();
  expect(await page.evaluate(() => (window as never as { __builder(): { yards(): boolean } }).__builder().yards())).toBe(true);
  await page.locator('#zoomYards').click();
  expect(await page.evaluate(() => (window as never as { __builder(): { yards(): boolean } }).__builder().yards())).toBe(false);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the surfaces a hole is made of can all be drawn', async ({ page }) => {
  const errors = await openBuilder(page);
  await openSheet(page, 'side');
  // Sand, trees, out of bounds and a building footprint were all authorable in
  // JSON and none of them were drawable — so a hole built here could only ever
  // have water and one kind of bunker.
  for (const t of ['poly:waste', 'poly:trees', 'poly:ob', 'poly:building']) {
    await expect(page.locator(`#toolBar button[data-tool="${t}"]`), t).toBeVisible();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
