import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

/**
 * `natureBatching` acceptance gate.
 *
 * The batching pass (src/slice3d/natureBatch.ts) changes HOW the scatter is
 * drawn, never WHAT is drawn — so the only acceptance test that matters is a
 * pixel comparison of the same hole, same seed, same camera, rendered with the
 * flag on and with it off. Anything the batcher gets wrong (a dropped tint, a
 * mis-composed transform, an unused tail slot drawing at the origin, a batch
 * that culls when it should not) shows up here as differing pixels.
 *
 * It also records the scene-node count on both paths, which is the whole point
 * of the change: thousands of per-prop nodes collapse into a few dozen batches.
 */

const HOLES: Array<{ course: string; hole: number }> = [
  { course: 'portjohnson', hole: 1 }, // heaviest ground scatter (~1.7k tufts)
  { course: 'wildwood', hole: 1 }, // garden blooms — the tinted-instance path
  { course: 'timberline', hole: 1 } // tree-dominated + a water mirror
];

/** Fraction of pixels allowed to differ at all. Renders are not bit-exact run
 *  to run under software GL (the water mirror and the wind-driven atmosphere
 *  both animate), so this tolerates shimmer while still failing hard on a real
 *  visual regression — a dropped tint or a mis-placed prop moves percentages,
 *  not fractions of one. */
const MAX_DIFF_FRACTION = 0.01;

async function shoot(
  page: import('@playwright/test').Page,
  course: string,
  hole: number,
  batching: boolean
): Promise<{ png: Buffer; nodes: number }> {
  // ?freeze stops the animated atmosphere/water so the two captures compare a
  // still frame; ?cam/?hole place a deterministic camera (debugFlags.ts).
  await page.goto(`/?ff.natureBatching=${batching ? 'on' : 'off'}&freeze=1`);
  await page.waitForFunction(() => !!(window as any).__startRound);
  // Pin everything a round normally rolls: the seed (wind + pins) and the
  // loadout (an unlocked profile randomizes character/style/pal per round).
  // Without this the two captures differ for reasons that have nothing to do
  // with how the scatter is drawn.
  await page.evaluate(
    ([c, h]) =>
      (window as any).__startRound({
        name: 'Batch',
        courseId: c,
        hole: h,
        seed: 1234567,
        // Naming a golfer locks the loadout, so both captures show the same
        // character, style and pal (an unlocked profile re-rolls per round).
        character: 'chip',
        archetype: 'bigHitter'
      }),
    [course, hole] as [string, number]
  );
  await page.waitForFunction(() => !!(window as any).__slice3d);
  await page.evaluate(() => (window as any).__slice3d.skipIntro());
  await page.waitForFunction(() => (window as any).__slice3d.state.phase === 'aiming', undefined, {
    timeout: 60_000
  });
  // WAIT FOR THE GOLFER'S BODY. It is a separate async glTF and nothing in the
  // game blocks play on it (deliberately — a slow character fetch must never
  // hold up a shot), so the capture has to wait on it explicitly.
  //
  // Nothing here used to, and it passed by luck: the scatter drain ran until
  // its queue emptied, which took long enough that the body always arrived
  // first. Once the drain gained a time ceiling, `natureSettled` could go true
  // while the body was still in flight — and a frame with a golfer against a
  // frame without one differs by ~2.8% of pixels, none of it scatter. The gate
  // would have been reporting a batching regression that did not exist.
  await page.evaluate(() => (window as any).__slice3d.bodiesReady);
  // Let the time-sliced planting drain fully — a capture mid-drain would
  // compare two different amounts of scatter, not two ways of drawing it.
  // Headless throttles rAF to ~1fps, so the drain (which rides the render loop)
  // has to be driven explicitly, exactly as the soak spec does.
  let settled = false;
  for (let burst = 0; burst < 80 && !settled; burst++) {
    settled = (await page.evaluate(() => {
      const scene = (window as any).__slice3d.scene;
      for (let i = 0; i < 15; i++) scene.render();
      return (window as any).__golfSoak().natureSettled as boolean;
    })) as boolean;
    await page.waitForTimeout(100);
  }
  expect(settled, `${course} h${hole} (batching ${batching}) planted fully`).toBe(true);
  await page.evaluate(() => {
    const scene = (window as any).__slice3d.scene;
    for (let i = 0; i < 10; i++) scene.render();
  });
  const nodes = await page.evaluate(() => {
    const s = (window as any).__slice3d.scene;
    return s.meshes.filter((m: { name: string }) => m.name.startsWith('nat') && !m.name.startsWith('natProto'))
      .length;
  });
  const png = await page.screenshot({ type: 'png' });
  return { png, nodes };
}

for (const { course, hole } of HOLES) {
  test(`natureBatching renders ${course} h${hole} identically`, async ({ page }) => {
    test.setTimeout(300_000);
    const off = await shoot(page, course, hole, false);
    const on = await shoot(page, course, hole, true);

    writeFileSync(`tests/visual/__shots__/batch-${course}-off.png`, off.png);
    writeFileSync(`tests/visual/__shots__/batch-${course}-on.png`, on.png);
    const a = PNG.sync.read(off.png);
    const b = PNG.sync.read(on.png);
    expect(`${a.width}x${a.height}`).toBe(`${b.width}x${b.height}`);

    let differing = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      // Per-channel tolerance absorbs software-GL dithering; anything a human
      // could see clears it comfortably.
      if (
        Math.abs(a.data[i] - b.data[i]) > 12 ||
        Math.abs(a.data[i + 1] - b.data[i + 1]) > 12 ||
        Math.abs(a.data[i + 2] - b.data[i + 2]) > 12
      ) {
        differing++;
      }
    }
    const fraction = differing / (a.width * a.height);
    console.log(
      `BATCHING ${course} h${hole}: nodes ${off.nodes} -> ${on.nodes}, differing pixels ${(fraction * 100).toFixed(3)}%`
    );

    expect(fraction, `${(fraction * 100).toFixed(3)}% of pixels differ with batching on`).toBeLessThan(
      MAX_DIFF_FRACTION
    );
    // A course with NO scatter renders identically on both paths and would
    // sail through the pixel comparison — which is exactly what happened when a
    // loader-registration change silently stopped every .glb from loading. Both
    // sides must actually have planted something.
    expect(off.nodes, 'the un-batched path must plant real props').toBeGreaterThan(200);
    expect(on.nodes, 'the batched path must plant real props').toBeGreaterThan(0);
    // The change has to actually collapse the scene graph, or it is not doing
    // its job — batches must be a small fraction of the props they replace.
    expect(on.nodes, 'batched scatter must collapse the per-prop scene nodes').toBeLessThan(
      Math.max(60, off.nodes * 0.35)
    );
  });
}
