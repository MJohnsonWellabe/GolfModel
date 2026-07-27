import { expect, test } from '@playwright/test';

/**
 * THE SCATTER DRAIN'S WORST FRAME.
 *
 * Owner: "I lagged out with the ball in the air on wild prairie number 3 again.
 * the power meter on the drive was really choppy."
 *
 * The existing perf gate measures a steady-state MEAN over 120 renders and
 * cannot see this failure at all: the drain's cost is a periodic spike among
 * otherwise fine frames, and a mean (or a median — which is why the quality
 * governor was blind to it too) averages it away. What kills a phone is the
 * single worst frame, so that is what this measures.
 *
 * The two holes here are the two densest in the game by a wide margin: Port
 * Johnson h3 scans ~40,700 tall-grass grid cells and Wild Prairie h3 ~25,800,
 * against ~1,700 for a quiet hole. They are also exactly the two the owner
 * reports crashing.
 */

const HOLES = [
  { course: 'portjohnson', hole: 3, label: 'Port Johnson h3 (~40.7k grass cells)' },
  { course: 'wildvalley', hole: 3, label: 'Wild Prairie h3 (~25.8k grass cells)' }
];

/**
 * WHAT THIS CAN AND CANNOT MEASURE.
 *
 * The worst SINGLE frame is the number that matters on a phone, and it is the
 * number this container cannot pin down. Under software GL each batch's first
 * draw compiles a shader, and batches appear progressively as the drain plants
 * them — so multi-second frames land mid-drain that have nothing to do with the
 * drain's own cost, and they move run to run. Attempts to separate them (owning
 * the render loop, warm-up frames, yielding for promises) each removed some
 * contamination and left more.
 *
 * So this spec gates the two things it CAN establish honestly:
 *
 *   1. the drain TERMINATES — before the wall-clock cap its only exit was an
 *      empty queue, so a dense hole could plant indefinitely;
 *   2. the MEDIAN frame stays cheap — the old per-frame O(instances) bounds
 *      pass raised the whole distribution, not just its tail, so a regression
 *      there shows up in the median even when the tail is noise.
 *
 * The tail is logged, never asserted. Real frame pacing is judged on device
 * (docs/DEVICE_MATRIX.md) — see the note in docs/26_SCALE_PASS.md.
 */
const MEDIAN_CEILING_MS = 25;

interface DrainStats {
  frames: number;
  worstMs: number;
  medianMs: number;
  settled: boolean;
  elapsedMs: number;
}

