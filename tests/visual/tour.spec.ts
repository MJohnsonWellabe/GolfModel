import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * TOUR SEASON, end to end on the real UI: the Today card gates on a started
 * career, entering plays the round AS the Pro, the event resolves against the
 * ten named rivals with season points banked, and Quick Start rotates courses
 * instead of replaying the last one.
 */

const PHONE = { width: 390, height: 844 };

type TourProbe = {
  started: boolean;
  seasonNo: number;
  played: number;
  eventIdx: number | null;
  major: boolean;
  roundsIn: number;
  roundLive: boolean;
  archetype: string;
  points: Record<string, number>;
};

async function tourProbe(page: import('@playwright/test').Page): Promise<TourProbe> {
  return page.evaluate(() => (window as never as { __tour: () => TourProbe }).__tour());
}

/** Drive the live round with competent shots until the summary card shows. */
async function playRoundToSummary(page: import('@playwright/test').Page): Promise<void> {
  for (let guard = 0; guard < 600; guard++) {
    const step = await page.evaluate(() => {
      const w = window as never as {
        __slice3d?: {
          state: { phase: string };
          skipIntro(): void;
          playSkilledShot(): boolean;
          settleFlight(): boolean;
        };
      };
      const s = w.__slice3d;
      if (!s) return 'wait';
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
    });
    await page.waitForTimeout(step === 'wait' ? 200 : 80);
    const done = await page.evaluate(() => document.getElementById('summary')?.style.display === 'block');
    if (done) return;
  }
  throw new Error('the tour round never reached the summary');
}

test('no career, no tour: the tile sends you to the Locker instead', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  const tile = page.locator('#destTour');
  await tile.waitFor({ state: 'visible', timeout: 60_000 });
  await expect(tile).toContainText(/start a career/i);
  await tile.dispatchEvent('click');
  await expect(page.locator('#lockerRoom')).toBeVisible();
  // …and the Style tab is already up, one tap from a rookie.
  await expect(page.locator('.careerNew')).toBeVisible();
});

test('enter the tour as the Pro, finish the event, bank season points', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });

  // Start a career (the tour is the Pro's story).
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown');
  await page.locator('#proName').fill('Tour Rookie');
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');
  await page.locator('#lkBack').dispatchEvent('click');

  // The Tour tile opens the HUB (owner: "you should be able to go to all
  // past results, standings, schedule and play next event").
  const tile = page.locator('#destTour');
  await expect(tile).toContainText('Event 1/16');
  await tile.dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  // Standings: all 11 entrants; schedule: all 16 events, E1 marked current,
  // the four majors flagged.
  await expect(hub.locator('.tourResult .recRow')).toHaveCount(11);
  await expect(hub.locator('.thEv')).toHaveCount(16);
  await expect(hub.locator('.thEv.cur')).toContainText('E1');
  await expect(hub.locator('.thEv.major')).toHaveCount(4);
  await expect(hub).toContainText('The Grand Championship');
  // Play from the hub.
  await hub.locator('#thPlay').dispatchEvent('pointerdown');

  // A tour round is live, played AS the career Pro (force-selected).
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, { timeout: 60_000 });
  const mid = await tourProbe(page);
  expect(mid.started).toBe(true);
  expect(mid.roundLive).toBe(true);
  expect(mid.eventIdx).toBe(0);
  expect(mid.archetype).toBe('career');

  // Play the event out with competent shots.
  await playRoundToSummary(page);

  // The event resolved: rivals on the board by name, points banked for all
  // 11 entrants, and the primary action moves the season along.
  const after = await tourProbe(page);
  expect(after.played).toBe(1);
  expect(after.roundLive).toBe(false);
  expect(Object.keys(after.points)).toHaveLength(11);
  const summary = page.locator('#summary');
  await expect(summary).toContainText('season points');
  await expect(summary).toContainText('Rex Calloway'); // a rival, by name
  await expect(summary.locator('#tourNextBtn')).toContainText(/next event/i);

  // Back at the hub, event 1 reads as a PAST RESULT: a finish and its points.
  // (☰ Menu opens the course wizard; its Back at step 0 is the landing. No
  // reload — a guest profile is in-memory only, and the tour would be lost.)
  await page.locator('#summary #againBtn').dispatchEvent('pointerdown'); // ☰ Menu
  await page.locator('#setup').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#backBtn').dispatchEvent('click');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#destTour').dispatchEvent('click');
  const hubAfter = page.locator('#tourHub');
  await expect(hubAfter.locator('.thEv.done')).toHaveCount(1);
  await expect(hubAfter.locator('.thEv.done')).toContainText(/pts/);
  await expect(hubAfter.locator('.thEv.cur')).toContainText('E2');
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('Quick Start rotates: the button names the NEXT course, not the last', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(PHONE);
  // A device that played Sable Bay last…
  await page.addInitScript(() => {
    localStorage.setItem(
      'johnsons-golf-device-settings-v1',
      JSON.stringify({
        sound: 0.8,
        ambience: 0.2,
        reducedMotion: false,
        clipCapture: false,
        firstRoundDone: true,
        lastCourseId: 'sablebay'
      })
    );
  });
  await page.goto('/?freeze=1');
  const play = page.locator('#landingPlay');
  await play.waitFor({ state: 'visible', timeout: 60_000 });
  // …is offered the rotation's next stop (sablebay → wildwood), on the button.
  await expect(play).toContainText('Wildwood');
});
