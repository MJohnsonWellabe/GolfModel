import { test } from '@playwright/test';

/**
 * THE COURSE-CARD ART, RE-SHOT.
 *
 * `assets/marketing/img/<course>.png` are in-game captures referenced by exact
 * filename from the course cards (`src/data/courseRoster.ts`), the marketing
 * page (`src/marketing/config.ts`) and one landing background. They were made by
 * hand and they predate the per-course painted skies, so every one of them shows
 * a sky the game no longer draws (owner: "Redo the course art pictures now that
 * the skies are different").
 *
 * Local-only and assertion-free, like the other contact sheets — `visual.yml`
 * runs the asserting specs, not this. Run it, look at the sheet in
 * `tests/visual/__shots__/art/`, and copy the frames you like into
 * assets/marketing/img/ (then `node scripts/optimize-marketing.mjs`). It is a
 * camera, not a gate.
 *
 *   npx playwright test -c playwright.config.ts tests/visual/courseArt.spec.ts
 */

/**
 * One hole per course, chosen to keep each picture's existing SUBJECT — the
 * filenames are promises about what is in the frame, and the cards are laid out
 * around them. Timberline West is the exception: it has never had its own
 * picture (it reused East's) despite now having a deliberately different sky,
 * so it gets one.
 */
const ART: Array<{ course: string; hole: number; out: string; subject: string }> = [
  { course: 'wildwood', hole: 3, out: 'wildwood-cherry', subject: 'cherry blossom down the long meadow' },
  { course: 'sablebay', hole: 2, out: 'sablebay-island', subject: 'the island green, and the boats behind it' },
  { course: 'timberline', hole: 2, out: 'timberline-pond', subject: 'the tarn under alpine sky' },
  // h3, not h1: the Pine Alley is a closed tunnel of canopy, so the picture had
  // no sky and no distance in it — the one thing West's card has to show is
  // that it is NOT East. The Gauntlet opens onto the range.
  { course: 'timberlinewest', hole: 3, out: 'timberlinewest-gauntlet', subject: 'the gauntlet, open to the range' },
  { course: 'portjohnson', hole: 2, out: 'portjohnson-bunker', subject: 'the Redan and its revetted pots' },
  { course: 'redhollow', hole: 3, out: 'redhollow-chasm', subject: 'the canyon under storm light' },
  { course: 'wildvalley', hole: 1, out: 'wildvalley-blowout', subject: 'the blowout at golden hour' },
  { course: 'maplevale', hole: 2, out: 'maplevale-tarn', subject: 'blackwater under the autumn lid' }
];

/** Everything the player needs and a picture does not. */
const HUD = [
  'hud',
  'badge',
  'prompt',
  'msg',
  'cineBanner',
  'banner',
  'meter',
  'clubBar',
  'shotShape',
  'aimReadout',
  'trueVisionBtn',
  'captureBtn',
  'aerialBtn',
  'tourBoardBtn',
  'pauseBtn',
  'builderBackBtn',
  'designBtn',
  'skipBtn',
  'swingBtn',
  'loading'
];

for (const { course, hole, out, subject } of ART) {
  test(`art · ${out} (${subject})`, async ({ page }) => {
    test.setTimeout(300_000);
    // Landscape, at the size the shipped art already uses. deviceScaleFactor is
    // 1 in playwright.config, so the PNG comes out exactly this size.
    await page.setViewportSize({ width: 1600, height: 1000 });

    // PIN FULL QUALITY. The governor measures the headless renderer like any
    // other device and would happily shoot the marketing art at a downgraded
    // tier — thinner grass, a smaller shadow map, no water mirror. Seed both the
    // remembered tier and the device preference before any script runs.
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
      { name: 'Bite-Sized Golf', courseId: course, hole, seed: 20260729 }
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

    // MODELS LOAD LATE. A capture at 10s caught the lighthouse and the golfer
    // rendering pure white — the GLBs had not swapped in. 22s is what it takes
    // on the heaviest course here.
    await page.waitForTimeout(22_000);

    // A STYLESHEET, not inline styles. The aim readout re-shows itself on every
    // aim tick (`aimReadoutEl.style.display = 'flex'`), so an inline `none` is
    // painted over within a frame — the first sheet came back with the yardage
    // chip sitting across the green. A rule with `!important` outranks an inline
    // declaration that has none, so this survives whatever the game does next.
    await page.evaluate((ids) => {
      const style = document.createElement('style');
      style.textContent = `${ids.map((i) => `#${i}`).join(',')} { display: none !important; }`;
      document.head.appendChild(style);
    }, HUD);
    await page.waitForTimeout(800);

    // NOT under test-results/: that is Playwright's outputDir and it is WIPED at
    // the start of every run, so re-shooting one course threw away the other
    // seven. __shots__ is where the other contact sheets live and Playwright
    // does not manage it.
    await page.screenshot({ path: `tests/visual/__shots__/art/${out}.png` });
  });
}
