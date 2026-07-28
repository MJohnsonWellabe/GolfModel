import { expect, test } from '@playwright/test';

/**
 * WHAT A ROUND LEAVES BEHIND.
 *
 * The owner's phone dies on Wild Prairie hole 3 — the THIRD scene built in the
 * tab — with the quality governor already pinned to its cheapest tier. A device
 * that survives holes 1 and 2 at a budget and then dies at the same budget on
 * hole 3 is the signature of accumulation, not of one expensive hole: each cut
 * is supposed to hand back everything the last hole took.
 *
 * This gate plays three holes for real and samples what the ENGINE is holding
 * at the first address of each. The engine-level texture cache is the load-
 * bearing number: it outlives any one scene, so anything a disposed hole failed
 * to give back shows up there and nowhere else. Scene counts are sampled too,
 * to tell a scene that over-builds apart from one that under-disposes.
 *
 * The assertion is deliberately about SHAPE, not absolute size: hole 2 and hole
 * 3 may legitimately differ from hole 1 (different props, different hazards),
 * but a hole must not cost strictly more than its predecessor every single time
 * — that is a ratchet, and a ratchet is what kills a phone on the third hole.
 */

interface Sample {
  hole: number;
  engineTextures: number;
  meshes: number;
  materials: number;
  textures: number;
}

const sample = async (page: import('@playwright/test').Page, hole: number): Promise<Sample> =>
  page.evaluate((h) => {
    const s3d = (window as never as { __slice3d: { scene: import('@babylonjs/core').Scene } }).__slice3d;
    const scene = s3d.scene;
    const engine = scene.getEngine() as unknown as { getLoadedTexturesCache(): unknown[] };
    return {
      hole: h,
      engineTextures: engine.getLoadedTexturesCache().length,
      meshes: scene.meshes.length,
      materials: scene.materials.length,
      textures: scene.textures.length
    };
  }, hole);

/** Drive the live game to the first address of the next hole. Mirrors
 *  roundRecording.spec.ts's loop: `__slice3d` is null between holes while the
 *  next scene builds, which means WAIT, never STOP. */
async function playToNextAddress(page: import('@playwright/test').Page, fromSeq: number): Promise<number> {
  for (let guard = 0; guard < 600; guard++) {
    const step = await page.evaluate(
      (seq) => {
        const s = (
          window as never as {
            __slice3d?: {
              seq: number;
              state: { phase: string };
              skipIntro(): void;
              playSkilledShot(): boolean;
              settleFlight(): boolean;
            };
          }
        ).__slice3d;
        if (!s) return 'wait';
        if (s.seq > seq && s.state.phase === 'aiming') return 'arrived';
        if (s.state.phase === 'intro') {
          s.skipIntro();
          return 'intro';
        }
        if (s.state.phase === 'flying') {
          s.settleFlight();
          return 'settle';
        }
        if (s.state.phase === 'aiming') {
          s.playSkilledShot();
          return 'hit';
        }
        return 'wait';
      },
      fromSeq
    );
    if (step === 'arrived') {
      // Let the fresh hole finish everything it defers — the async model loads
      // and the scatter drain — before counting what it holds.
      await page.evaluate(() => (window as never as { __slice3d: { natureReady(): unknown } }).__slice3d.natureReady());
      await page.waitForTimeout(1200);
      return page.evaluate(() => (window as never as { __slice3d: { seq: number } }).__slice3d.seq);
    }
    await page.waitForTimeout(step === 'wait' ? 200 : 80);
  }
  throw new Error('never reached the next hole');
}

test('three holes in a row hand back what they took', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as never as { __startRound?: unknown }).__startRound);
  await page.evaluate(() =>
    (window as never as { __startRound(o: unknown): void }).__startRound({ name: 'Leak', courseId: 'wildvalley' })
  );
  await page.waitForFunction(() => !!(window as never as { __slice3d?: unknown }).__slice3d);
  await page.evaluate(() => (window as never as { __slice3d: { skipIntro(): void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 60_000 }
  );
  await page.evaluate(() => (window as never as { __slice3d: { natureReady(): unknown } }).__slice3d.natureReady());
  await page.waitForTimeout(1200);

  const samples: Sample[] = [await sample(page, 1)];
  let seq = await page.evaluate(() => (window as never as { __slice3d: { seq: number } }).__slice3d.seq);
  for (const hole of [2, 3]) {
    seq = await playToNextAddress(page, seq);
    samples.push(await sample(page, hole));
  }
  console.log('RETENTION ' + JSON.stringify(samples));

  // A hole's scene must not be strictly bigger than the one before it, twice
  // running, on any counter — that is the ratchet.
  for (const key of ['engineTextures', 'meshes', 'materials', 'textures'] as const) {
    const [a, b, c] = samples.map((s) => s[key]);
    expect(
      b > a && c > b,
      `${key} ratchets up every hole: ${a} → ${b} → ${c}`
    ).toBe(false);
  }
  // And the engine's texture cache — the one number that outlives a scene —
  // must not have grown by more than a hole's worth over two cuts.
  const grew = samples[2].engineTextures - samples[0].engineTextures;
  expect(grew, `engine texture cache grew ${grew} over two hole cuts`).toBeLessThanOrEqual(
    Math.round(samples[0].engineTextures * 0.25)
  );
});
