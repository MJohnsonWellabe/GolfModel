import { expect, test } from '@playwright/test';

/**
 * The traced swing has to be usable by a thumb.
 *
 * Its ancestors failed here twice, and neither failure was visible to a unit
 * test: the first anchored the gesture on the SWING button (a finger's width of
 * travel on a phone), the second asked one question a player answers correctly
 * on their third attempt. Both were caught by playing, not by the suite.
 *
 * So this spec traces a real gesture with real pointer events on a real phone
 * viewport, and asserts that the pad is there, that it reacts while the finger
 * is still down, that the release strikes, and — the part that is the whole
 * point of the control — that the path stays on screen afterwards.
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

test('the trace pad gives the gesture real room', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await startRound(page);

  const pad = page.locator('#tracePad');
  await expect(pad, 'the trace pad never appeared with the flag on').toBeVisible();
  const box = (await pad.boundingBox())!;

  // A gesture surface needs AREA — the failure both previous controls shipped
  // with was being handed a sliver of screen and asked for a stroke.
  expect(box.width, `pad is ${Math.round(box.width)}px wide`).toBeGreaterThan(PHONE.width * 0.8);
  expect(box.height, `pad is ${Math.round(box.height)}px tall`).toBeGreaterThan(180);
  expect(box.y + box.height, 'the pad runs off the bottom').toBeLessThanOrEqual(PHONE.height + 1);
});

test('tracing the pad powers up, strikes, and leaves the path on screen', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await startRound(page);

  const box = (await page.locator('#tracePad').boundingBox())!;
  // Follow roughly the route the guide dot takes: bottom-centre, out and up,
  // back in. Approximate on purpose — a spec that traced it exactly would be
  // asserting the arithmetic rather than the control.
  const at = (u: number): [number, number] => {
    const a = 0.11 * Math.PI + (0.78 * Math.PI) * u;
    return [
      box.x + box.width * (0.5 + Math.cos(a) * 0.42),
      box.y + box.height * (0.95 - Math.sin(a) * 0.72)
    ];
  };
  const [sx, sy] = at(0);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    const [x, y] = at(i / 20);
    await page.mouse.move(x, y);
    await page.waitForTimeout(16);
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
  expect(await page.locator('#tracePadReadout').innerText()).toMatch(/line|tempo/i);
});

test('a touch that never pulls back is a cancel, not a duffed shot', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await startRound(page);

  // At the START of the route, where a real stray touch would land.
  const box = (await page.locator('#tracePad').boundingBox())!;
  const x = box.x + box.width * (0.5 + Math.cos(0.11 * Math.PI) * 0.42);
  const y = box.y + box.height * (0.95 - Math.sin(0.11 * Math.PI) * 0.72);
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
