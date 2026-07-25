import { expect, test } from '@playwright/test';

/**
 * The drag swing has to have somewhere to go.
 *
 * Its first version anchored the gesture on the SWING button — 18px off the
 * bottom of the screen — so a phone offered roughly a finger's width of travel
 * and the owner's report was simply that you cannot pull back far enough. That
 * is a GEOMETRY failure, and the suite of the day could not see it: the unit
 * tests exercised the mapping with abstract pixel counts, and the visual specs
 * never turned the flag on.
 *
 * So this spec plays a real pull with real pointer events on a real phone
 * viewport, and asserts that the stroke fits, that the surface reacts, and that
 * the release actually strikes the ball.
 */

const PHONE = { width: 390, height: 844 };

async function startRound(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?freeze=1&ff.dragSwing=on');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__startRound);
  await page.evaluate(() =>
    (window as never as { __startRound: (o: unknown) => void }).__startRound({
      name: 'Tester',
      courseId: 'sablebay',
      seed: 24680,
      character: 'chip',
      archetype: 'bigHitter'
    })
  );
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, {
    timeout: 90_000
  });
  await page.evaluate(() => (window as never as { __slice3d: { skipIntro(): void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 60_000 }
  );
  // The phase flips to `aiming` a beat BEFORE the loading veil comes down, and
  // the veil is a full-screen `inset: 0` at z-index 30 — so a pointer press
  // aimed at the track lands on the veil and nothing happens. Synthetic input
  // has no actionability check to save us here, and the symptom (a control that
  // simply does not respond) is indistinguishable from a real regression.
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 60_000 });
}

test('the pull track has a full backswing of travel beneath the thumb', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await startRound(page);

  const grip = page.locator('#dragGrip');
  await expect(grip, 'the pull track never appeared with the flag on').toBeVisible();
  const box = (await grip.boundingBox())!;

  // On the right edge, where a thumb is.
  expect(box.x + box.width, 'the track is not on the right edge').toBeGreaterThan(PHONE.width - 90);

  // And with a full backswing PLUS its overswing headroom underneath it. This
  // is the number the old build could not satisfy.
  const travel = PHONE.height - (box.y + box.height);
  expect(travel, `only ${Math.round(travel)}px of travel below the grip`).toBeGreaterThan(PHONE.height * 0.45);
});

test('a pull down the track powers up, and the release strikes the ball', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await startRound(page);

  const grip = (await page.locator('#dragGrip').boundingBox())!;
  const x = grip.x + grip.width / 2;
  const y0 = grip.y + grip.height / 2;

  // A pull the hand of a real player would make: unhurried, straight, and
  // stopping well short of the bottom of the screen.
  const depth = PHONE.height * 0.36;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(x, y0 + (depth * i) / 24);
    await page.waitForTimeout(16);
  }

  // The surface responds to the stroke while it is still in the hand — the
  // whole affordance a spatial control buys over a timing bar.
  const fill = await page.locator('#dragFill').evaluate((el) => (el as HTMLElement).style.height);
  expect(parseFloat(fill), `fill was "${fill}"`).toBeGreaterThan(10);
  await expect(page.locator('#dragKnob')).toBeVisible();
  expect(await page.locator('#dragReadout').innerText()).toMatch(/%/);

  await page.mouse.up();

  // Release means strike. Anything else and the player is holding a club they
  // cannot put down.
  await page.waitForFunction(
    () => {
      const p = (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase;
      return p === 'swinging' || p === 'flying';
    },
    undefined,
    { timeout: 20_000 }
  );
});

test('a touch that never pulls back is a cancel, not a duffed shot', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await startRound(page);

  const grip = (await page.locator('#dragGrip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 6);
  await page.mouse.up();
  await page.waitForTimeout(400);

  const phase = await page.evaluate(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase
  );
  expect(phase, 'a stray touch on the track played a shot').toBe('aiming');
});

test('with the flag off, nothing about the tap meter changes', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await page.goto('/?freeze=1&ff.dragSwing=off');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__startRound);
  await page.evaluate(() =>
    (window as never as { __startRound: (o: unknown) => void }).__startRound({
      name: 'Tester',
      courseId: 'sablebay',
      seed: 24680,
      character: 'chip',
      archetype: 'bigHitter'
    })
  );
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, {
    timeout: 90_000
  });
  await page.evaluate(() => (window as never as { __slice3d: { skipIntro(): void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 60_000 }
  );

  await expect(page.locator('#dragTrack')).toBeHidden();
  await expect(page.locator('#swingBtn')).toBeVisible();
  await expect(page.locator('#meter')).toBeVisible();
});
