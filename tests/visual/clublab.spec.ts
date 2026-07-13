import { test } from '@playwright/test';

/**
 * Club lab: equipment QA contact sheet. Boots the club close-up capture pose,
 * then rebuilds the procedural clubs through Golfer3D.rebuildClubs with a set
 * of ClubTuning variants and captures each from three angles:
 *
 *   hero — the stock cam=club framing (whole golfer, club against the sky)
 *   face — close-up from the target side (face + silhouette next to the ball)
 *   edge — down the toe-heel axis (front-to-back head thickness vs the shaft)
 *
 * Output lands in tests/visual/__shots__/clublab/. Not a pass/fail gate —
 * PNGs for art review, same contract as screenshots.spec.ts.
 */

interface LabShot {
  name: string;
  kind: 'driver' | 'swing' | 'putter';
  tuning: Record<string, unknown>;
}

// Confirmation pass: the shipped DEFAULT_CLUB_TUNING (empty overrides), after
// the playtest picks — tall driver / razor iron, 1.3× shaft joined to the
// very back of each head.
// The shipped clubs (DEFAULT_CLUB_TUNING, empty overrides). To review a
// proposed change, add variants here with tuning overrides, run this spec,
// and eyeball the shots — then fold the pick back into the defaults.
const SHOTS: LabShot[] = [
  { name: 'iron-final', kind: 'swing', tuning: {} },
  { name: 'driver-final', kind: 'driver', tuning: {} },
  { name: 'putter-final', kind: 'putter', tuning: {} }
];

test('club lab contact sheet', async ({ page }) => {
  await page.goto('/?hole=1&cam=club&freeze=1');
  await page.waitForFunction(() => (window as unknown as { __shotReady?: boolean }).__shotReady === true, undefined, {
    timeout: 90_000
  });
  await page.waitForTimeout(600);

  for (const shot of SHOTS) {
    await page.evaluate(
      ([kind, tuning]) => (window as any).__slice3d.clubLab(tuning, kind),
      [shot.kind, shot.tuning] as const
    );
    for (const view of ['hero', 'face', 'edge', 'top'] as const) {
      await page.evaluate((v) => (window as any).__slice3d.clubLabView(v), view);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `tests/visual/__shots__/clublab/${shot.name}-${view}.png` });
    }
  }
});
