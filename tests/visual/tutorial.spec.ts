import { expect, test } from '@playwright/test';

/**
 * The tutorial must not stand in front of what it is teaching.
 *
 * The coach card was pinned to the top of the screen — and so is the HUD, so the
 * card explaining how to read the wind sat directly on top of the wind chip. The
 * player is told to look at something they cannot see. This is a geometry
 * problem, so it gets a geometry test: whatever the card is highlighting, the
 * two rectangles must not intersect.
 */
test('a coach card never covers the thing it is highlighting', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // A phone, because that is where the overlap actually bites.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?freeze=1');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__startRound);
  await page.locator('#landingLearn').dispatchEvent('pointerdown');

  const card = page.locator('.tutCard');
  await card.waitFor({ state: 'visible', timeout: 90_000 });

  // Walk the lesson, checking every card against whatever it points at.
  let checked = 0;
  for (let step = 0; step < 12; step++) {
    if (!(await card.isVisible())) break;
    const overlap = await page.evaluate(() => {
      const el = document.querySelector('.tutCard') as HTMLElement | null;
      const hi = document.querySelector('.tutHi') as HTMLElement | null;
      if (!el || !hi) return null;
      const a = el.getBoundingClientRect();
      const b = hi.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return null;
      const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return {
        area: overlapX * overlapY,
        subject: hi.id,
        card: `${Math.round(a.top)}..${Math.round(a.bottom)}`,
        hiBox: `${Math.round(b.top)}..${Math.round(b.bottom)}`
      };
    });
    if (overlap) {
      checked += 1;
      expect(
        overlap.area,
        `the card (${overlap.card}) covers #${overlap.subject} (${overlap.hiBox})`
      ).toBe(0);
    }
    const next = page.locator('.tutNext');
    if (!(await next.isVisible())) break;
    await next.dispatchEvent('pointerdown');
    await page.waitForTimeout(150);
  }

  expect(checked, 'no highlighted card was ever shown — the lesson did not run').toBeGreaterThan(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('coach cards stay short enough to read', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?freeze=1');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__startRound);
  await page.locator('#landingLearn').dispatchEvent('pointerdown');
  await page.locator('.tutCard').waitFor({ state: 'visible', timeout: 90_000 });

  for (let step = 0; step < 12; step++) {
    const card = page.locator('.tutCard');
    if (!(await card.isVisible())) break;
    // A card taller than a third of the screen is a wall of text on a phone,
    // whatever it says.
    const box = (await card.boundingBox())!;
    const body = await page.locator('.tutBody').innerText();
    expect(box.height, `card is ${Math.round(box.height)}px tall: "${body}"`).toBeLessThan(844 / 3);
    const next = page.locator('.tutNext');
    if (!(await next.isVisible())) break;
    await next.dispatchEvent('pointerdown');
    await page.waitForTimeout(150);
  }
});
