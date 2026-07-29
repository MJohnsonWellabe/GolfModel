import { expect, test } from '@playwright/test';

/**
 * THE DIFFICULTY SETTING HAS TO BE VISIBLE ON THE BAR.
 *
 * It shipped wired correctly and looking broken. `perfectHalf()` honoured the
 * multiplier, `bandFor()` used the same number, `lockRoundDifficulty()` ran on
 * every start path — and the owner reported that Expert and Beginner drew an
 * identical white tick. They did: the band is 5-13px wide, and it carried a 2px
 * white inset ring on each edge plus a 2px white target line painted over the
 * top of it at a higher z-index. There was no green left to compare.
 *
 * Every test we had measured the model, so nothing failed. This one measures
 * the DOM. It is the gate that would have caught it.
 */

type Probe = {
  chosen: string | null;
  effective: string;
  round: string;
  perfectPx: number[];
  barPx: number;
};

async function armAt(page: import('@playwright/test').Page, difficulty: string): Promise<Probe> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __difficulty?: unknown }).__difficulty);
  // Choose BEFORE the round starts: a round locks its difficulty at the tee, so
  // setting it afterwards deliberately does nothing (that is its own rule).
  await page.evaluate((d) => (window as unknown as { __difficulty: (s: string) => unknown }).__difficulty(d), difficulty);
  await page.evaluate(() =>
    (window as unknown as { __startRound: (o: unknown) => void }).__startRound({ name: 'Diff', courseId: 'sablebay' })
  );
  await page.waitForFunction(() => !!(window as unknown as { __slice3d?: unknown }).__slice3d);
  await page.evaluate(() => (window as unknown as { __slice3d: { skipIntro: () => void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as unknown as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 60_000 }
  );
  return page.evaluate(() => (window as unknown as { __difficulty: () => Probe }).__difficulty()) as Promise<Probe>;
}

test('the perfect band really is wider at Beginner than at Expert', async ({ page }) => {
  test.setTimeout(240_000);

  const easy = await armAt(page, 'beginner');
  const hard = await armAt(page, 'expert');

  // The choice reached the round, not just the profile.
  expect(easy.round, 'the round locked the chosen difficulty').toBe('beginner');
  expect(hard.round).toBe('expert');

  // The meter is armed and drawing both perfect bands (power + accuracy).
  expect(easy.perfectPx.length, 'both perfect bands drawn').toBeGreaterThan(0);
  expect(easy.barPx).toBeGreaterThan(100);

  const widest = (p: Probe): number => Math.max(...p.perfectPx);
  // 1.4 / 0.8 = 1.75. Allow slack for sub-pixel rounding and for the club the
  // hole happens to auto-select, but demand a difference nobody could miss.
  const ratio = widest(easy) / widest(hard);
  expect(
    ratio,
    `beginner ${widest(easy).toFixed(1)}px vs expert ${widest(hard).toFixed(1)}px`
  ).toBeGreaterThan(1.5);

  // ...and there has to be a band left once the outline is drawn on it. Two
  // 1px edges is the minimum the outline can cost, so anything at or under
  // ~2px is the all-white tick this test exists to prevent.
  expect(widest(hard), 'the hardest band is still a visible band').toBeGreaterThan(3);
});

test('a difficulty chosen mid-round does not resize the meter under the player', async ({ page }) => {
  test.setTimeout(240_000);
  const before = await armAt(page, 'pro');
  expect(before.round).toBe('pro');

  const after = (await page.evaluate(
    () => (window as unknown as { __difficulty: (s: string) => Probe }).__difficulty('beginner')
  )) as Probe;
  // The stored choice moved; the ROUND did not.
  expect(after.chosen).toBe('beginner');
  expect(after.round, 'the round in progress keeps the difficulty it teed off at').toBe('pro');
});

/**
 * THE SEQUENCE THAT ACTUALLY FAILED.
 *
 * Owner: "it doesn't reset after you pick easy and my game stayed on the easy
 * setting when I went back to hard." Choosing, playing, and choosing again is
 * the ordinary way anybody uses this setting, and no test covered it — the
 * Stage 1 gates each started from a fresh page, so the stale-value path was
 * never exercised.
 */
test('choosing again after a round really does change the next round', async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __difficulty?: unknown }).__difficulty);

  const pick = (d: string): Promise<Probe> =>
    page.evaluate(
      (x) => (window as unknown as { __difficulty: (s: string) => Probe }).__difficulty(x),
      d
    ) as Promise<Probe>;
  const startRound = async (): Promise<Probe> => {
    await page.evaluate(() =>
      (window as unknown as { __startRound: (o: unknown) => void }).__startRound({
        name: 'Diff',
        courseId: 'sablebay'
      })
    );
    await page.waitForFunction(() => !!(window as unknown as { __slice3d?: unknown }).__slice3d);
    await page.evaluate(() => (window as unknown as { __slice3d: { skipIntro: () => void } }).__slice3d.skipIntro());
    await page.waitForFunction(
      () => (window as unknown as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
      undefined,
      { timeout: 60_000 }
    );
    return page.evaluate(() => (window as unknown as { __difficulty: () => Probe }).__difficulty()) as Promise<Probe>;
  };

  await pick('beginner');
  const easyRound = await startRound();
  expect(easyRound.round).toBe('beginner');
  const easyBand = Math.max(...easyRound.perfectPx);

  // ...back to Settings, pick the hardest, tee off again. THIS is the step that
  // was handing back the old choice.
  await pick('expert');
  const hardRound = await startRound();
  expect(hardRound.chosen, 'the stored choice moved').toBe('expert');
  expect(hardRound.effective, 'the effective difficulty moved').toBe('expert');
  expect(hardRound.round, 'the NEW round teed off at the new choice').toBe('expert');

  const hardBand = Math.max(...hardRound.perfectPx);
  expect(
    easyBand / hardBand,
    `beginner ${easyBand.toFixed(1)}px then expert ${hardBand.toFixed(1)}px`
  ).toBeGreaterThan(1.5);
});
