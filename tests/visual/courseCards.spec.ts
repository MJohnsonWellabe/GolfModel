import { expect, Page, test } from '@playwright/test';

/**
 * Course-selection cards across the v1.0 viewport classes (Final UX item 4:
 * "cards fit on mobile — no horizontal overflow"). Captures a contact sheet AND
 * asserts the page never scrolls sideways and no card spills past the setup
 * panel. Primary acceptance viewport is 390×844; 360×800 is the tight phone.
 */
const SIZES = [
  { name: '360x800', width: 360, height: 800 }, // tight phone (1-col)
  { name: '390x844', width: 390, height: 844 }, // primary acceptance (2-col)
  { name: '430x932', width: 430, height: 932 }, // large phone
  { name: '844x390', width: 844, height: 390 }, // phone landscape
  { name: '768x1024', width: 768, height: 1024 }, // tablet portrait
  { name: '1280x720', width: 1280, height: 720 } // desktop
];

async function dismissNameModal(page: Page): Promise<void> {
  const input = page.locator('#nmInput');
  try {
    await input.waitFor({ state: 'visible', timeout: 3000 });
    await input.fill('Tester');
    await page.locator('#nmSave').click();
    await input.waitFor({ state: 'hidden', timeout: 3000 });
  } catch {
    /* never appeared */
  }
}

for (const s of SIZES) {
  test(`course cards @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto('/');
    await dismissNameModal(page);
    // Play Now → step 0 (Mode); Next → the Course step (solo default flow).
    await page.locator('#landingPlay').dispatchEvent('pointerdown');
    await page.waitForSelector('#nextBtn', { state: 'visible' });
    await page.locator('#nextBtn').dispatchEvent('pointerdown');
    await page.waitForSelector('.modeGrid--courses .courseCard', { state: 'visible' });
    await page.waitForTimeout(120);
    await page.screenshot({ path: `tests/visual/__shots__/coursecards-${s.name}.png` });

    // No horizontal overflow anywhere: the document must not scroll sideways.
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(docOverflow, `document horizontal overflow @ ${s.name}`).toBeLessThanOrEqual(1);

    // Every card sits fully inside the setup panel (no clipped/off-screen card).
    const panel = page.locator('#setupInner');
    const panelBox = (await panel.boundingBox())!;
    const cards = page.locator('.modeGrid--courses .courseCard');
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const b = (await cards.nth(i).boundingBox())!;
      expect(b.x, `card ${i} left edge @ ${s.name}`).toBeGreaterThanOrEqual(panelBox.x - 1);
      expect(
        b.x + b.width,
        `card ${i} right edge @ ${s.name}`
      ).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
    }
  });
}
