import { expect, test } from '@playwright/test';

/**
 * The Rival, end to end in the real game.
 *
 * The unit tests prove the rivalry's bookkeeping and that a synthesised round
 * replays. They cannot prove the thing the feature actually is: that on opening
 * the game there is a named person with a score on today's hole, that playing it
 * puts their ball in the air beside yours, and that the result settles the
 * record. Each of those is a separate wire, and a broken one is invisible from
 * the outside — the card would simply be a little quieter.
 */

/** Progressive disclosure hides the daily systems until a device has finished a
 *  round, so a fresh page would show no daily card at all. */
async function seedReturningDevice(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'johnsons-golf-device-settings-v1',
      JSON.stringify({ sound: 0.8, ambience: 0.2, reducedMotion: false, clipCapture: false, firstRoundDone: true })
    );
  });
}

test('a rival is waiting on the daily card with a score to beat', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await seedReturningDevice(page);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__startRound);

  // The card is built lazily (generate the hole, vet it by simulation, then
  // play the rival's round through the same physics) — all of it on the landing
  // paint, none of it during play.
  const rival = page.locator('#dailyHoleCard .dhRival');
  await rival.waitFor({ state: 'visible', timeout: 60_000 });
  const line = await rival.innerText();
  // A name, a score, and where the rivalry stands.
  expect(line, line).toMatch(/went round in \d+/);
  expect(line, line).toMatch(/First round against|You lead|leads|All square/);

  // The play button names them, because that is the reason to tap it.
  const play = page.locator('#dhPlay');
  await expect(play).toBeVisible();
  expect(await play.innerText()).toMatch(/^Play — beat \S+/);
  expect(errors, errors.join('\n')).toEqual([]);
});

test("the rival's ball flies beside yours, and the day settles", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[ghost]') || t.includes('[recording]') || t.includes('[probe]')) console.log('PAGE ' + t);
  });
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__startRound);
  await page.locator('#dailyHoleCard .dhRival').waitFor({ state: 'visible', timeout: 60_000 });

  const before = await page.evaluate(() => (window as never as { __rival(): unknown }).__rival());
  await page.locator('#dhPlay').dispatchEvent('pointerdown');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, {
    timeout: 90_000
  });

  // The rival is the opponent for this round: armed as a ghost, not just a
  // number on a card.
  const standing = await page.evaluate(() =>
    (window as never as { __ghostStanding(): { name: string; scores: number[] } | null }).__ghostStanding()
  );
  expect(standing, 'the rival was not armed as the ghost for the daily hole').toBeTruthy();

  // Play the hole out, watching for the rival's ball to actually fly.
  let flew = false;
  for (let guard = 0; guard < 200; guard++) {
    const done = await page.evaluate(() => !!(window as never as { __lastRecording(): unknown }).__lastRecording());
    if (done) break;
    const sawFlight = await page.evaluate(() => {
      const w = window as never as {
        __slice3d?: {
          state: { phase: string };
          skipIntro(): void;
          playSkilledShot(): boolean;
          settleFlight(): boolean;
          settleGhostFlight(): boolean;
          ghostDebug(): { shown: boolean; flying: boolean } | null;
        };
      };
      const s = w.__slice3d;
      if (!s) return false;
      if (s.state.phase === 'intro') {
        s.skipIntro();
        return false;
      }
      if (s.state.phase === 'flying') {
        s.settleFlight();
        return false;
      }
      if (s.state.phase === 'aiming') {
        s.playSkilledShot();
        const g = s.ghostDebug();
        const up = !!g?.shown && !!g.flying;
        s.settleGhostFlight();
        return up;
      }
      return false;
    });
    flew = flew || sawFlight;
    await page.waitForTimeout(80);
  }
  expect(flew, "the rival's ball never went in the air").toBe(true);

  // Back on the landing, the fixture is settled: one more day played.
  await page.waitForFunction(
    (prevPlayed) => {
      const r = (window as never as { __rival(): { played: number } | null }).__rival();
      return !!r && r.played > (prevPlayed as number);
    },
    (before as { played: number } | null)?.played ?? 0,
    { timeout: 90_000 }
  );
  const after = await page.evaluate(() =>
    (window as never as { __rival(): { played: number; wins: number; losses: number; ties: number } | null }).__rival()
  );
  expect(after!.wins + after!.losses + after!.ties).toBe(after!.played);
  console.log(`RIVAL settled: ${JSON.stringify(after)}`);
  expect(errors, errors.join('\n')).toEqual([]);
});
