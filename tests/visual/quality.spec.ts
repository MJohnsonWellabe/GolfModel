import { expect, test } from '@playwright/test';

/**
 * ADAPTIVE RENDER QUALITY — the wiring half (policy is unit-tested in
 * tests/simulation/renderQuality.test.ts).
 *
 * Owner: "the game keeps crashing on the links style courses and on wild wood.
 * it's laggy on those then sometimes crashes all together."
 *
 * Two things have to hold for the governor to be safe to ship:
 *
 *  1. IT IS INERT UNDER AUTOMATION. Playwright renders through SwiftShader at
 *     1-3 fps on every course. A live governor would read that as a dying
 *     device, slam every spec to the cheapest tier, and quietly rewrite every
 *     reference screenshot in the suite. If this gate ever fails, the whole
 *     visual suite is measuring the wrong art.
 *
 *  2. THE TIERS ACTUALLY BUY SOMETHING. A quality knob that does not move real
 *     GPU bytes is worse than none — it hides the problem behind a setting.
 *     The measurement below is the ground-albedo bake, which the per-course
 *     texture inventory showed is 20.4 MB on every hole of every course, 2-4x
 *     the next largest texture in the scene, and is paid three times over
 *     during a build (source canvas, texture canvas, upload).
 */

/** Total texture bytes in the live scene, RGBA8 plus the mipmap tail. */
const texMB = (page: import('@playwright/test').Page): Promise<number> =>
  page.evaluate(() => {
    const scene = (window as never as { __slice3d: { scene: { textures?: any[] } } }).__slice3d.scene;
    let bytes = 0;
    for (const t of scene.textures ?? []) {
      const sz = t.getSize?.();
      if (sz?.width) bytes += sz.width * sz.height * 4 * (t.noMipmap ? 1 : 1.34);
    }
    return bytes / 1048576;
  });

async function loadHole(page: import('@playwright/test').Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as never as { __slice3d?: unknown }).__slice3d, undefined, {
    timeout: 120_000
  });
  await page.waitForTimeout(2500);
}

test('automation and the capture harness never move off full quality', async ({ page }) => {
  test.setTimeout(300_000);
  await loadHole(page, '/?course=wildwood&hole=1&freeze=1');
  const q = (await page.evaluate(() => (window as never as { __quality: () => any }).__quality())) as {
    tier: number;
    pinned: boolean;
    profile: { renderScale: number; bakeScale: number };
    hardwareScaling: number;
  };
  expect(q.pinned, 'governor pinned under Playwright').toBe(true);
  expect(q.tier).toBe(0);
  expect(q.profile.renderScale).toBe(1);
  expect(q.profile.bakeScale).toBe(1);
  // Drive a few hundred deliberately slow software frames: a live governor
  // would have demoted several tiers by now.
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const scene = (window as never as { __slice3d: { scene: { render(): void } } }).__slice3d.scene;
      for (let n = 0; n < 20; n++) scene.render();
    });
  }
  const after = (await page.evaluate(() => (window as never as { __quality: () => any }).__quality())) as {
    tier: number;
  };
  expect(after.tier, 'still tier 0 after 160 slow frames').toBe(0);
});

test('the cheap tier really is cheaper — GPU bytes, not just a label', async ({ page }) => {
  test.setTimeout(600_000);
  // Wildwood and Port Johnson: one of the two reported courses with a water
  // mirror and the game's densest garden scatter, and one of the wide-open
  // links holes. Both must get materially lighter.
  for (const course of ['wildwood', 'portjohnson']) {
    await loadHole(page, `/?course=${course}&hole=1&freeze=1&q=0`);
    const full = await texMB(page);
    const fullQ = (await page.evaluate(() => (window as never as { __quality: () => any }).__quality())) as {
      tier: number;
      hardwareScaling: number;
    };
    expect(fullQ.tier).toBe(0);

    await loadHole(page, `/?course=${course}&hole=1&freeze=1&q=3`);
    const cheap = await texMB(page);
    const cheapQ = (await page.evaluate(() => (window as never as { __quality: () => any }).__quality())) as {
      tier: number;
      hardwareScaling: number;
      profile: { waterReflectScale: number; staticShadows: boolean };
    };
    expect(cheapQ.tier).toBe(3);

    console.log(`[quality] ${course}: tier0 ${full.toFixed(1)}MB -> tier3 ${cheap.toFixed(1)}MB`);
    // The ground bake alone is 20.4 MB of the ~40-60 MB total, and tier 3 cuts
    // it to under a third — so a quarter off the whole scene is a floor, not a
    // target.
    expect(cheap, `${course} texture bytes at tier 3`).toBeLessThan(full * 0.75);
    // Fewer pixels: hardware scaling is 1/(dpr * renderScale), so a cheaper
    // tier means a LARGER scaling level.
    expect(cheapQ.hardwareScaling).toBeGreaterThan(fullQ.hardwareScaling);
    // …and the per-frame render targets are gone or frozen.
    expect(cheapQ.profile.waterReflectScale).toBe(0);
    expect(cheapQ.profile.staticShadows).toBe(true);
  }
});

test('every tier still builds a playable hole', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const q of [0, 1, 2, 3]) {
    // Wild Prairie: the densest decorative scatter in the game (~25k cards),
    // so it is the hole most changed by scatterScale and the likeliest to
    // break if a thinned grid divides badly.
    await loadHole(page, `/?course=wildvalley&hole=1&freeze=1&q=${q}`);
    const state = (await page.evaluate(() => {
      const s = (window as never as { __slice3d: { scene: { meshes: unknown[] } } }).__slice3d;
      return { meshes: s.scene.meshes.length };
    })) as { meshes: number };
    expect(state.meshes, `tier ${q} built meshes`).toBeGreaterThan(20);
  }
  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
});
