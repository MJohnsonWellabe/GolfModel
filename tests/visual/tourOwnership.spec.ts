import { expect, test } from '@playwright/test';
import { openDestination, seedReturningDevice } from './support/wizard';

/**
 * SEASON OWNERSHIP, on the real UI (owner, with two screenshots: "this
 * assigned a bunch of stuff to the wrong pro. it is assigning most of my wins
 * to Charlotte on the majors but they were spread across pros. you can see
 * parker has a grand slam but no wins in the table" — confirmed via follow-up:
 * "Yes, I run more than one season at once").
 *
 * A season used to have no memory of its own owner: every win recorded during
 * it, and the season itself at archive time, read `profile.career.activeProId`
 * FRESH — whoever happened to be active at that instant, not necessarily
 * whoever actually played it. Switching which season is being played (the
 * picker) was entirely decoupled from switching who is playing it (the
 * Locker) — nothing kept them in step.
 *
 * The fix stamps a season's owner ONCE, at creation (`proId`/`proName` on
 * `TourSeasonState`), and every recording/archiving site resolves it through
 * `seasonOwner()` — the season's own stamp first, never a bare read of
 * whoever the Locker shows right now. These specs drive the exact scenario
 * the owner described: two Pros, seasons running in parallel, switching
 * between them — and confirm each stays correctly attributed regardless of
 * which Pro the Locker happens to be showing at any given moment.
 */

const PHONE = { width: 390, height: 844 };

async function makePro(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.locator('.lkTab[data-tab="style"]').dispatchEvent('pointerdown');
  await page.locator('#proName').fill(name);
  await page.locator('.careerStart[data-cstart="bigHitter"]').dispatchEvent('pointerdown');
}

type ArchiveDump = {
  pros: Array<{ id: string; name: string }>;
  activeProId: string | null;
  activeSeason: { seasonNo: number; proId: string | null; proName: string | null } | null;
  archive: Array<{ seasonNo: number; proId: string; proName: string; ended: string }>;
};

async function dump(page: import('@playwright/test').Page): Promise<ArchiveDump> {
  return page.evaluate(() => (window as never as { __tourArchiveDump: () => ArchiveDump }).__tourArchiveDump());
}

type TourHistoryRec = { wins: number; seasons: Array<{ seasonNo: number }> };

async function records(page: import('@playwright/test').Page): Promise<Record<string, TourHistoryRec>> {
  return page.evaluate(() => (window as never as { __tourRecords: () => Record<string, TourHistoryRec> }).__tourRecords());
}

