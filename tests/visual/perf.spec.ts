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
  const bakeMs = await page.evaluate(() => (window as any).__lastBakeMs ?? 0);

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
    JSON.stringify(
      { loadMs, bakeMs: Math.round(bakeMs), msPerFrame: Math.round(msPerFrame * 100) / 100, estFpsHeadless: estFps },
      null,
      2
    )
  );

  // Generous ceiling: a healthy scene renders in a few ms headless; >40ms/frame
  // (<25fps) signals a real regression, not machine noise.
  expect(msPerFrame, `${msPerFrame.toFixed(2)}ms/frame (~${estFps}fps headless)`).toBeLessThan(40);
});

/**
 * The ground-albedo bake is a SYNCHRONOUS main-thread stall on every hole build
 * (the "laggy hole" freeze) that the render-loop timer above never sees. Boot
 * Timberline — the heaviest theme (lush grass + real turf/sand grain + green
 * columns) on a big world — and gate the bake directly. No render loop here (a
 * heavy scene under swiftshader is too slow to time), so this stays fast. The
 * adaptive bake scale (course3d.ts) caps the texel budget, which is what keeps
 * this bounded and lets grain run on every course without the freeze.
 */
test('ground bake stays bounded on the heaviest theme', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  await page.evaluate(() => (window as any).__startRound({ name: 'Bake', courseId: 'timberline' }));
  await page.waitForFunction(() => (window as any).__lastBakeMs !== undefined, undefined, { timeout: 30_000 });
  const bakeMs = await page.evaluate(() => (window as any).__lastBakeMs ?? 0);
  // Generous ceiling for the swiftshader CI CPU — an unbounded-scale regression
  // (or grain on a huge world without the adaptive cap) trips it; today's bake
  // runs comfortably under it.
  expect(bakeMs, `${Math.round(bakeMs)}ms ground bake (Timberline)`).toBeLessThan(2500);
});
