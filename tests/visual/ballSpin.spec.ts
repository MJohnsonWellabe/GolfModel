import { expect, test } from '@playwright/test';

/**
 * THE BALL SPINS (owner: "how hard would it be to make the ball look like it's
 * back spinning in the air? right now it's static which is noticable on the new
 * balls that have designs on them").
 *
 * Invisible to the screenshot suite twice over: the capture harness freezes
 * animation for determinism, and a reference image is one frame — a spin is a
 * relationship BETWEEN frames. So this samples the live scene instead, the same
 * lesson the aerial aim line taught.
 *
 * The trail assertion is not incidental. The ball had to be split into an
 * un-rotated anchor and a spinning skin precisely because Babylon builds the
 * trail's ribbon through the generator's full world matrix; if someone later
 * "simplifies" that back into one mesh, the trail is what breaks, and this is
 * the test that says so.
 */

interface Sample {
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  x: number;
  y: number;
  z: number;
}

async function teeUp(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as never as { __startRound?: unknown }).__startRound, undefined, {
    timeout: 120_000
  });
  await page.evaluate(() => (window as never as { __startRound: (o: unknown) => void }).__startRound({ name: 'Spin' }));
  await page.waitForFunction(() => !!(window as never as { __slice3d?: unknown }).__slice3d, undefined, { timeout: 120_000 });
  await page.evaluate(() => (window as never as { __slice3d: { skipIntro(): void } }).__slice3d.skipIntro());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 60_000 }
  );
}

/** The active ball skin's orientation and world position, right now. */
const sample = (page: import('@playwright/test').Page): Promise<Sample | null> =>
  page.evaluate(() => {
    const s = (window as never as { __slice3d: any }).__slice3d;
    const scene = s.scene;
    const skins = scene.meshes.filter((m: any) => m.name.startsWith('ballSkin'));
    const skin = skins.find((m: any) => m.isEnabled()) ?? skins[0];
    if (!skin?.rotationQuaternion) return null;
    const q = skin.rotationQuaternion;
    const p = skin.getAbsolutePosition();
    return { qx: q.x, qy: q.y, qz: q.z, qw: q.w, x: p.x, y: p.y, z: p.z };
  });

/** Angle between two orientations, in radians. */
function angleBetween(a: Sample, b: Sample): number {
  const dot = Math.abs(a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw);
  return 2 * Math.acos(Math.min(1, dot));
}

/**
 * Play a shot and sample the skin frame by frame.
 *
 * Headless Chromium throttles requestAnimationFrame to ~1fps, so the flight
 * would crawl and a wall-clock poll would catch almost nothing. Drive
 * `scene.render()` explicitly instead — the same technique the perf and soak
 * specs use — and sample inside the page so each reading is one frame apart
 * rather than one round trip apart.
 */
async function sampleFlight(page: import('@playwright/test').Page): Promise<Sample[]> {
  await page.evaluate(() => (window as never as { __slice3d: { playSkilledShot(): boolean } }).__slice3d.playSkilledShot());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'flying',
    undefined,
    { timeout: 60_000 }
  );
  // ONE evaluate for the whole flight. Consecutive samples must be exactly one
  // frame apart for the per-step assertions to mean anything, and splitting
  // this into bursts breaks that: the game's own render loop runs in the gap
  // between two evaluate calls, so the samples either side of a boundary are
  // several frames apart and read as an impossible jump. (That is precisely
  // what failed first time round.) Page JS is synchronous, so nothing can
  // interleave within a single evaluate.
  return (await page.evaluate(() => {
    const s = (window as never as { __slice3d: any }).__slice3d;
    const scene = s.scene;
    const got: unknown[] = [];
    for (let f = 0; f < 600 && s.state.phase === 'flying'; f++) {
      scene.render();
      const skins = scene.meshes.filter((m: any) => m.name.startsWith('ballSkin'));
      const skin = skins.find((m: any) => m.isEnabled()) ?? skins[0];
      if (!skin?.rotationQuaternion) continue;
      const q = skin.rotationQuaternion;
      const p = skin.getAbsolutePosition();
      got.push({ qx: q.x, qy: q.y, qz: q.z, qw: q.w, x: p.x, y: p.y, z: p.z });
    }
    return got;
  })) as Sample[];
}

