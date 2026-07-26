import { expect, test } from '@playwright/test';

/**
 * In-round affordances the owner found missing while playing on a phone.
 *
 * Each of these is invisible from the outside when broken: a putt that is not
 * counted still holes out, and a missing exit just means the player reloads and
 * loses their card. Neither would ever show up in a screenshot.
 */

async function startRound(page: import('@playwright/test').Page, courseId = 'sablebay'): Promise<void> {
  await page.goto('/?freeze=1');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__startRound);
  await page.evaluate(
    (id) =>
      (window as never as { __startRound: (o: unknown) => void }).__startRound({
        name: 'Tester',
        courseId: id,
        seed: 24680,
        character: 'chip',
        archetype: 'bigHitter'
      }),
    courseId
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
}

test('a conceded gimme is counted as a putt', async ({ page }) => {
  test.setTimeout(300_000);
  await startRound(page);

  // Play the hole out competently. A gimme is the normal way a hole ends —
  // anything resting inside three feet is conceded rather than putted.
  for (let guard = 0; guard < 60; guard++) {
    const holed = await page.evaluate(() => {
      const w = window as never as {
        __slice3d?: { state: { phase: string }; playSkilledShot(): boolean; settleFlight(): boolean };
      };
      const s = w.__slice3d;
      if (!s) return true;
      if (s.state.phase === 'flying') {
        s.settleFlight();
        return false;
      }
      if (s.state.phase === 'aiming') {
        s.playSkilledShot();
        return false;
      }
      return false;
    });
    if (holed) break;
    const putts = await page.evaluate(
      () => (window as never as { __roundPutts(): { puttsMade: number } }).__roundPutts().puttsMade
    );
    if (putts > 0) break;
    await page.waitForTimeout(80);
  }

  const tally = await page.evaluate(() =>
    (window as never as { __roundPutts(): { puttsMade: number; holePutts: Record<string, number> } }).__roundPutts()
  );
  const total = Object.values(tally.holePutts).reduce((a, b) => a + b, 0);
  console.log(`PUTTS made=${tally.puttsMade} perHole=${JSON.stringify(tally.holePutts)}`);
  // The hole ended, so at least one putt — conceded or holed — must be booked.
  // Before the fix a conceded tap-in was booked as neither.
  expect(total, 'the hole finished but no putt was recorded').toBeGreaterThan(0);
  expect(tally.puttsMade, 'a holed-or-conceded putt was not counted as made').toBeGreaterThan(0);
});

test('there is a way out of a round, and it lands back on the menu', async ({ page }) => {
  test.setTimeout(180_000);
  const exit = page.locator('#pauseBtn');
  await startRound(page);
  await expect(exit, 'no way to leave a round once it has started').toBeVisible();

  // The confirm is deliberate — leaving is destructive for a mode that cannot
  // be resumed — so the spec has to answer it.
  page.on('dialog', (d) => void d.accept());
  await exit.dispatchEvent('pointerdown');

  await expect(page.locator('#landing')).toHaveClass(/on/, { timeout: 30_000 });
  await expect(exit).toBeHidden();
  // The scene is genuinely torn down, not merely covered.
  const scene = await page.evaluate(() => (window as never as { __slice3d: unknown }).__slice3d);
  expect(scene, 'the round scene was left alive behind the menu').toBeNull();
});

/**
 * The flight-skip button (owner pass 8: "tap to fast forward to the end of
 * any shot"): appears only while the ball is in the AIR, fast-forwards to
 * rest through the real terminal path, and never exists while aiming — so
 * it cannot collide with the swipe-spin gesture or the next swing.
 * (The shot-attribution box's spec lived here until pass 8 removed the box.)
 */
test('the flight skip button fast-forwards the shot and hides while aiming', async ({ page }) => {
  test.setTimeout(300_000);
  await startRound(page);
  const skip = page.locator('#flightSkipBtn');
  await expect(skip).toBeHidden(); // never offered while aiming

  await page.evaluate(() => (window as never as { __slice3d: { playSkilledShot(): boolean } }).__slice3d.playSkilledShot());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'flying',
    undefined,
    { timeout: 30_000 }
  );
  // Shown a beat into the flight (the delay is the double-tap guard).
  await expect(skip).toBeVisible({ timeout: 10_000 });
  await skip.dispatchEvent('pointerdown');
  // The shot resolves through the REAL terminal path: back to aiming (or the
  // hole ends), ball at its true rest — not a frozen flight.
  await page.waitForFunction(
    () => {
      const s = (window as never as { __slice3d: { state: { phase: string } } }).__slice3d;
      return s.state.phase === 'aiming' || s.state.phase === 'done';
    },
    undefined,
    { timeout: 60_000 }
  );
  await expect(skip).toBeHidden();
});

test('the round controls stack down the top right, and the HUD names the course', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await startRound(page);

  // A labelled button, not a bare glyph.
  const menu = page.locator('#pauseBtn');
  await expect(menu).toBeVisible();
  expect((await menu.innerText()).toLowerCase()).toContain('menu');

  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x + menuBox.width, 'Menu is not in the top right').toBeGreaterThan(390 - 90);
  expect(menuBox.y, 'Menu is not at the top').toBeLessThan(80);

  // Course and hole live in the HUD now, not in a separate badge.
  const hud = await page.locator('#hud').innerText();
  expect(hud, hud).toMatch(/par \d/i);
  await expect(page.locator('#badge')).toBeHidden();
});
