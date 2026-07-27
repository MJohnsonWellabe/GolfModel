import { expect, test } from '@playwright/test';

/**
 * THE OVERHEAD AIM LINE (owner: "Aerial view aim line is non existent").
 *
 * Two different overlays had been conflated. "Get rid of all the red circle
 * aiming system in the aerial view" was about the RED True Vision reveal, but
 * the switch that answered it also hid the WHITE aim guide — so the one view
 * built for planning a shot stopped showing where the shot was aimed.
 *
 * This cannot be caught by the screenshot suite: the capture harness calls
 * `hideAimForCapture()` on purpose, so every reference image is taken with the
 * aim furniture stripped. It has to be asserted against the live scene.
 */
test('the aim guide is drawn in the overhead view, sized for it', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as never as { __startRound?: unknown }).__startRound, undefined, {
    timeout: 120_000
  });
  await page.evaluate(() => (window as never as { __startRound: (o: unknown) => void }).__startRound({ name: 'Aim' }));
  await page.waitForFunction(() => !!(window as never as { __slice3d?: unknown }).__slice3d, undefined, { timeout: 120_000 });
  await page.evaluate(() => (window as never as { __slice3d: { skipIntro(): void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 60_000 }
  );

  const guide = (): Promise<{
    rootEnabled: boolean;
    dotsEnabled: number;
    dotScale: number;
    dotsPickable: number;
    ringEnabled: boolean;
  }> =>
    page.evaluate(() => {
      const scene = (window as never as { __slice3d: any }).__slice3d.scene;
      const root = scene.transformNodes?.find((n: any) => n.name === 'aimRoot');
      const dots = scene.meshes.filter((m: any) => m.name.startsWith('aimDot'));
      const ring = scene.meshes.find((m: any) => m.name === 'aimRing');
      return {
        rootEnabled: !!root?.isEnabled(),
        dotsEnabled: dots.filter((d: any) => d.isEnabled()).length,
        dotScale: dots[0]?.scaling?.x ?? 0,
        dotsPickable: dots.filter((d: any) => d.isPickable).length,
        ringEnabled: !!ring?.isEnabled()
      };
    });

  const play = await guide();
  expect(play.rootEnabled).toBe(true);
  expect(play.dotsEnabled).toBeGreaterThan(0);

  await page.locator('#aerialBtn').dispatchEvent('pointerdown');
  await page.waitForTimeout(1200);
  const aerial = await guide();
  // THE REGRESSION THIS FILE EXISTS FOR: a line and a target, up here too.
  expect(aerial.rootEnabled, 'the aim guide is missing from the aerial view').toBe(true);
  expect(aerial.dotsEnabled, 'no aim dots in the aerial view').toBe(play.dotsEnabled);
  expect(aerial.ringEnabled, 'no target ring in the aerial view').toBe(true);
  // Sized for the high camera, not the play camera — a 1.4-scale dot is a
  // speck from up here, which would be as good as invisible.
  expect(aerial.dotScale, 'the aerial guide is drawn at play-view scale').toBeGreaterThan(play.dotScale * 2);

  // The guide lies FLAT on the aiming surface under a top-down ray, so if it
  // answered picks a tap meant for the ground would land on the aim line and
  // the aim would stop moving.
  expect(aerial.dotsPickable, 'aim dots must never answer a pick').toBe(0);

  // …and the play view is unchanged when you come back.
  await page.locator('#aerialBtn').dispatchEvent('pointerdown');
  await page.waitForTimeout(1200);
  const back = await guide();
  expect(back.dotScale).toBeCloseTo(play.dotScale, 5);
});