test('the ball turns as it travels, and keeps turning as it rolls', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await teeUp(page);

  const atRest = await sample(page);
  expect(atRest, 'the ball has a skin with an orientation to spin').not.toBeNull();

  const frames = await sampleFlight(page);
  expect(frames.length, 'the flight produced frames to measure').toBeGreaterThan(8);

  // It TURNED — the whole complaint, and it was false before this change.
  //
  // Accumulate the per-step angles rather than comparing the first frame to
  // the last: a ball that spins through several revolutions comes back near
  // where it started, so the net angle between endpoints wraps and reads as
  // almost no rotation at all. (It read 0.096 rad that way — for a ball that
  // had in fact turned many times.)
  let turned = 0;
  for (let i = 1; i < frames.length; i++) turned += angleBetween(frames[i], frames[i - 1]);
  expect(turned, 'the ball never turned during the shot').toBeGreaterThan(Math.PI); // half a turn, at least

  // Every step stays inside the aliasing bound. A single frame that jumped a
  // half-turn would read as a strobe, which is worse than not spinning at all.
  for (let i = 1; i < frames.length; i++) {
    const moved = Math.hypot(
      frames[i].x - frames[i - 1].x,
      frames[i].y - frames[i - 1].y,
      frames[i].z - frames[i - 1].z
    );
    if (moved < 1e-6) continue; // a paused/park frame turns nothing
    expect(angleBetween(frames[i], frames[i - 1]), `frame ${i} jumped too far to read`).toBeLessThan(Math.PI / 2);
  }

  // A frame in which the ball moved must be a frame in which it turned — that
  // is the difference between rolling and sliding.
  const movedAndTurned = frames.slice(1).filter((f, i) => {
    const d = Math.hypot(f.x - frames[i].x, f.y - frames[i].y, f.z - frames[i].z);
    return d > 0.05 && angleBetween(f, frames[i]) > 1e-4;
  });
  const movedAtAll = frames.slice(1).filter((f, i) => {
    return Math.hypot(f.x - frames[i].x, f.y - frames[i].y, f.z - frames[i].z) > 0.05;
  });
  expect(movedAtAll.length, 'the ball moved during the shot').toBeGreaterThan(4);
  expect(
    movedAndTurned.length,
    'the ball slid without turning on some frames'
  ).toBe(movedAtAll.length);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('the trail survived the anchor/skin split', async ({ page }) => {
  test.setTimeout(300_000);
  await teeUp(page);
  await page.evaluate(() => (window as never as { __slice3d: { playSkilledShot(): boolean } }).__slice3d.playSkilledShot());
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'flying',
    undefined,
    { timeout: 60_000 }
  );
  // Drive real frames so the trail has something to extrude along (rAF is
  // throttled headless — see sampleFlight).
  const trail = await page.evaluate(() => {
    const s = (window as never as { __slice3d: any }).__slice3d;
    for (let f = 0; f < 30 && s.state.phase === 'flying'; f++) s.scene.render();
    const t = s.scene.meshes.find((m: any) => m.name === 'trail');
    if (!t) return null;
    return { vertices: t.getTotalVertices(), enabled: t.isEnabled() };
  });
  expect(trail, 'a full shot must still draw a trail').not.toBeNull();
  expect(trail!.vertices, 'the trail has geometry').toBeGreaterThan(0);
  expect(trail!.enabled).toBe(true);
});

test('each shot starts from a clean face, so tumble does not accumulate', async ({ page }) => {
  test.setTimeout(300_000);
  await teeUp(page);
  await sampleFlight(page);
  // Let the shot settle and the next turn come up.
  await page.waitForFunction(
    () => (window as never as { __slice3d: { state: { phase: string } } }).__slice3d.state.phase === 'aiming',
    undefined,
    { timeout: 60_000 }
  );
  const next = await sample(page);
  expect(next).not.toBeNull();
  // Identity: w = 1 (or -1, the same orientation) and no vector part.
  expect(Math.abs(next!.qw), 'the next shot inherited the last shot\'s tumble').toBeCloseTo(1, 4);
});
