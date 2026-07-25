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
 *
 * Every divergence this gate has caught was the kind nothing else would have:
 * the replay was missing the course's TREE SPECIES (so trunk hitboxes differed
 * and drives clipped trees that were never there); the max-strokes pick-up was
 * not modelled; tee variants were not applied; the ease-in pin choice was not
 * carried in the recording; and — the subtlest — the per-shot RNG was re-seeded
 * AFTER `resolveLaunch` rather than before it, so the first and heaviest
 * consumer of the stream (carry noise, lie noise, residual dispersion) ran on
 * leftover state and no shot was reproducible.
 *
 * The system also fails SAFE by design: `sealRoundRecording` verifies every
 * recording against a replay before keeping it, so a recording that somehow
 * stops round-tripping is dropped rather than used by a ghost or a verifier.
 */

/** Play a whole round through the live code path. Returns the sealed recording.
 *
 *  Shots come from `playSkilledShot` (the AI's selection, played through the
 *  human path) rather than one fixed swing repeated. A fixed swing caps out at
 *  RULES.maxStrokes on every hole, and a capped hole scores 8 wherever the cup
 *  is — which quietly excused the replay from reproducing the PIN at all. A
 *  competent round reaches greens and holes out, so this covers putting, gimmes
 *  and pin placement as well as ball flight. */
async function playRound(page: import('@playwright/test').Page): Promise<{
  shots: unknown[];
  scores: number[];
  gp?: boolean;
}> {
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
      // `__slice3d` is null between holes while the next scene builds — that
      // means WAIT, never STOP.
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
    const rec = await page.evaluate(() =>
      (
        window as never as {
          __lastRecording(): { shots: unknown[]; scores: number[]; gp?: boolean } | null;
        }
      ).__lastRecording()
    );
    if (rec) return rec;
  }
  throw new Error('the round never finished');
}

test('a round played in the real game replays to the score it was played at', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The client-side self-check logs WHY it dropped a recording; surfacing it
  // here is what turns a red test into a diagnosis.
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[recording]')) console.log('PAGE ' + t);
  });

  // easeIn ON deliberately: a device's first casual rounds are played to the
  // KINDEST cup rather than the seeded one, and that choice is not derivable
  // from the seed. The recording has to carry it (`gp`) or the replay plays the
  // round into a different hole. This is the configuration that caught that.
  await page.goto('/?freeze=1&ff.easeIn=on');
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

  const rec = await playRound(page);
  expect(rec.shots.length, 'a played round must record shots').toBeGreaterThan(0);
  expect(rec.gp, 'a first round with easeIn on must record that it drew the gentle pins').toBe(true);
  // A round where every hole capped out proves far less than it looks: the
  // score is the cap regardless of where the ball or the cup ended up. At least
  // one hole must have been genuinely holed out.
  expect(
    Math.min(...rec.scores),
    `every hole hit the 8-stroke cap (${rec.scores.join('/')}) — nothing was holed out, so this round never tested the pin`
  ).toBeLessThan(8);

  const verdict = await page.evaluate(() =>
    (
      window as never as {
        __verifyLastRecording(): { ok: boolean; status: string; actualTotal: number; claimedTotal: number; detail?: string };
      }
    ).__verifyLastRecording()
  );
  console.log(
    `RECORDING ${rec.shots.length} shots, scores ${rec.scores.join('/')}${rec.gp ? ' (ease-in pins)' : ''} → ${JSON.stringify(verdict)}`
  );
  expect(verdict.status, verdict.detail ?? '').toBe('verified');
  expect(verdict.actualTotal).toBe(verdict.claimedTotal);
  expect(errors, errors.join('\n')).toEqual([]);
});

/**
 * The ghost is the recording stack's other consumer, and it can fail in ways
 * verification cannot see. Verification only compares a NUMBER; a ghost puts a
 * ball in the air. A ghost that is armed but never flies, or that stops after
 * the first hole, or whose standing is computed against the wrong hole, would
 * all still "verify" perfectly.
 *
 * So: play a round, race it, and check that the opponent is real — armed, named,
 * scored, and putting a ball in the air on the hole being played.
 */
