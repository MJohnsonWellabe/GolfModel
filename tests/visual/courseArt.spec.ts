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

    // WAIT FOR THE ACTUAL SIGNAL, NOT A NUMBER.
    //
    // This used to be a flat 22s, chosen because a 10s capture had caught the
    // lighthouse and the golfer rendering pure white with their GLBs not yet
    // swapped in. A fixed wait is a guess about a machine, and the guess
    // expired: on a cold dev server two of the eight came back with a CYAN
    // golfer and a WHITE pal — models present, textures not. Pulling the
    // previously SHIPPED cards showed the same defect had already gone out
    // once, on Wildwood's pal, unnoticed.
    //
    // `scene.isReady(false)` is the signal that actually covers it. Probing a
    // live scene showed the not-ready meshes are exactly `Clone of Fox` (the
    // pal) and `Clone of m_5_primitive0/1` (the golfer), and the one not-ready
    // texture is `EnvironmentBRDFTexture` — the lookup table every PBRMaterial
    // needs before it can render. Until Babylon has generated it, those
    // characters draw as untextured placeholders. That is the whole defect.
    //
    // `false`, NOT `true`: the argument is checkRenderTargets, and this scene
    // keeps a water mirror and a shadow map that re-render every frame and
    // never report ready. Asking for `true` waits forever — it is what made
    // this spec crawl and then time out.
    await page.waitForFunction(
      () => (window as unknown as { __slice3d: { scene: { isReady: (rt?: boolean) => boolean } } }).__slice3d.scene.isReady(false),
      undefined,
      { timeout: 120_000 }
    );

    // ...AND the two load promises, each CAPPED. `bodiesReady` resolves when
    // every competitor's body has loaded (main.ts:895) and `natureReady` when
    // the population queue has drained; between them they cover the props the
    // scene-ready check cannot see because they are not in the scene yet.
    //
    // Capped because natureReady CAN hang — the game races it against
    // MAX_NATURE_WAIT_MS for exactly that reason (main.ts:2201), and an
    // unguarded await here spent Timberline West's entire 5-minute test budget
    // waiting for a promise that never settled. A camera must degrade to a
    // slightly early photo, never to no photo at all.
    await page.evaluate(async () => {
      const w = window as unknown as {
        __slice3d: { bodiesReady: Promise<void>; natureReady: () => Promise<void> };
      };
      const cap = (p: Promise<unknown>, ms: number): Promise<unknown> =>
        Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
      await cap(w.__slice3d.bodiesReady, 60_000);
      await cap(w.__slice3d.natureReady(), 60_000);
    });

    // The equipped PAL is deliberately outside `bodiesReady` — a slow pal fetch
    // must never hold up a shot (main.ts:1293) — so give the last uploads a
    // moment to land, then re-confirm the scene is still ready.
    await page.waitForTimeout(4_000);
    await page.waitForFunction(
      () => (window as unknown as { __slice3d: { scene: { isReady: (rt?: boolean) => boolean } } }).__slice3d.scene.isReady(false),
      undefined,
      { timeout: 60_000 }
    );

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
