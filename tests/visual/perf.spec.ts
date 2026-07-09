import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * Phase 9 perf gate. Headless Chromium backgrounds the tab and throttles
 * requestAnimationFrame to ~1fps, so `engine.getFps()` is meaningless here.
 * Instead we time a tight `scene.render()` loop (CPU-bound, immune to rAF
 * throttling) to get the per-frame render cost — the number that actually
 * governs on-device FPS. We assert a conservative per-frame ceiling that trips
 * on a catastrophic regression (a stall, a runaway allocation) and record the
 * measurement to a baseline JSON. Device-accurate FPS lives in
 * docs/DEVICE_MATRIX.md; docs 09 targets 60fps / 30 floor on device.
 */
test('per-frame render cost stays under the regression ceiling', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  await page.evaluate(() => (window as any).__startRound({ name: 'Perf' }));
  await page.waitForFunction(() => !!(window as any).__slice3d);
  await page.evaluate(() => (window as any).__slice3d.skipIntro());
  await page.waitForFunction(() => (window as any).__slice3d.state.phase === 'aiming', undefined, { timeout: 30_000 });
  const loadMs = Date.now() - t0;

  // Warm up, then time 120 explicit renders.
  const msPerFrame = await page.evaluate(() => {
    const scene = (window as any).__slice3d.scene;
    for (let i = 0; i < 20; i++) scene.render();
    const start = performance.now();
    const N = 120;
    for (let i = 0; i < N; i++) scene.render();
    return (performance.now() - start) / N;
  });
  const estFps = Math.round(1000 / msPerFrame);

  writeFileSync(
    'tests/visual/__shots__/perf-baseline.json',
    JSON.stringify({ loadMs, msPerFrame: Math.round(msPerFrame * 100) / 100, estFpsHeadless: estFps }, null, 2)
  );

  // Generous ceiling: a healthy scene renders in a few ms headless; >40ms/frame
  // (<25fps) signals a real regression, not machine noise.
  expect(msPerFrame, `${msPerFrame.toFixed(2)}ms/frame (~${estFps}fps headless)`).toBeLessThan(40);
});
