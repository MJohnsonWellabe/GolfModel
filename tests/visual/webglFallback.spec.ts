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

/**
 * THE MENUS AFTER A CRASH — the owner's Pixel 8 report.
 *
 * "It did load back out to menu with an option to resume but then none of the
 * menus actually worked. It wasn't responsive to clicks it was like I was
 * clicking in the wrong spots."
 *
 * The abandon path could not call `dispose()` — disposing a scene whose context
 * has died throws — and `dispose()` was where every listener was removed. So the
 * dead scene kept three WINDOW-level pointer listeners, and `onTraceMove` calls
 * `preventDefault()` on every pointermove while a drag is live. With
 * `touch-action: none` set globally, that suppresses tap synthesis and stops the
 * landing — which is `overflow: auto` and taller than a phone screen — from
 * scrolling.
 *
 * This starts a real trace drag, kills the context mid-gesture, and then uses
 * the menu the way a player would.
 */
test('the menus still work after a crash mid-swing', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // The trace swing is a per-device choice; seed it the way Settings writes it,
  // because a live drag is what arms the window listeners.
  await page.addInitScript(() => {
    const KEY = 'johnsons-golf-device-settings-v1';
    const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
    localStorage.setItem(KEY, JSON.stringify({ ...cur, swingType: 'trace' }));
  });
  await page.goto('/?ff.dragSwing=on');
  await page.waitForFunction(() => !!(window as never as { __startRound?: unknown }).__startRound, undefined, {
    timeout: 120_000
  });
  await page.evaluate(() =>
    (window as never as { __startRound: (o: unknown) => void }).__startRound({ name: 'Lost', courseId: 'sablebay', seed: 24680 })
  );
  await page.waitForFunction(() => !!(window as never as { __slice3d?: unknown }).__slice3d, undefined, { timeout: 120_000 });
  await page.evaluate(() => (window as never as { __slice3d: { skipIntro(): void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 90_000 }
  );
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 90_000 });

  // Put a finger down on the trace pad and start pulling — this is the state
  // that leaves a drag live on the scene.
  const pad = page.locator('#tracePad');
  const box = await pad.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6, { steps: 6 });
  }

  // Kill it mid-gesture, and let the grace period expire with no restore.
  await page.evaluate(() => {
    const c = document.getElementById('scene') as HTMLCanvasElement;
    c.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });
  await expect(page.locator('#loading')).not.toHaveClass(/on/, { timeout: 40_000 });
  await expect(page.locator('#landing')).toHaveClass(/on/, { timeout: 15_000 });
  // The finger comes up on the menu, exactly as the player's would.
  await page.mouse.up();

  // THE ASSERTION THAT MATTERS: the menu responds to an ordinary tap. Not a
  // dispatchEvent — a real click, which is what stops being synthesised when
  // something is calling preventDefault on every move.
  // A REAL click on the landing's primary action — not a dispatchEvent, which
  // would bypass exactly the layer that was broken. It is refused (the context
  // is gone), and that refusal arriving is the proof the menu is live.
  await page.locator('#landingPlay').click({ timeout: 15_000 });
  await expect(page.locator('#msg')).toContainText(/graphics/i, { timeout: 15_000 });
  await expect(page.locator('#landing')).toHaveClass(/on/);

  // And nothing in-round is left displayed over the menu or holding a listener.
  for (const id of ['#clubBar', '#aerialBtn', '#shotShape', '#tracePad', '#meter', '#tourBoardBtn']) {
    await expect(page.locator(id), `${id} survived the crash`).toBeHidden();
  }
  expect(await page.locator('.storeConfirm').count(), 'a modal was left above the menu').toBe(0);

  expect(errors, `crashing mid-swing threw:\n${errors.join('\n')}`).toEqual([]);
});
