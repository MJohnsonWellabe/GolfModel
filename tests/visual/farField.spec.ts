import { test } from '@playwright/test';

/**
 * THE FAR FIELD, ON THE HOLES THAT ACTUALLY SHOW IT.
 *
 * The owner's report is about what sits between the last of the real ground
 * and the mountains: "I just want the background areas before those things to
 * not look like crap between the mountains/hills/horizon and the back of the
 * green." The sky sheet shoots hole 3 on every course, but on several courses
 * hole 3 is screened by its own treeline — these are the open views where the
 * defect actually lived.
 *
 * Local-only contact sheet, no assertions — a camera, not a gate.
 *
 *   npx playwright test -c playwright.config.ts tests/visual/farField.spec.ts
 */

const HUD = [
  'hud', 'badge', 'prompt', 'msg', 'cineBanner', 'banner', 'meter', 'clubBar',
  'shotShape', 'aimReadout', 'trueVisionBtn', 'captureBtn', 'aerialBtn',
  'tourBoardBtn', 'pauseBtn', 'builderBackBtn', 'designBtn', 'skipBtn',
  'swingBtn', 'loading'
];

const OPEN: Array<[string, number, string]> = [
  ['timberlinewest', 1, 'the owner\'s "lake of flat terrible looking texture"'],
  ['timberlinewest', 2, 'the tarn, wide open behind the green'],
  ['portjohnson', 3, 'sea course — must be UNCHANGED (no skirt, ocean horizon)'],
  ['redhollow', 1, 'the canyon rim, from an elevated tee'],
  ['maplevale', 2, 'blackwater under the autumn lid'],
  ['wildvalley', 3, 'the dunes, pulled in closer']
];

for (const [courseId, hole, what] of OPEN) {
  test(`farfield · ${courseId} h${hole} — ${what}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      localStorage.setItem('jg-quality', '0');
      const KEY = 'johnsons-golf-device-settings-v1';
      const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
      localStorage.setItem(KEY, JSON.stringify({ ...cur, graphics: 0, firstRoundDone: true }));
    });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as { __startRound?: unknown }).__startRound, undefined, {
      timeout: 120_000
    });
    await page.evaluate(
      (o) => (window as unknown as { __startRound: (x: unknown) => void }).__startRound(o),
      { name: 'Far field', courseId, hole, seed: 20260729 }
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
    // Everything textured and planted — same waits the art spec earned the
    // hard way (a fixed number shipped a cyan golfer twice).
    await page.waitForFunction(
      () => (window as unknown as { __slice3d: { scene: { isReady: (rt?: boolean) => boolean } } }).__slice3d.scene.isReady(false),
      undefined,
      { timeout: 120_000 }
    );
    await page.evaluate(async () => {
      const w = window as unknown as {
        __slice3d: { bodiesReady: Promise<void>; natureReady: () => Promise<void> };
      };
      const cap = (p: Promise<unknown>, ms: number): Promise<unknown> =>
        Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
      await cap(w.__slice3d.bodiesReady, 60_000);
      await cap(w.__slice3d.natureReady(), 60_000);
    });
    await page.waitForTimeout(3_000);
    await page.evaluate((ids) => {
      const style = document.createElement('style');
      style.textContent = `${ids.map((i) => `#${i}`).join(',')} { display: none !important; }`;
      document.head.appendChild(style);
    }, HUD);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tests/visual/__shots__/farfield/${courseId}-h${hole}.png` });
  });
}