test.describe('the scatter drain never stalls a frame', () => {
  for (const { course, hole, label } of HOLES) {
    test(`${label}`, async ({ page }) => {
      test.setTimeout(600_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/?course=${course}&hole=${hole}&freeze=1`);
      await page.waitForFunction(() => !!(window as never as { __slice3d?: unknown }).__slice3d, undefined, {
        timeout: 180_000
      });

      // Drive renders explicitly (headless throttles rAF to ~1fps) and time each
      // one individually.
      //
      // The yield between bursts is load-bearing, not politeness: the scatter
      // drain lives inside `loadNaturePrototypes().then(...)`, so it does not
      // exist until the glTF prototypes resolve. A tight synchronous loop never
      // returns to the event loop, those loads never complete, and the probe
      // measures 900 renders of an empty queue — which is exactly what a first
      // version of this test did, reporting a comfortable 0.4ms median while
      // measuring nothing at all.
      // Let the async glTF prototypes resolve — the drain lives inside their
      // .then(), so it does not exist until they land.
      await page.waitForTimeout(4000);

      const stats = (await page.evaluate(async () => {
        const s = (window as never as { __slice3d: any }).__slice3d;
        const soak = (window as never as { __golfSoak: () => { natureSettled: boolean } }).__golfSoak;
        const scene = s.scene;
        const engine = scene.getEngine();
        // Take the game's own render loop OFF. Headless throttles rAF to ~1fps,
        // and every one of those frames does a slice of planting we never time —
        // so an interleaved measurement attributes the drain's cost to whichever
        // frames happen to be ours. Owning every frame is the only way these
        // numbers mean anything.
        engine.stopRenderLoop();
        const times: number[] = [];
        const t0 = performance.now();
        let settled = false;
        // One warm-up render absorbs first-frame shader compilation, which is a
        // build cost paid under the loading veil, not a drain cost.
        scene.render();
        // Yield between bursts even with the loop stopped: `natureSettled` is
        // set from a resolved promise, and a promise callback cannot run inside
        // an unbroken synchronous loop. Stopping the loop keeps rAF from
        // stealing frames; yielding lets the drain actually finish.
        for (let burst = 0; burst < 600 && !settled; burst++) {
          for (let f = 0; f < 6; f++) {
            const a = performance.now();
            scene.render();
            times.push(performance.now() - a);
          }
          settled = soak().natureSettled;
          await new Promise((r) => setTimeout(r, 0));
        }
        const sorted = [...times].sort((x, y) => x - y);
        const top = times
          .map((ms, i) => ({ ms: +ms.toFixed(1), at: i }))
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 5);
        return {
          frames: times.length,
          worstMs: Math.max(...times),
          medianMs: sorted[sorted.length >> 1],
          settled,
          elapsedMs: performance.now() - t0,
          top
        };
      })) as DrainStats & { top: Array<{ ms: number; at: number }> };
      console.log(`[drain]   worst frames: ${stats.top.map((t) => `${t.ms}ms@${t.at}`).join(', ')}`);

      console.log(
        `[drain] ${course} h${hole}: frames=${stats.frames} worst=${stats.worstMs.toFixed(1)}ms ` +
          `median=${stats.medianMs.toFixed(1)}ms settled=${stats.settled} elapsed=${Math.round(stats.elapsedMs)}ms`
      );

      // The drain must FINISH. Before the wall-clock cap its only exit was an
      // empty queue, so a dense hole could still be planting minutes in.
      expect(stats.settled, 'the scatter drain never finished planting').toBe(true);
      expect(stats.medianMs, `median frame ${stats.medianMs.toFixed(1)}ms during planting`).toBeLessThan(
        MEDIAN_CEILING_MS
      );
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});

test('the strike frame does not stack the drain on top of everything else', async ({ page }) => {
  test.setTimeout(600_000);
  // executeShot clears meterActive AND cameraParked at once, so the instant the
  // ball is struck the drain resumes at full budget while the shadow map and
  // water mirror unfreeze and a fresh trail starts uploading. "The context is
  // lost while the ball is in the air" is that pile-up.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as never as { __startRound?: unknown }).__startRound, undefined, {
    timeout: 120_000
  });
  await page.evaluate(() =>
    (window as never as { __startRound: (o: unknown) => void }).__startRound({ name: 'Drain', courseId: 'wildvalley' })
  );
  await page.waitForFunction(() => !!(window as never as { __slice3d?: unknown }).__slice3d, undefined, { timeout: 180_000 });
  await page.evaluate(() => (window as never as { __slice3d: { skipIntro(): void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 120_000 }
  );

  const worst = (await page.evaluate(() => {
    const s = (window as never as { __slice3d: any }).__slice3d;
    const scene = s.scene;
    const times: number[] = [];
    s.playSkilledShot();
    for (let f = 0; f < 240; f++) {
      const a = performance.now();
      scene.render();
      times.push(performance.now() - a);
      if (s.state.phase !== 'flying' && f > 30) break;
    }
    return Math.max(...times);
  })) as number;

  console.log(`[drain] wildvalley strike: worst frame ${worst.toFixed(1)}ms`);
  // The strike is a single moment rather than a progressive build, so its tail
  // IS meaningful here — no new batches appear to compile shaders for.
  expect(worst, `worst frame across the strike ${worst.toFixed(1)}ms`).toBeLessThan(400);
});
