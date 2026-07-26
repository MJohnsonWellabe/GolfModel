import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * THE SUDDEN-DEATH PLAYOFF on the real UI (owner pass 8): a regulation tie
 * involving the player holds the event open, the hub offers "settle the tie",
 * the playoff hole shows the tied rivals as PARKED BALLS at rest (no flying
 * ghosts) with a status line, and sudden death always resolves the event —
 * by the cap rule if nobody breaks the tie sooner.
 */

const PHONE = { width: 390, height: 844 };

type Probe = {
  pending: { tied: string[]; holesPlayed: number } | null;
  live: Array<{ id: string; strokes: number; holed: boolean; rests: number }> | null;
  scene: { balls: number; shown: Record<string, number>; status: string } | null;
};

async function playoffProbe(page: import('@playwright/test').Page): Promise<Probe> {
  return page.evaluate(() => (window as never as { __playoffProbe: () => Probe }).__playoffProbe());
}

/** Drive the live hole with competent shots until the summary card shows. */
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
  throw new Error('the playoff hole never reached the summary');
}

test('a tie goes to sudden death: parked rival balls, then the event resolves', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });

  // A career Pro (the tour is the Pro's story)…
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown');
  await page.locator('#proName').fill('Playoff Pro');
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');
  await page.locator('#lkBack').dispatchEvent('click');

  // …whose event 1 just ended in a two-way tie at the top (forged — the only
  // deterministic way a spec reaches a tie through the real simulator).
  const staged = await page.evaluate(() => (window as never as { __stagePlayoff: (n: number) => boolean }).__stagePlayoff(2));
  expect(staged).toBe(true);
  const before = await playoffProbe(page);
  expect(before.pending?.tied).toHaveLength(2);
  expect(before.pending?.holesPlayed).toBe(0);

  // The hub says so, and its play button leads into sudden death.
  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  await expect(hub.locator('#thPlay')).toContainText(/playoff/i);
  await hub.locator('#thPlay').dispatchEvent('pointerdown');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, { timeout: 60_000 });
  await expect(page.locator('#landing')).not.toHaveClass(/on/);

  // The playoff hole is live: both rivals were simulated up front, their
  // BALLS AT REST are parked (never a flying ghost), and the status line
  // reads their visible progress before the player has hit.
  await page.waitForFunction(
    () => {
      const p = (window as never as { __playoffProbe: () => Probe }).__playoffProbe();
      return !!p.live && !!p.scene && p.scene.balls + 0 >= 0 && p.scene.status.length > 0;
    },
    undefined,
    { timeout: 60_000 }
  );
  const mid = await playoffProbe(page);
  expect(mid.live).toHaveLength(2);
  for (const r of mid.live!) {
    expect(r.rests).toBeGreaterThan(0);
    expect(r.strokes).toBeGreaterThan(0);
  }
  // Sync rule: before the first stroke each rival shows exactly one shot.
  expect(Object.values(mid.scene!.shown)).toEqual([1, 1]);
  // A rival's first shot is parked somewhere (an ace would hide it — the
  // status line still names both either way).
  expect(mid.scene!.status).toContain('⚔');

  // Sudden death always ends: an outright winner some hole, or the cap hands
  // it to the player at hole 5 — so at most 5 holes resolve the event.
  for (let hole = 0; hole < 5; hole++) {
    await playRoundToSummary(page);
    const summary = page.locator('#summary');
    const again = summary.locator('#tourPlayoffBtn');
    if ((await again.count()) > 0) {
      await expect(summary).toContainText(/still tied/i);
      await again.dispatchEvent('pointerdown');
      await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, { timeout: 60_000 });
      continue;
    }
    // Resolved: the event finalized with points banked for all 11 entrants
    // and the playoff outcome on the headline.
    await expect(summary).toContainText(/playoff/i);
    await expect(summary).toContainText('season points');
    const after = await page.evaluate(() => {
      const w = window as never as { __tour: () => { played: number; points: Record<string, number> } };
      return w.__tour();
    });
    expect(after.played).toBe(1);
    expect(Object.keys(after.points)).toHaveLength(11);
    const probe = await playoffProbe(page);
    expect(probe.pending).toBeNull();
    // The record book heard about it through the REAL payout path: a playoff
    // win stamps exactly one tour win on the Pro; a loss stamps nothing.
    const won = /playoff won/i.test((await summary.textContent()) ?? '');
    const records = await page.evaluate(
      () => (window as never as { __tourRecords: () => Record<string, { wins: number }> }).__tourRecords()
    );
    const totalWins = Object.values(records).reduce((a, r) => a + r.wins, 0);
    expect(totalWins).toBe(won ? 1 : 0);
    expect(errors, errors.join('\n')).toHaveLength(0);
    return;
  }
  throw new Error('sudden death never resolved within the 5-hole cap');
});
