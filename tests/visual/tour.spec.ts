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
  // No season exists yet, even on this very first visit — an explicit tap
  // starts it (owner: "there shouldn't be an instant new season started").
  await hub.locator('#thStartSeason').dispatchEvent('click');
  // The hub is a LANDING now (owner pass 11: "there should be a career
  // landing, button to look at schedule, play the next event, see career
  // records, improve your player"). Playing is on it; the season's reference
  // material — standings and the sixteen events — is one tap away, so this
  // walk goes and looks, then comes back to tee off exactly as a player would.
  await expect(hub.locator('#thPlay')).toBeVisible();
  await hub.locator('#thSched').dispatchEvent('click');
  // Standings: all 11 entrants; schedule: all 16 events, E1 marked current,
  // the four majors flagged.
  await expect(hub.locator('.tourResult .recRow')).toHaveCount(11);
  await expect(hub.locator('.thEv')).toHaveCount(16);
  await expect(hub.locator('.thEv.cur')).toContainText('E1');
  await expect(hub.locator('.thEv.major')).toHaveCount(4);
  await expect(hub).toContainText('The Grand Championship');
  await hub.locator('#thSchedBack').dispatchEvent('click');
  // Play from the landing.
  await expect(hub.locator('#thPlay')).toBeVisible();
  await hub.locator('#thPlay').dispatchEvent('pointerdown');

  // A tour round is live, played AS the career Pro (force-selected) — and
  // the ROUND is what's on screen: the landing came down with the hub
  // (owner bug: "when I click play event it goes back to the main screen" —
  // the round was building underneath a landing nobody dismissed).
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, { timeout: 60_000 });
  await expect(page.locator('#landing')).not.toHaveClass(/on/);
  await expect(page.locator('#tourHub')).toBeHidden();
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
  // The primary action returns to the TOUR PAGE (owner pass 8: "after a tour
  // event, make it go back to the tour page") — the hub, where the result
  // just landed.
  await expect(summary.locator('#tourHubBtn')).toContainText(/tour season/i);
  await summary.locator('#tourHubBtn').dispatchEvent('pointerdown');

  // Straight onto the hub: event 1 reads as a PAST RESULT — a finish and its
  // points — with event 2 up next, and the landing standing behind it.
  const hubAfter = page.locator('#tourHub');
  await expect(hubAfter).toBeVisible();
  // The landing itself reports the season in one line and offers event 2…
  await expect(hubAfter.locator('#thPlay')).toContainText('Event 2/16');
  await expect(hubAfter.locator('#thSched')).toContainText('1/16 played');
  // …and the schedule screen holds the result: event 1 done, with its points.
  await hubAfter.locator('#thSched').dispatchEvent('click');
  await expect(hubAfter.locator('.thEv.done')).toHaveCount(1);
  await expect(hubAfter.locator('.thEv.done')).toContainText(/pts/);
  await expect(hubAfter.locator('.thEv.cur')).toContainText('E2');

  // A FINISHED EVENT OPENS ITS FULL LEADERBOARD (owner: "once I'm in the
  // schedule, I should be able to click an event and see the full results").
  // The schedule could only say where the player finished and what it paid —
  // who else was up there, and by how much, was gone once the summary closed.
  await expect(hubAfter.locator('.thEv.thEvOpen'), 'only the played event opens').toHaveCount(1);
  await hubAfter.locator('.thEv.done').dispatchEvent('click');
  // Every entrant, with a to-par and the points that finish paid.
  await expect(hubAfter.locator('.tourResult .recRow')).toHaveCount(11);
  await expect(hubAfter.locator('.recRow.you')).toHaveCount(1);
  await expect(hubAfter.locator('.recRow .thEvPar').first()).toHaveText(/^(E|[+-]\d+)$/);
  await expect(hubAfter).toContainText('Rex Calloway'); // the field, by name
  await expect(hubAfter).toContainText(/Event 1 of 16/);
  // Back lands on the schedule it was opened from, not the hub.
  await hubAfter.locator('#thEvBack').dispatchEvent('click');
  await expect(hubAfter.locator('.thEv')).toHaveCount(16);

  // An event that has NOT been played has no leaderboard, so it must not look
  // tappable — and tapping it must not blank the screen.
  await hubAfter.locator('.thEv.cur').dispatchEvent('click');
  await expect(hubAfter.locator('.thEv')).toHaveCount(16);

  await hubAfter.locator('#thSchedBack').dispatchEvent('click');
  await expect(page.locator('#landing')).toHaveClass(/on/);
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('a finished season does not instantly start the next one', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });

  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown');
  await page.locator('#proName').fill('Season Ender');
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');
  await page.locator('#lkBack').dispatchEvent('click');

  // Even the very first season waits on an explicit tap now — "no active
  // season" reads the same whether it's day one or the morning after a
  // finale, and both get the same door rather than a silent auto-start.
  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  await expect(hub.locator('#thPlay')).toHaveCount(0);
  await expect(hub.locator('#thStartSeason')).toContainText('Start Season 1');
  await hub.locator('#thStartSeason').dispatchEvent('click');
  expect((await tourProbe(page)).seasonNo).toBe(1);

  // Close season 1 out through the REAL finale functions (owner: "after a
  // tour season finishes, there shouldn't be an instant new season started").
  const forced = await page.evaluate(() => (window as never as { __forceSeasonFinale: () => boolean }).__forceSeasonFinale());
  expect(forced).toBe(true);
  expect((await tourProbe(page)).started, 'closing a season must leave none active').toBe(false);

  // Re-opening the hub must NOT have silently rolled a fresh season either —
  // it offers an explicit door instead.
  await page.locator('#destTour').dispatchEvent('click');
  await expect(hub).toBeVisible();
  await expect(hub.locator('#thPlay')).toHaveCount(0);
  const startBtn = hub.locator('#thStartSeason');
  await expect(startBtn).toBeVisible();
  await expect(startBtn).toContainText('Start Season 2');
  await expect(hub).toContainText('Season 1 is complete');

  // The explicit tap is what actually starts it.
  await startBtn.dispatchEvent('click');
  const after = await tourProbe(page);
  expect(after.started).toBe(true);
  expect(after.seasonNo).toBe(2);
  await expect(hub.locator('#thPlay')).toContainText('Event 1/16');

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