test('a forced season finale archives under the season\'s OWN owner, not whoever is active now', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });

  // Pro A starts season 1 — stamped as theirs at creation.
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await makePro(page, 'Alice');
  await page.locator('#lkBack').dispatchEvent('click');
  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  await hub.locator('#thStartSeason').dispatchEvent('click');
  const beforeSwitch = await dump(page);
  expect(beforeSwitch.activeSeason?.proId).toBe(beforeSwitch.pros.find((p) => p.name === 'Alice')!.id);

  // A second Pro is created — becomes the Locker's active Pro, same as it
  // would if the player was simply building out their stable. Season 1
  // itself is never touched again.
  await hub.locator('#thBack').dispatchEvent('click');
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await makePro(page, 'Bob');
  await page.locator('#lkBack').dispatchEvent('click');

  const mid = await dump(page);
  const alice = mid.pros.find((p) => p.name === 'Alice')!;
  const bob = mid.pros.find((p) => p.name === 'Bob')!;
  expect(mid.activeProId).toBe(bob.id); // Bob is Locker-active now…
  expect(mid.activeSeason?.proId).toBe(alice.id); // …but the live season is still Alice's.

  // Force the season through the exact finale path the real UI takes,
  // without ever re-visiting the hub (so nothing gets a chance to nudge
  // anything back in step) — this is the bug exactly as reported: a season
  // closes out while a DIFFERENT Pro sits active in the Locker.
  const forced = await page.evaluate(() => (window as never as { __forceSeasonFinale: () => boolean }).__forceSeasonFinale());
  expect(forced).toBe(true);

  const after = await dump(page);
  expect(after.activeProId).toBe(bob.id); // untouched — recording doesn't reach into the Locker
  expect(after.archive).toHaveLength(1);
  expect(after.archive[0].proId).toBe(alice.id);
  expect(after.archive[0].proName).toBe('Alice');

  const recs = await records(page);
  expect(recs[alice.id]?.seasons?.some((s) => s.seasonNo === 1)).toBe(true);
  expect(recs[bob.id]).toBeUndefined(); // Bob never played a single event

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('two Pros running seasons in parallel: the picker switches who is playing along with which season', async ({
  page
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize(PHONE);
  await seedReturningDevice(page);
  await page.goto('/?freeze=1');
  await page.locator('#landingPlay').waitFor({ state: 'visible', timeout: 60_000 });

  // Alice starts season 1.
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await makePro(page, 'Alice');
  await page.locator('#lkBack').dispatchEvent('click');
  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  await hub.locator('#thStartSeason').dispatchEvent('click');

  // Bob joins the stable and becomes Locker-active — merely VIEWING the hub
  // after this must not force the Locker back to Alice; that was the earlier
  // regression (an over-eager "belt and braces" resync made it impossible to
  // ever start a season for a second Pro while a first one was still live).
  await hub.locator('#thBack').dispatchEvent('click');
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await makePro(page, 'Bob');
  await page.locator('#lkBack').dispatchEvent('click');
  await page.locator('#destTour').dispatchEvent('click');
  await expect(hub).toBeVisible();
  let d = await dump(page);
  const alice = d.pros.find((p) => p.name === 'Alice')!;
  const bob = d.pros.find((p) => p.name === 'Bob')!;
  expect(d.activeProId).toBe(bob.id); // still Bob — the hub did not stomp it

  // Start a second, parallel season — for Bob, since Bob is who's active now.
  await hub.locator('#thSwitch').dispatchEvent('click');
  await hub.locator('#thAddSeason').dispatchEvent('click');
  d = await dump(page);
  expect(d.activeSeason?.proId).toBe(bob.id);

  // Switch back to season 1 via the picker — Alice's season — and the Locker
  // must follow it back to Alice automatically.
  await hub.locator('#thSwitch').dispatchEvent('click');
  await hub.locator('.seasonPick', { hasText: 'Season 1' }).dispatchEvent('click');
  d = await dump(page);
  expect(d.activeSeason?.proId).toBe(alice.id);
  expect(d.activeProId).toBe(alice.id);

  // And switching to season 2 brings the Locker back to Bob.
  await hub.locator('#thSwitch').dispatchEvent('click');
  await hub.locator('.seasonPick', { hasText: 'Season 2' }).dispatchEvent('click');
  d = await dump(page);
  expect(d.activeSeason?.proId).toBe(bob.id);
  expect(d.activeProId).toBe(bob.id);

  // Force THIS (Bob's, season 2) season closed while it's the active one —
  // archives under Bob, and Alice's season 1 is untouched, still in the
  // live map.
  const forced = await page.evaluate(() => (window as never as { __forceSeasonFinale: () => boolean }).__forceSeasonFinale());
  expect(forced).toBe(true);
  d = await dump(page);
  expect(d.archive).toHaveLength(1);
  expect(d.archive[0].proId).toBe(bob.id);
  expect(d.archive[0].proName).toBe('Bob');

  const recs = await records(page);
  expect(recs[bob.id]?.seasons?.some((s) => s.seasonNo === 2)).toBe(true);
  expect(recs[alice.id]).toBeUndefined(); // Alice's season 1 never closed out

  expect(errors, errors.join('\n')).toHaveLength(0);
});

/**
 * SEASON HAND-OFF (owner, on the ownership fix's own side effect: "some
 * users are saying they can't switch golfer midway through the season and
 * they should be able to" — switching Pros in the Locker while a season is
 * active, then hitting Play, used to silently snap back to the season's
 * true owner with no explanation. Confirmed answer: don't remove the
 * correctness fix, add an explicit way around it).
 */
async function forgeWin(page: import('@playwright/test').Page, idx: number): Promise<boolean> {
  return page.evaluate(
    (i) => (window as never as { __forgeLiveEventWin: (idx: number) => boolean }).__forgeLiveEventWin(i),
    idx
  );
}

test('tapping Play with a different Pro active asks who is playing, and "Play as" keeps the season with its owner', async ({
  page
}) => {
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
  await makePro(page, 'Alice');
  await page.locator('#lkBack').dispatchEvent('click');
  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  await hub.locator('#thStartSeason').dispatchEvent('click');
  expect(await forgeWin(page, 0)).toBe(true); // Alice already has a win banked in season 1

  await hub.locator('#thBack').dispatchEvent('click');
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await makePro(page, 'Bob');
  await page.locator('#lkBack').dispatchEvent('click');
  await page.locator('#destTour').dispatchEvent('click');
  await expect(hub).toBeVisible();

  const before = await dump(page);
  const alice = before.pros.find((p) => p.name === 'Alice')!;
  const bob = before.pros.find((p) => p.name === 'Bob')!;
  expect(before.activeProId).toBe(bob.id); // Bob's active, Alice's season is still what's live

  await hub.locator('#thPlay').dispatchEvent('pointerdown');
  const modal = page.locator('.storeConfirm');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('belongs to Alice');
  await expect(modal.locator('#handoffKeep')).toContainText('Play as Alice');
  await expect(modal.locator('#handoffTake')).toContainText('Hand off to Bob');

  await page.waitForTimeout(400); // past the tap-guard window
  await modal.locator('#handoffKeep').dispatchEvent('click');

  const after = await dump(page);
  expect(after.activeProId).toBe(alice.id); // switched back to play as the true owner
  expect(after.activeSeason?.proId).toBe(alice.id);
  const recs = await records(page);
  expect(recs[alice.id]?.wins ?? 0).toBeGreaterThanOrEqual(1); // the earlier win is still Alice's

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('hand-off moves the season, and its already-banked win, to whoever is active now', async ({ page }) => {
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
  await makePro(page, 'Alice');
  await page.locator('#lkBack').dispatchEvent('click');
  await page.locator('#destTour').dispatchEvent('click');
  const hub = page.locator('#tourHub');
  await expect(hub).toBeVisible();
  await hub.locator('#thStartSeason').dispatchEvent('click');
  expect(await forgeWin(page, 0)).toBe(true);

  await hub.locator('#thBack').dispatchEvent('click');
  await openDestination(page, 'locker');
  await page.locator('#landingLocker').dispatchEvent('click');
  await page.locator('#lockerRoom').waitFor({ state: 'visible', timeout: 20_000 });
  await makePro(page, 'Bob');
  await page.locator('#lkBack').dispatchEvent('click');
  await page.locator('#destTour').dispatchEvent('click');
  await expect(hub).toBeVisible();

  const before = await dump(page);
  const alice = before.pros.find((p) => p.name === 'Alice')!;
  const bob = before.pros.find((p) => p.name === 'Bob')!;

  await hub.locator('#thPlay').dispatchEvent('pointerdown');
  const modal = page.locator('.storeConfirm');
  await expect(modal).toBeVisible();
  await page.waitForTimeout(400);
  await modal.locator('#handoffTake').dispatchEvent('click');

  const after = await dump(page);
  expect(after.activeProId).toBe(bob.id); // untouched — Bob was already active
  expect(after.activeSeason?.proId).toBe(bob.id); // the season itself moved to Bob

  const recs = await records(page);
  expect(recs[bob.id]?.wins).toBe(1); // the win banked before the hand-off moved with it
  expect(recs[alice.id]).toBeUndefined(); // nothing left of Alice's record

  expect(errors, errors.join('\n')).toHaveLength(0);
});
