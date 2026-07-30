import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * A LOST CONTEXT MUST NOT REBUILD THE SCENE THAT KILLED IT.
 *
 * The owner's Pixel 8 crashed twice in one day, both times pinned Full: the
 * loss handler's `demoteQuality` call no-ops when the tier is pinned, so the
 * "rebuild cheaper" promise in the comments was false and the device relaunched
 * at the exact budget that had just run out of memory. This walks the real
 * path with `WEBGL_lose_context` and asserts the two things a crash now owes
 * the player: the pin steps down (persisted, so the NEXT session is cheaper
 * even if this one dies), and when no restore ever comes there is a persistent
 * reload banner rather than a toast they already missed.
 *
 * `loseContext()` without `restoreContext()` is exactly the GPU-process-death
 * shape: `webglcontextlost` fires, `webglcontextrestored` never does, and the
 * 8s grace expires into `abandonAfterContextLoss`.
 */
test('context loss · a pinned tier steps down and the reload banner appears', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    // A PLAYER pin at Full — the owner's exact configuration. Seeded on the
    // FIRST load only: addInitScript re-runs on every navigation, and this
    // spec ends with a reload whose entire point is observing that the pin
    // stepped down — re-seeding graphics: 0 there would overwrite the very
    // value under test (which is exactly how this spec first failed).
    const KEY = 'johnsons-golf-device-settings-v1';
    const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (cur.graphics === undefined) {
      localStorage.setItem(KEY, JSON.stringify({ ...cur, graphics: 0, firstRoundDone: true }));
    }
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __startRound?: unknown }).__startRound, undefined, {
    timeout: 120_000
  });
  await page.evaluate(
    (o) => (window as unknown as { __startRound: (x: unknown) => void }).__startRound(o),
    { name: 'Crash test', courseId: 'portjohnson', hole: 1, seed: 20260729 }
  );
  await page.waitForFunction(() => !!(window as unknown as { __slice3d?: unknown }).__slice3d, undefined, {
    timeout: 120_000
  });
  await page.evaluate(() => (window as unknown as { __slice3d: { skipIntro: () => void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as unknown as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 120_000 }
  );

  // Kill the context the way a dying GPU process does: lost, never restored.
  const lost = await page.evaluate(() => {
    const scene = (window as unknown as { __slice3d: { scene: { getEngine: () => { _gl?: WebGL2RenderingContext } } } })
      .__slice3d.scene;
    const gl = scene.getEngine()._gl;
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) return false;
    ext.loseContext();
    return true;
  });
  expect(lost, 'WEBGL_lose_context unavailable — cannot simulate').toBe(true);

  // The crash record and the pin step are written SYNCHRONOUSLY in the lost
  // handler — before the 8s grace, so they survive even if the tab dies next.
  await page.waitForFunction(
    () => {
      const s = JSON.parse(localStorage.getItem('johnsons-golf-device-settings-v1') || '{}');
      return Array.isArray(s.crashes) && s.crashes.length > 0;
    },
    undefined,
    { timeout: 10_000 }
  );
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('johnsons-golf-device-settings-v1') || '{}')
  );
  // The record names the tier that CRASHED, and where the pin moved.
  expect(settings.crashes[0].tier, 'the record carries the crashing tier').toBe(0);
  expect(settings.crashes[0].pinnedTo, 'the record says where the pin went').toBe(1);
  // The loop breaker itself: the persisted preference is one tier down, still
  // pinned — the next session builds High, not the Full that just died.
  expect(settings.graphics, 'the pin stepped Full -> High').toBe(1);

  // No restore ever comes, so after the grace period the player is back on the
  // landing with a PERSISTENT way out — not a toast that already vanished.
  await expect(page.locator('#gpuReload')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#gpuReload')).toContainText(/reload/i);

  // The banner's one job: a reload that comes back playable.
  await page.locator('#gpuReloadBtn').click();
  await page.waitForFunction(() => !!(window as unknown as { __startRound?: unknown }).__startRound, undefined, {
    timeout: 120_000
  });
  await expect(page.locator('#gpuReload')).toHaveCount(0);

  // The reloaded page must be on the stepped-down pin, not the killing one.
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('johnsons-golf-device-settings-v1') || '{}')
  );
  expect(after.graphics).toBe(1);

  // "Reload got a working page back" was never the whole promise — the owner's
  // report was that reload didn't let them get INTO a round at all. `gpuBlocked`
  // used to read a `gpuReady` flag latched false at module load, so on a device
  // slow to hand back a context this exact reload could come back to a live
  // page that still refused every round forever. `ensureEngine()` retries
  // construction at the point of the click instead of trusting a boot-time
  // snapshot — assert a round genuinely starts on the reloaded page, not just
  // that the banner is gone.
  await page.evaluate(
    (o) => (window as unknown as { __startRound: (x: unknown) => void }).__startRound(o),
    { name: 'Crash test', courseId: 'portjohnson', hole: 1, seed: 20260729 }
  );
  await page.waitForFunction(() => !!(window as unknown as { __slice3d?: unknown }).__slice3d, undefined, {
    timeout: 120_000
  });
  await page.evaluate(() => (window as unknown as { __slice3d: { skipIntro: () => void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as unknown as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 120_000 }
  );

  // The reload above rebuilds the WHOLE module — `armRenderLoop()` used to be
  // a boot-time-only top-level statement, so a page whose FIRST engine
  // construction failed (this exact reload, timed right) could reach
  // "aiming" with every JS-side system correct (HUD, meter, physics) and
  // still never paint a frame: the canvas stayed the page's own background
  // colour forever, with a fully working HUD on top of it (owner: "the whole
  // screen stayed green"). A phase/DOM check alone can't catch that — it has
  // to look at actual pixels.
  await page.waitForTimeout(400);
  const png = PNG.sync.read(await page.locator('#scene').screenshot());
  const seen = new Set<string>();
  for (let i = 0; i < png.data.length; i += 4 * 97 /* sample, not every pixel */) {
    seen.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`);
    if (seen.size > 1) break;
  }
  expect(seen.size, 'canvas rendered more than one flat colour').toBeGreaterThan(1);

  if (errors.length) throw new Error(errors.join('\n'));
});

test('context loss · an auto tier still takes the governor demote, no pin invented', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    const KEY = 'johnsons-golf-device-settings-v1';
    const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
    localStorage.setItem(KEY, JSON.stringify({ ...cur, graphics: 'auto', firstRoundDone: true }));
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __startRound?: unknown }).__startRound, undefined, {
    timeout: 120_000
  });
  await page.evaluate(
    (o) => (window as unknown as { __startRound: (x: unknown) => void }).__startRound(o),
    { name: 'Crash test', courseId: 'wildwood', hole: 1, seed: 20260729 }
  );
  await page.waitForFunction(() => !!(window as unknown as { __slice3d?: unknown }).__slice3d, undefined, {
    timeout: 120_000
  });
  await page.evaluate(() => (window as unknown as { __slice3d: { skipIntro: () => void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as unknown as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 120_000 }
  );
  await page.evaluate(() => {
    const scene = (window as unknown as { __slice3d: { scene: { getEngine: () => { _gl?: WebGL2RenderingContext } } } })
      .__slice3d.scene;
    scene.getEngine()._gl?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  await page.waitForFunction(
    () => {
      const s = JSON.parse(localStorage.getItem('johnsons-golf-device-settings-v1') || '{}');
      return Array.isArray(s.crashes) && s.crashes.length > 0;
    },
    undefined,
    { timeout: 10_000 }
  );
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('johnsons-golf-device-settings-v1') || '{}')
  );
  // Auto stays auto — the governor owns the tier; no phantom pin appears, and
  // the record carries no pin-step field for the note to misreport.
  expect(settings.graphics).toBe('auto');
  expect(settings.crashes[0].pinnedTo).toBeUndefined();
});
