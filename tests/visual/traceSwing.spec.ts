import { expect, test } from '@playwright/test';

/**
 * The tempo trace has to be usable by a thumb.
 *
 * Its ancestors failed three times, and no unit test saw any of it: anchored
 * on the SWING button (a finger's width of travel), then a one-question pull,
 * then an arc a thumb cannot comfortably draw. The owner's spec is the fix: a
 * tall rectangle on the RIGHT, a rabbit that runs straight down and back up,
 * and a player who follows it.
 *
 * So this spec traces a real gesture with real pointer events on a real phone
 * viewport, and asserts the pad is there on the right, that it reacts while
 * the finger is down, that the release strikes, and — the whole point — that
 * the path stays on screen afterwards.
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

test('the trace pad is a tall rectangle on the right with real travel', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await startRound(page);

  const pad = page.locator('#tracePad');
  await expect(pad, 'the trace pad never appeared with the flag on').toBeVisible();
  const box = (await pad.boundingBox())!;

  // RIGHT side, TALLER than wide — the owner's spec, and the axis a thumb
  // actually has room on.
  expect(box.x + box.width, 'the pad is not on the right edge').toBeGreaterThan(PHONE.width - 20);
  expect(box.height, `pad is ${Math.round(box.height)}px tall`).toBeGreaterThan(box.width * 1.5);
  expect(box.height, 'not enough vertical travel').toBeGreaterThan(PHONE.height * 0.45);
  expect(box.y + box.height, 'the pad runs off the bottom').toBeLessThanOrEqual(PHONE.height + 1);
});

test('tracing the rabbit powers up, strikes, and leaves the path on screen', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await startRound(page);

  const box = (await page.locator('#tracePad').boundingBox())!;
  // Straight down the rail and straight back up, roughly at the rabbit's
  // pace. Approximate on purpose — a spec that traced it exactly would be
  // asserting the arithmetic rather than the control.
  const railX = box.x + box.width * 0.5;
  const yAt = (cursor: number): number => box.y + box.height * (0.1 + 0.78 * cursor);
  await page.mouse.move(railX, yAt(0));
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(railX, yAt(0.85 * (i / 12)));
    await page.waitForTimeout(55);
  }
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(railX, yAt(0.85 * (1 - i / 10)));
    await page.waitForTimeout(55);
  }

  // The surface responds while the finger is still down — the affordance a
  // gesture control buys over a timing bar.
  expect(await page.locator('#tracePadReadout').innerText()).toMatch(/%/);

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

  // AND THE PATH STAYS UP. A control that says "miss" and nothing else is a
  // slot machine; showing the shape of your own mistake is the only way
  // tracing gets better, so the pad survives the strike.
  await expect(page.locator('#tracePad')).toBeVisible();
  expect(await page.locator('#tracePadReadout').innerText()).toMatch(/tempo|line/i);
});

test('a touch that never pulls back is a cancel, not a duffed shot', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await startRound(page);

  // At ADDRESS — the top of the rail, where a real stray touch would land.
  const box = (await page.locator('#tracePad').boundingBox())!;
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.1;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 4, y - 3);
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

  await expect(page.locator('#tracePad')).toBeHidden();
  await expect(page.locator('#swingBtn')).toBeVisible();
  await expect(page.locator('#meter')).toBeVisible();
});
