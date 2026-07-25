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
 * The breakdown has to still be there when you look up.
 *
 * It was cleared when the swing meter ARMED — which happens the instant the ball
 * comes to rest, so the card appeared and vanished in the same breath. It is
 * input to the next decision, so it must survive the whole aiming phase and go
 * only when a new ball is struck.
 */
test('the shot breakdown persists through aiming and clears on the next strike', async ({ page }) => {
  test.setTimeout(300_000);
  await startRound(page);
  const card = page.locator('#shotWhy');

  // Play one shot and settle it.
  await page.evaluate(() => (window as never as { __slice3d: { playSkilledShot(): boolean } }).__slice3d.playSkilledShot());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'flying',
    undefined,
    { timeout: 30_000 }
  );
  await page.evaluate(() => (window as never as { __slice3d: { settleFlight(): boolean } }).__slice3d.settleFlight());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 60_000 }
  );

  // It is up, and it STAYS up while the player takes their time over the next
  // shot — which is exactly when it is useful.
  await expect(card).toBeVisible();
  const shown = await card.innerText();
  expect(shown.length, 'the breakdown rendered empty').toBeGreaterThan(0);
  await page.waitForTimeout(4000);
  await expect(card, 'the breakdown vanished while the player was still aiming').toBeVisible();
  expect(await card.innerText()).toBe(shown);

  // And it goes when a new ball is struck.
  await page.evaluate(() => (window as never as { __slice3d: { playSkilledShot(): boolean } }).__slice3d.playSkilledShot());
  await page.waitForTimeout(300);
  await expect(card).toBeHidden();
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
