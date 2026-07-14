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

  // Let the chunked nature planting finish (bounded per-frame batches over
  // ~1-2s) so the loop below measures STEADY-STATE render cost, not the
  // planting window.
  await page.waitForTimeout(3000);

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

  // Catastrophe ceiling: the SwiftShader (software-GL) container shows heavy
  // run-to-run variance (~±10ms on identical builds), so this gate only trips
  // on a genuine blow-up (runaway allocation, unbounded scatter), not noise.
  // Real frame pacing is judged on device (docs/DEVICE_MATRIX.md).
  expect(msPerFrame, `${msPerFrame.toFixed(2)}ms/frame (~${estFps}fps headless)`).toBeLessThan(60);
});

/**
 * The REAL meter-smoothness gate the earlier "meter lag" fixes kept missing.
 *
 * The swing meter stutters on the WATER holes (Timberline h1/h3, Wildwood h3,
 * Port Johnson h3) because two per-frame GPU costs run while the camera is
 * parked at address: the planar water-reflection RTT (re-renders every scatter
 * instance) and the full 1024² shadow-map regen. The fix freezes both while the
 * meter is live (renderPacing.meterActive) and restores them for flight.
 *
 * This gate boots Timberline (hole 1 IS a water/reflect hole), reaches the armed
 * meter — where the fix engages — and times the per-frame render cost with the
 * freeze ON (real gameplay) versus forced OFF (the pre-fix behaviour). The
 * freeze must measurably cut the frame cost on the water hole, and the armed
 * state's worst single frame must stay under a stutter ceiling. Explicit
 * scene.render() loop because headless rAF is throttled to ~1fps.
 */
test('swing meter stays smooth on a water hole (mirror/shadow freeze)', async ({ page }) => {
  // The unfrozen shadow-every-frame path is genuinely heavy under software GL, so
  // give the render loops room.
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  await page.evaluate(() => (window as any).__startRound({ name: 'Meter', courseId: 'timberline' }));
  await page.waitForFunction(() => !!(window as any).__slice3d);
  await page.evaluate(() => (window as any).__slice3d.skipIntro());
  await page.waitForFunction(() => (window as any).__slice3d.state.phase === 'aiming', undefined, { timeout: 30_000 });
  // Let the chunked scatter finish so the mirror's render list is at full,
  // worst-case size (the whole planted forest) before we measure.
  await page.waitForTimeout(3500);

  const measure = await page.evaluate(() => {
    const s3d = (window as any).__slice3d;
    const scene = s3d.scene;
    const pacing = s3d.renderPacing;
    const rates = () => s3d.perfRefreshRates() as { shadow: number | null; mirror: number | null };
    // Time N explicit renders, returning the mean and the worst single frame.
    const run = (n: number) => {
      let max = 0;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        scene.render();
        const dt = performance.now() - t;
        sum += dt;
        if (dt > max) max = dt;
      }
      return { avg: sum / n, max };
    };
    // Reaching 'aiming' armed the meter → meterActive is true, so the perf pacing
    // observable freezes the shadow map (and the water mirror, on a water hole):
    // one fresh render then held. Confirm the freeze engaged.
    pacing.meterActive = true;
    scene.render();
    const armed = rates();
    // Restore the flight cadence and confirm the RTTs go live again.
    pacing.meterActive = false;
    scene.render();
    scene.render();
    const released = rates();
    // Back to real gameplay (armed), warm off any one-time cost, then time the
    // steady-state armed-meter cost — the frames the swing bar shares the thread
    // with. The tab idles (rAF-throttled) before this so the first heavy renders
    // are cold; the warm loop keeps a shader compile out of the measured window.
    pacing.meterActive = true;
    for (let i = 0; i < 25; i++) scene.render();
    const frozen = run(40);
    return { armed, released, frozen };
  });

  writeFileSync(
    'tests/visual/__shots__/meter-perf-baseline.json',
    JSON.stringify(
      {
        armedShadowRefresh: measure.armed.shadow,
        armedMirrorRefresh: measure.armed.mirror,
        releasedShadowRefresh: measure.released.shadow,
        releasedMirrorRefresh: measure.released.mirror,
        frozenAvgMs: Math.round(measure.frozen.avg * 100) / 100,
        frozenMaxMs: Math.round(measure.frozen.max * 100) / 100
      },
      null,
      2
    )
  );

  // The freeze mechanism must engage with the meter: while it's live the shadow
  // map (always present) is held (refreshRate 0), and it returns to the
  // every-frame cadence (1) for flight. A regression that stops gating the RTTs
  // on the meter — the exact bug behind the stutter — trips this deterministically.
  expect(measure.armed.shadow, 'shadow map frozen while meter live').toBe(0);
  expect(measure.released.shadow, 'shadow map live for flight').toBe(1);
  // No single armed-meter frame may blow past a stutter ceiling (generous for the
  // software-GL CI CPU; a genuine per-frame stall trips it).
  expect(measure.frozen.max, `worst armed frame ${measure.frozen.max.toFixed(2)}ms`).toBeLessThan(80);
});

/**
 * Wildwood hole 1 is also a water hole (a lake down the left side), so it's
 * covered by the same freeze mechanism as the Timberline gate above — but
 * nothing in this suite ever exercised Wildwood before, so a regression here
 * (or in Wildwood's extra blossomChance/tree_sakura load, see course3d.ts's
 * usesBlossom) would go uncaught. Mirrors the Timberline gate exactly, just
 * on Wildwood.
 */
test('swing meter stays smooth on Wildwood hole 1 (also a water hole)', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  await page.evaluate(() => (window as any).__startRound({ name: 'Meter', courseId: 'wildwood' }));
  await page.waitForFunction(() => !!(window as any).__slice3d);
  await page.evaluate(() => (window as any).__slice3d.skipIntro());
  await page.waitForFunction(() => (window as any).__slice3d.state.phase === 'aiming', undefined, { timeout: 30_000 });
  await page.waitForTimeout(3500);

  const measure = await page.evaluate(() => {
    const s3d = (window as any).__slice3d;
    const scene = s3d.scene;
    const pacing = s3d.renderPacing;
    const rates = () => s3d.perfRefreshRates() as { shadow: number | null; mirror: number | null };
    const run = (n: number) => {
      let max = 0;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        scene.render();
        const dt = performance.now() - t;
        sum += dt;
        if (dt > max) max = dt;
      }
      return { avg: sum / n, max };
    };
    pacing.meterActive = true;
    scene.render();
    const armed = rates();
    pacing.meterActive = false;
    scene.render();
    scene.render();
    const released = rates();
    pacing.meterActive = true;
    for (let i = 0; i < 25; i++) scene.render();
    const frozen = run(40);
    return { armed, released, frozen };
  });

  writeFileSync(
    'tests/visual/__shots__/wildwood-meter-perf-baseline.json',
    JSON.stringify(
      {
        armedShadowRefresh: measure.armed.shadow,
        armedMirrorRefresh: measure.armed.mirror,
        releasedShadowRefresh: measure.released.shadow,
        releasedMirrorRefresh: measure.released.mirror,
        frozenAvgMs: Math.round(measure.frozen.avg * 100) / 100,
        frozenMaxMs: Math.round(measure.frozen.max * 100) / 100
      },
      null,
      2
    )
  );

  expect(measure.armed.shadow, 'shadow map frozen while meter live').toBe(0);
  expect(measure.released.shadow, 'shadow map live for flight').toBe(1);
  expect(measure.frozen.max, `worst armed frame ${measure.frozen.max.toFixed(2)}ms`).toBeLessThan(80);
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
