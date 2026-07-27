import { expect, test } from '@playwright/test';

/**
 * WHEN THERE IS NO GPU.
 *
 * Owner, with a screenshot: "I refreshed and it couldn't build the menus. It
 * builds a smaller version of the menus that isn't functional then lands on the
 * attached page" — the page reading *"The game didn't load … Uncaught Error:
 * WebGL not supported"*.
 *
 * The cause was structural: `new Engine(canvas, …)` is a module-top-level
 * statement and every menu listener is registered hundreds of lines below it,
 * so the constructor throwing killed the module and left the browser painting
 * `#setup`'s static markup with no handlers attached.
 *
 * The menu layer needs no GPU — it is DOM plus profile state — so losing the
 * context should cost the player the ROUND, not the game. These tests force
 * context creation to fail and hold that line.
 */

/** Make every WebGL context request fail, before any app code runs. */
async function killWebGL(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // 2D still works — the game bakes procedural textures through it, and the
    // trace pad and course canvas are 2D. Only the GL flavours die.
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (/webgl/i.test(kind)) return null;
      return (orig as never as (k: string, ...r: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

test('the menus still work with no WebGL at all', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await killWebGL(page);
  await page.goto('/');

  // The landing paints and is interactive — this is the whole point.
  await expect(page.locator('#landing')).toHaveClass(/on/, { timeout: 60_000 });
  await expect(page.locator('#landingPlay')).toBeVisible();

  // The boot watchdog must NOT fire: it only paints when nothing set __booted,
  // and showLanding sets it. If this fails, the module died again.
  await page.waitForTimeout(11_000);
  await expect(page.locator('#jgReload')).toHaveCount(0);
  await expect(page.locator('#landing')).toHaveClass(/on/);

  // And the menus are genuinely wired, not just painted — open a destination
  // and a real overlay, which is what "isn't functional" meant.
  await page.locator('#landingProfile').dispatchEvent('click');
  await expect(page.locator('#records')).toBeVisible();
});

test('starting a round refuses with a message instead of a white screen', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await killWebGL(page);
  await page.goto('/');
  await expect(page.locator('#landing')).toHaveClass(/on/, { timeout: 60_000 });

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.locator('#landingPlay').dispatchEvent('pointerdown');
  await page.waitForTimeout(1200);

  // Refused, said so, and left the player on the landing rather than behind a
  // veil or a dead canvas.
  await expect(page.locator('#msg')).toContainText(/graphics/i);
  await expect(page.locator('#landing')).toHaveClass(/on/);
  await expect(page.locator('#loading')).not.toHaveClass(/on/);
  expect(errors, `starting a round threw:\n${errors.join('\n')}`).toEqual([]);
});

test('a lost context that never comes back still lets the player out', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as never as { __startRound?: unknown }).__startRound, undefined, {
    timeout: 120_000
  });
  await page.evaluate(() => (window as never as { __startRound: (o: unknown) => void }).__startRound({ name: 'Lost' }));
  await page.waitForFunction(() => !!(window as never as { __slice3d?: unknown }).__slice3d, undefined, { timeout: 120_000 });

  // Fire the real event. Nothing restores it — which is the GPU-process-death
  // case, and the one the first version of this handler could not survive:
  // the veil went up and only `webglcontextrestored` could take it down.
  await page.evaluate(() => {
    const c = document.getElementById('scene') as HTMLCanvasElement;
    c.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });
  await expect(page.locator('#loading')).toHaveClass(/on/);

  // The veil must STAY up for the grace period. It used to drop early: the
  // interrupted build had already armed a 4s safety-cap `hideLoading`, and that
  // stale timer lowered the veil the loss handler had just raised — uncovering
  // a hole that was never rebuilt, seconds before the abandon ran.
  await page.waitForTimeout(5000);
  await expect(page.locator('#loading'), 'a stale build timer lowered the loss veil').toHaveClass(/on/);

  // …and after the grace period the player is back on the landing with an
  // explanation, not stuck behind an opaque tap-swallowing veil forever.
  await expect(page.locator('#loading')).not.toHaveClass(/on/, { timeout: 30_000 });
  await expect(page.locator('#landing')).toHaveClass(/on/, { timeout: 15_000 });
  await expect(page.locator('#msg')).toContainText(/graphics/i);

  // And the way out has to stay shut: the engine object outlives its context,
  // so a menu that accepted "play" here would build against a dead GPU.
  await page.locator('#landingPlay').dispatchEvent('pointerdown');
  await page.waitForTimeout(1200);
  await expect(page.locator('#landing')).toHaveClass(/on/);
  await expect(page.locator('#msg')).toContainText(/graphics/i);

  expect(errors, `losing the context threw:\n${errors.join('\n')}`).toEqual([]);
});
