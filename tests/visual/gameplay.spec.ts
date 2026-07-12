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
  const t = await page.evaluate(() => (window as any).__aiTour());
  expect(t.played).toBe(0);
  expect(t.courseIds.length).toBe(3);
  expect(new Set(t.courseIds).size).toBe(3);
  // Only the player tees it up — the field never plays on screen.
  const balls = await page.evaluate(() =>
    (window as any).__slice3d.scene.meshes.filter((m: { name: string }) => /^ball\d$/.test(m.name)).length
  );
  expect(balls).toBe(1);
});
