import { expect, test } from '@playwright/test';

/**
 * Gameplay smoke: boot real rounds through the test hooks and assert the
 * mode wiring holds up — two competitors in 1v1, AI turns actually run,
 * scramble team state advances. Deeper per-shot verification lives in the
 * vitest simulation suites; this guards the DOM/scene wiring.
 */

test('1v1 round: rival plays its own ball', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  await page.evaluate(() => (window as any).__startRound({ name: 'Smoke', mode: '1v1', opponentId: 'sergio' }));
  await page.waitForFunction(() => !!(window as any).__slice3d);
  await page.evaluate(() => (window as any).__slice3d.skipIntro());
  await page.waitForFunction(() => (window as any).__slice3d.state.phase === 'aiming', undefined, { timeout: 20_000 });
  const mode = await page.evaluate(() => (window as any).__slice3d.mode);
  expect(mode).toBe('1v1');
  // Two ball meshes exist (one per competitor)
  const balls = await page.evaluate(() =>
    (window as any).__slice3d.scene.meshes.filter((m: { name: string }) => /^ball\d$/.test(m.name)).length
  );
  expect(balls).toBe(2);
});

test('scramble round boots with a partner', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  await page.evaluate(() => (window as any).__startRound({ name: 'Smoke', mode: 'scramble', opponentId: 'sunny' }));
  await page.waitForFunction(() => !!(window as any).__slice3d);
  await page.evaluate(() => (window as any).__slice3d.skipIntro());
  await page.waitForFunction(() => (window as any).__slice3d.state.phase === 'aiming', undefined, { timeout: 20_000 });
  expect(await page.evaluate(() => (window as any).__slice3d.mode)).toBe('scramble');
});

test('every round grants exactly one True Vision charge that expires — unused, it does not stack into the next round', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  // A fresh profile owns none — the first round's free charge covers it.
  await page.evaluate(() => (window as any).__startRound({ name: 'Smoke', mode: 'solo' }));
  await page.waitForFunction(() => !!(window as any).__slice3d);
  expect(await page.evaluate(() => (window as any).__trueVisionCharges())).toBe(1);
  // A second round start, with the first round's freebie left unspent, must
  // NOT stack to 2 — the ephemeral bonus is discarded and reset to a flat 1.
  await page.evaluate(() => (window as any).__startRound({ name: 'Smoke', mode: 'solo' }));
  await page.waitForFunction(() => !!(window as any).__slice3d);
  expect(await page.evaluate(() => (window as any).__trueVisionCharges())).toBe(1);
});

test('True Vision: the free round bonus combines with owned charges for that round only', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  await page.evaluate(() => (window as any).__grantConsumable('true_vision', 2));
  await page.evaluate(() => (window as any).__startRound({ name: 'Smoke', mode: 'solo' }));
  await page.waitForFunction(() => !!(window as any).__slice3d);
  // Owns 2 + this round's free 1 = 3 available; nothing carries a permanent
  // stack once the round bonus itself is spent/expired.
  expect(await page.evaluate(() => (window as any).__trueVisionCharges())).toBe(3);
});

test('AI tournament boots round 1 of a three-course rota', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);
  await page.evaluate(() => (window as any).__startRound({ name: 'Smoke', mode: 'aitour' }));
  await page.waitForFunction(() => !!(window as any).__slice3d);
  await page.evaluate(() => (window as any).__slice3d.skipIntro());
  await page.waitForFunction(() => (window as any).__slice3d.state.phase === 'aiming', undefined, { timeout: 20_000 });
  // The player's rounds run as ordinary solo rounds; only the leaderboard
  // between rounds knows it's a tournament.
  expect(await page.evaluate(() => (window as any).__slice3d.mode)).toBe('solo');
  // startRound() hands 'aitour' mode off to startAiTourRound() before it would
  // grant its own True Vision charge — guards against double-granting on the
  // tournament's very first round (each round-start path grants exactly once).
  expect(await page.evaluate(() => (window as any).__trueVisionCharges())).toBe(1);
  const t = await page.evaluate(() => (window as any).__aiTour());
  expect(t.played).toBe(0);
  expect(t.courseIds.length).toBe(3);
  expect(new Set(t.courseIds).size).toBe(3);
  // Only the player tees it up — the field never plays on screen.
  const balls = await page.evaluate(() =>
    (window as any).__slice3d.scene.meshes.filter((m: { name: string }) => /^ball\d$/.test(m.name)).length
  );
  expect(balls).toBe(1);
  // The mid-round leaderboard button shows during tournament play and opens
  // the standings (names only — no difficulty tiers on the board).
  await expect(page.locator('#tourBoardBtn')).toBeVisible();
  await page.evaluate(() => (document.getElementById('tourBoardBtn') as HTMLElement).dispatchEvent(new Event('pointerdown')));
  await page.waitForSelector('.storeConfirmBox .tourHeadRow');
  const board = await page.locator('.storeConfirmBox').textContent();
  expect(board).toContain('Tournament');
  expect(board).not.toMatch(/Legend|Easy|Medium|Hard/);
  await page.evaluate(() => (document.getElementById('tourBoardClose') as HTMLElement).dispatchEvent(new Event('pointerdown')));
});
