import { expect, test } from '@playwright/test';

/**
 * Tree camera-occlusion guard. A tree standing between the camera and the golfer
 * is swapped for a translucent "ghost" so the character never vanishes behind
 * foliage (course3d.updateTreeOcclusion). Two ways this silently breaks:
 *   1) a course plants ZERO occlusion candidates — the Sable Bay island palms
 *      regressed exactly this way (skipped as "trees on the green collar"), so a
 *      palm could never fade;
 *   2) the geometry test stops finding the tree that's actually in the way.
 * This spec boots the relevant holes head-on and asserts both: candidates exist,
 * and forcing the camera onto the far side of a real tree produces ghosts.
 */

type Cand = { x: number; y: number; r: number; parts: number };

async function boot(page: import('@playwright/test').Page, course: string, hole: number): Promise<void> {
  await page.goto(`/?course=${course}&hole=${hole}&cam=tee`);
  await page.waitForFunction(() => (window as unknown as { __shotReady?: boolean }).__shotReady === true, undefined, {
    timeout: 60_000
  });
}

// One test PER course so each boots on a fresh page/context. Booting all three
// heavy WebGL scenes on a single reused page exhausts the CI software renderer
// and the third navigation aborts ("frame detached") — the isolation fixes it.
for (const [course, hole, min] of [
  ['timberline', 1, 50],
  ['wildwood', 1, 50],
  ['sablebay', 2, 4] // the 4 accent palms ringing the island green
] as const) {
  test(`${course} h${hole} registers occlusion candidates`, async ({ page }) => {
    await boot(page, course, hole);
    const n = await page.evaluate(() => (window as any).__slice3d.occlusionCandidates().length as number);
    expect(n, `${course} h${hole} occlusion candidates`).toBeGreaterThanOrEqual(min);
  });
}

test('a tree between the camera and the golfer is faded to a ghost', async ({ page }) => {
  await boot(page, 'timberline', 1);
  const ghosts = await page.evaluate(() => {
    const s = (window as any).__slice3d;
    const g = s.golferAbs();
    const cands = (s.occlusionCandidates() as Cand[])
      .map((c) => ({ ...c, bx: c.x, bz: -c.y, d: Math.hypot(c.x - g.x, -c.y - g.z) }))
      .sort((a, b) => a.d - b.d);
    const t = cands[0];
    const ux = (t.bx - g.x) / t.d;
    const uz = (t.bz - g.z) / t.d;
    // Camera just past the nearest tree, looking back at the golfer's head —
    // debugTreeOcclusion forces the throttled recompute and returns the live
    // ghost count.
    return s.debugTreeOcclusion(t.bx + ux * (t.r + 8), g.y + 3.5, t.bz + uz * (t.r + 8));
  });
  expect(ghosts, 'ghost stand-ins created for the occluding tree').toBeGreaterThan(0);
});