test('a recorded round can be raced as a ghost, and the ghost actually flies', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[recording]') || t.includes('[ghost]')) console.log('PAGE ' + t);
  });

  // easeIn OFF: those rounds are played to the kindest cup and are deliberately
  // NOT offered as ghosts (a race uses the seeded pins, so it would be a race
  // against a score set on an easier course). With it on, this spec would be
  // exercising that rejection rather than the racing path.
  await page.goto('/?freeze=1&ff.easeIn=off');
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__startRound);
  await page.evaluate(() =>
    (window as never as { __startRound: (o: unknown) => void }).__startRound({
      name: 'Racer',
      courseId: 'sablebay',
      seed: 13579,
      character: 'chip',
      archetype: 'bigHitter'
    })
  );
  await page.waitForFunction(() => !!(window as never as Record<string, unknown>).__slice3d, undefined, {
    timeout: 90_000
  });

  const first = await playRound(page);
  console.log(`GHOST SOURCE ${first.shots.length} shots, scores ${first.scores.join('/')}`);
  expect(first.gp ?? false, 'easeIn was off, so this round must not be flagged gentle').toBe(false);

  // Race it through the real button on the results card, not a back door.
  await page.click('#ghostBtn');
  // Wait for a NEW scene (the seq counter moves per hole build), not just any —
  // the previous round's scene can still be answering for a moment.
  await page.waitForFunction(
    () => {
      const w = window as never as {
        __slice3d?: { state: { holeIdx: number; strokes: number } };
        __ghostStanding(): unknown;
      };
      return !!w.__slice3d && w.__slice3d.state.holeIdx === 0 && !!w.__ghostStanding();
    },
    undefined,
    { timeout: 90_000 }
  );

  const standing = await page.evaluate(() =>
    (window as never as { __ghostStanding(): { name: string; scores: number[] } | null }).__ghostStanding()
  );
  expect(standing, 'the ghost was dropped rather than armed').toBeTruthy();
  expect(standing!.name).toBe('Racer');
  // The ghost's replayed scores must be the scores its owner actually posted —
  // if these differ, the ghost is racing a round that was never played.
  expect(standing!.scores).toEqual(first.scores);

  // Now play far enough to see the ghost fly. One shot is enough to prove the
  // ball is created, enabled and moved along its recorded path; the standing
  // above proves the whole round replayed.
  let flew = false;
  for (let guard = 0; guard < 120 && !flew; guard++) {
    flew = (await page.evaluate(() => {
      const w = window as never as {
        __slice3d?: {
          state: { phase: string };
          skipIntro(): void;
          playSkilledShot(): boolean;
          settleFlight(): boolean;
          settleGhostFlight(): boolean;
          ghostDebug(): { shown: boolean; flying: boolean; shotIdx: number; pos: number[] | null } | null;
        };
      };
      const s = w.__slice3d;
      if (!s) return false;
      if (s.state.phase === 'intro') {
        s.skipIntro();
        return false;
      }
      if (s.state.phase === 'aiming') {
        s.playSkilledShot();
        // The ghost's shot is launched alongside the player's, so by now it is
        // armed and in the air.
        const g = s.ghostDebug();
        if (!g || !g.shown || !g.flying) return false;
        const start = g.pos!.slice();
        s.settleGhostFlight();
        const end = s.ghostDebug()!.pos!;
        const moved = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
        if (moved < 1) throw new Error(`ghost ball did not move (${moved.toFixed(3)} units)`);
        return true;
      }
      if (s.state.phase === 'flying') s.settleFlight();
      return false;
    })) as boolean;
    await page.waitForTimeout(80);
  }
  expect(flew, 'the ghost never put a ball in the air alongside the player').toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});
