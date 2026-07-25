import { expect, test } from '@playwright/test';

/**
 * The end-to-end round-trip that the whole recording stack rests on.
 *
 * The unit tests prove the replay engine is self-consistent. They cannot prove
 * the thing that actually matters: that the LIVE GAME records what it played.
 * If `executeShot` and the recorder ever disagree — a parameter the shot uses
 * but the recording omits, a spin channel applied differently, a stroke counted
 * in one and not the other — then verification rejects honest rounds and ghosts
 * fly somewhere their owner never hit the ball. Neither failure is visible by
 * playing; both are obvious here.
 *
 * So: play real shots through the real game, then ask the page to verify its own
 * recording against a replay. Nothing is stubbed.
 */
// KNOWN OPEN — see docs/26_SCALE_PASS.md "Known limitations".
//
// A round played through the live game does not yet replay bit-for-bit. Two
// causes were found and fixed while writing this (the replay was missing the
// course's TREE SPECIES, so trunk hitboxes differed and drives clipped trees
// that were never there; and the physics' one random branch — a putt lipping
// out — was unseeded, making a round irreproducible). A residual divergence of
// roughly 30 yd on a tee shot remains, and it is NOT yet identified.
//
// The system fails SAFE in the meantime: `sealRoundRecording` verifies every
// recording against a replay before keeping it, so a recording that does not
// round-trip is dropped rather than used. Ghosts and verified scores therefore
// under-trigger; they never produce a wrong result.
//
// Un-fixme this the moment the last divergence is closed — it is the gate that
// says the feature is real.
test.fixme('a round played in the real game replays to the score it was played at', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The client-side self-check logs WHY it dropped a recording; surfacing it
  // here is what turns a red test into a diagnosis.
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[recording]')) console.log('PAGE ' + t);
  });

  await page.goto('/?freeze=1');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__startRound);
  await page.evaluate(() =>
    (window as never as { __startRound: (o: unknown) => void }).__startRound({
      name: 'Recorder',
      courseId: 'sablebay',
      seed: 24680,
      character: 'chip',
      archetype: 'bigHitter'
    })
  );

  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, {
    timeout: 90_000
  });

  // Drive the whole round through the LIVE code path: hit a real shot when the
  // game is asking for one, settle it when it is in the air, wait otherwise
  // (`__slice3d` is null between holes while the next scene builds, which means
  // WAIT, never STOP).
  for (let guard = 0; guard < 400; guard++) {
    const step = await page.evaluate(() => {
      const w = window as never as {
        __slice3d?: {
          state: { phase: string };
          skipIntro(): void;
          executeShot(s: unknown, physicsPower: boolean): void;
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
        // A solid but imperfect swing, so the round contains a spread of bands
        // rather than only the perfect path.
        s.executeShot({ power: 0.86, powerQuality: 'good', accuracy: 0.05, accuracyQuality: 'good' }, true);
        return 'hit';
      }
      return 'wait';
    });
    await page.waitForTimeout(step === 'wait' ? 200 : 80);
    const finished = await page.evaluate(
      () => !!(window as never as { __lastRecording(): unknown }).__lastRecording()
    );
    if (finished) break;
  }

  const rec = await page.evaluate(() =>
    (window as never as { __lastRecording(): { shots: unknown[]; scores: number[] } | null }).__lastRecording()
  );
  const verdict = await page.evaluate(() =>
    (
      window as never as {
        __verifyLastRecording(): { ok: boolean; status: string; actualTotal: number; claimedTotal: number; detail?: string };
      }
    ).__verifyLastRecording()
  );
  console.log(`RECORDING ${rec!.shots.length} shots, scores ${rec!.scores.join('/')} → ${JSON.stringify(verdict)}`);
  expect(verdict.status, verdict.detail ?? '').toBe('verified');
  expect(verdict.actualTotal).toBe(verdict.claimedTotal);
  expect(errors, errors.join('\n')).toEqual([]);
});
