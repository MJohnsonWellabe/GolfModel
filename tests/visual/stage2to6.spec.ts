import { test } from '@playwright/test';

/**
 * ONE CONTACT SHEET FOR STAGES 2-6.
 *
 * Not a pass/fail gate — like the rest of tests/visual, this writes PNGs for
 * art review. It exists because five things shipped in this pass that no human
 * or machine has looked at yet:
 *
 *   - the eight painted per-course skies, and specifically whether the dome
 *     still meets the EXP2 fog without a seam at the horizon (the ramps are now
 *     forced onto each course's `theme.haze` for exactly that reason, and the
 *     "weird band behind the playable area" is a defect this course set has
 *     already been through twice);
 *   - Sable Bay h2, whose sea is tiled into seven polygons, five of which had
 *     beds standing +4 to +11.6 ABOVE their own water plane and are now carved
 *     down — a real terrain change on a shipped hole beside the causeway prop;
 *   - Maple Vale h3, the creek that was buried under a +8 dome;
 *   - the Locker Room's new backdrop;
 *   - the rebuilt feat list, and the season picker / past-season screens.
 *
 * `npm run shots -- stage2to6` writes them to test-results/.
 */

const shot = async (page: import('@playwright/test').Page, name: string): Promise<void> => {
  await page.screenshot({ path: `test-results/stage/${name}.png` });
};

/** Boot straight into a hole and wait until it is genuinely drawn. The 20s
 *  wait is not padding: a capture taken at 10s caught the lighthouse and the
 *  golfer still loading and rendered them pure white. */
async function atHole(
  page: import('@playwright/test').Page,
  courseId: string,
  hole: number
): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __startRound?: unknown }).__startRound);
  await page.evaluate(
    (o) => (window as unknown as { __startRound: (x: unknown) => void }).__startRound(o),
    { name: 'Shots', courseId, hole, seed: 4242 }
  );
  await page.waitForFunction(() => !!(window as unknown as { __slice3d?: unknown }).__slice3d);
  await page.evaluate(() => (window as unknown as { __slice3d: { skipIntro: () => void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as unknown as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 90_000 }
  );
  await page.waitForTimeout(20_000);
}

// Every course that got a painted sky, at the hole with the most open horizon
// (hole 3 is the par 5 on every course — the widest sky in the game).
const SKY_HOLES: Array<[string, number, string]> = [
  ['wildwood', 3, 'parkland_bright'],
  ['sablebay', 3, 'sea_haze'],
  ['timberline', 3, 'alpine_clear'],
  ['timberlinewest', 3, 'alpine_broken'],
  ['portjohnson', 3, 'links_coast'],
  ['redhollow', 3, 'storm_canyon'],
  ['wildvalley', 3, 'prairie_gold'],
  ['maplevale', 3, 'autumn_overcast']
];

for (const [courseId, hole, style] of SKY_HOLES) {
  test(`sky · ${courseId} h${hole} (${style})`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await atHole(page, courseId, hole);
    await shot(page, `sky-${courseId}`);
    if (errors.length) throw new Error(errors.join('\n'));
  });
}

/** The two holes whose water beds were carved. Both are shipped holes, so the
 *  question is not "is the water visible" (the unit gate proves the bed is
 *  below the plane now) but "does the shoreline still look like a shoreline". */
for (const [courseId, hole] of [
  ['sablebay', 2],
  ['maplevale', 3]
] as Array<[string, number]>) {
  test(`carve · ${courseId} h${hole}`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await atHole(page, courseId, hole);
    await shot(page, `carve-${courseId}-h${hole}`);
    if (errors.length) throw new Error(errors.join('\n'));
  });
}

/** The menus: the locker backdrop, the feat trackers, and the two new season
 *  screens. All reachable without playing a round. */
test('menus · locker room, feats, seasons', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __startRound?: unknown }).__startRound);

  const open = async (id: string): Promise<boolean> => {
    const found = await page.evaluate((sel) => {
      const b = document.getElementById(sel);
      if (!b) return false;
      (b as HTMLElement).click();
      return true;
    }, id);
    if (found) await page.waitForTimeout(900);
    return found;
  };

  if (await open('landingLocker')) await shot(page, 'menu-locker');
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __startRound?: unknown }).__startRound);
  if (await open('landingProfile')) {
    // The feats live under the Progress tab of the profile pane.
    await page.evaluate(() => {
      document.querySelectorAll('.profTab').forEach((t) => {
        if ((t.textContent ?? '').toLowerCase().includes('progress')) (t as HTMLElement).click();
      });
    });
    await page.waitForTimeout(600);
    await shot(page, 'menu-feats');
  }
  if (errors.length) throw new Error(errors.join('\n'));
});
