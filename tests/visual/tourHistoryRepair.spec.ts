import { expect, test } from '@playwright/test';

/**
 * SEASON OWNERSHIP REPAIR — the one-time admin tool for tour seasons that
 * were already archived under the wrong Pro before the ownership fix shipped
 * (owner: "let me do a one time reassign of those stats in the admin
 * page"). Drives the UI purely off `__tourHistoryRepairPreview`, a hook that
 * paints the screen from a hand-built profile with no live Firebase auth
 * required — the write path (cloud + local save) is boilerplate mirroring
 * the already-covered AdminDrafts.ts pattern and isn't independently
 * testable without a real backend; what's worth covering here is the
 * reassignment UI logic itself.
 */

function fixtureProfile() {
  return {
    id: 'preview-uid',
    updatedAt: 0,
    career: {
      pros: [
        { id: 'charlotte', name: 'Charlotte', styleId: 'bigHitter', attrs: {}, character: 'chip', createdAt: 0 },
        { id: 'parker', name: 'Parker', styleId: 'bigHitter', attrs: {}, character: 'chip', createdAt: 0 }
      ],
      activeProId: 'charlotte',
      cpLedger: {}
    },
    tours: {
      v: 1,
      seasons: {},
      activeId: null,
      archive: [
        {
          key: 'solo:1',
          seasonNo: 1,
          proId: 'charlotte',
          proName: 'Charlotte',
          at: 1000,
          ended: 'finale',
          playerRank: 1,
          playerPoints: 3000,
          standings: [],
          // idx 3 is a TOUR_MAJOR_IDXS entry — actually belongs to Parker per
          // the bug report ("parker has a grand slam but no wins in the
          // table"), still credited to Charlotte here.
          results: [{ idx: 3, playerRank: 1, points: 500, toPar: -2, winnerId: 'player' }]
        },
        {
          key: 'solo:2',
          seasonNo: 2,
          proId: 'parker',
          proName: 'Parker',
          at: 2000,
          ended: 'finale',
          playerRank: 2,
          playerPoints: 1800,
          standings: [],
          results: []
        }
      ]
    },
    tourHistory: {
      charlotte: {
        name: 'Charlotte',
        wins: 1,
        majorWins: 1,
        majors: ['The Ridgeline Open'],
        majorCounts: { 'The Ridgeline Open': 1 },
        seasons: [{ seasonNo: 1, rank: 1, points: 3000 }]
      }
    }
  };
}

test('lists archived seasons and tracks a pending reassignment without saving', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1200 });
  await page.goto('/admin.html');
  await page.waitForFunction(() => '__tourHistoryRepairPreview' in window, { timeout: 15000 });

  await page.evaluate((profile) => {
    (window as unknown as { __tourHistoryRepairPreview: (p: unknown) => void }).__tourHistoryRepairPreview(profile);
  }, fixtureProfile());

  await expect(page.locator('h1')).toContainText('Season Ownership Repair');
  const rows = page.locator('.thrRow');
  await expect(rows).toHaveCount(2);
  // Season 1 shows Charlotte as the current owner, no highlight yet.
  await expect(rows.nth(0)).toContainText('Season 1');
  await expect(rows.nth(0)).toContainText('Charlotte');
  await expect(rows.nth(0)).not.toHaveClass(/thrChanged/);

  const saveBtn = page.locator('#thrSave');
  await expect(saveBtn).toBeDisabled();
  await expect(saveBtn).toContainText('Save 0 changes');

  // Reassign season 1 to Parker.
  await rows.nth(0).locator('.thrPick').selectOption('parker');
  await expect(rows.nth(0)).toHaveClass(/thrChanged/);
  await expect(saveBtn).toBeEnabled();
  await expect(saveBtn).toContainText('Save 1 change');
  await expect(saveBtn).not.toContainText('changes');

  // Picking it back to its original owner clears the pending change.
  await rows.nth(0).locator('.thrPick').selectOption('charlotte');
  await expect(rows.nth(0)).not.toHaveClass(/thrChanged/);
  await expect(saveBtn).toBeDisabled();
  await expect(saveBtn).toContainText('Save 0 changes');
});

test('a Pro no longer in the stable is flagged and the dropdown starts unselected', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1200 });
  await page.goto('/admin.html');
  await page.waitForFunction(() => '__tourHistoryRepairPreview' in window, { timeout: 15000 });

  const profile = fixtureProfile();
  profile.tours.archive[1].proId = 'deleted-pro';
  profile.tours.archive[1].proName = 'Gone Golfer';

  await page.evaluate((p) => {
    (window as unknown as { __tourHistoryRepairPreview: (p: unknown) => void }).__tourHistoryRepairPreview(p);
  }, profile);

  const rows = page.locator('.thrRow');
  await expect(rows.nth(1)).toContainText('Gone Golfer');
  await expect(rows.nth(1)).toContainText('no longer in your stable');
  const select = rows.nth(1).locator('.thrPick');
  await expect(select).toHaveValue('');
});
