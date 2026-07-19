import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * Repeat-round soak gate (retention plan, Phase 0A).
 *
 * Replay and Play Next rebuild the Babylon Scene over and over inside ONE page
 * lifetime — no reload ever happens between rounds. Any resource that survives
 * a HoleScene.dispose() therefore accumulates round after round: meshes,
 * materials, textures, scene observers, engine-level scenes, listeners. This
 * spec cycles every course twice (start → aiming → steady state → next
 * course), snapshotting window.__golfSoak() each visit, and asserts the second
 * visit to a course lands on the SAME resource counts as the first — the exact
 * accumulation class the acceptance criteria call out for Replay / Play Next.
 *
 * Headless Chromium throttles rAF to ~1fps, which stalls the bounded
 * per-frame scatter drain — so each visit drives explicit scene.render()
 * bursts until the mesh count stops moving (true steady state), the same
 * technique the perf spec uses.
 *
 * Heap is recorded to the baseline JSON for trend reading but not asserted
 * (GC timing makes it flaky in CI).
 */

interface SoakSnap {
  hasScene: boolean;
  course: string;
  natureSettled: boolean;
  meshes: number;
  materials: number;
  textures: number;
  particleSystems: number;
  beforeRenderObservers: number;
  engineScenes: number;
  sfxCacheSize: number;
  heapMB: number | null;
}

const COURSES = ['sablebay', 'wildwood', 'timberline', 'portjohnson', 'redhollow', 'wildvalley'];

test('repeat rounds do not accumulate scene resources (soak)', async ({ page }) => {
  test.setTimeout(1_500_000);
  // Surface page-side failures — a scene build that throws leaves the page
  // alive but the next scene never appears, which otherwise reads as a bare
  // waitForFunction timeout with no cause.
  // Software-GL raster cost scales with pixels — run the soak at a phone
  // viewport so eight full course builds don't starve the GPU process.
  await page.setViewportSize({ width: 390, height: 844 });
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
    console.log(`[soak pageerror] ${String(err)}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[soak console.error] ${msg.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__startRound);

  const visits: Array<{ course: string; cycle: number; snap: SoakSnap }> = [];

  for (let cycle = 0; cycle < 2; cycle++) {
    for (const courseId of COURSES) {
      // Capture the previous scene's build sequence, then wait for a HIGHER
      // one — __startRound defers the actual build a frame, so polling
      // __slice3d immediately races onto the old scene's handle.
      const prevSeq = await page.evaluate(() => (window as any).__slice3d?.seq ?? 0);
      await page.evaluate(
        (id) => (window as any).__startRound({ name: 'Soak', courseId: id }),
        courseId
      );
      await page.waitForFunction(
        (prev) => ((window as any).__slice3d?.seq ?? 0) > prev,
        prevSeq,
        { timeout: 180_000 }
      );
      await page.evaluate(() => (window as any).__slice3d.skipIntro());
      await page.waitForFunction(
        () => (window as any).__slice3d?.state?.phase === 'aiming',
        undefined,
        { timeout: 60_000 }
      );
      // Drive render bursts until the scatter drain finishes and the mesh
      // count stops moving — headless rAF throttling would otherwise leave the
      // scene half-planted and the counts meaningless.
      // Drive render bursts (in short evaluate calls so async asset loads can
      // progress between them) until the scene reports natureSettled — the
      // scatter drain + ship swap are done and resource counts are meaningful.
      // SwiftShader renders cost ~25-40ms each, so bursts stay small.
      let settled = false;
      for (let burst = 0; burst < 60 && !settled; burst++) {
        settled = (await page.evaluate(() => {
          const scene = (window as any).__slice3d.scene;
          for (let i = 0; i < 15; i++) scene.render();
          return (window as any).__golfSoak().natureSettled as boolean;
        })) as boolean;
        await page.waitForTimeout(120);
      }
      expect(settled, `${courseId} cycle ${cycle}: nature settled`).toBe(true);
      const snap = (await page.evaluate(() => (window as any).__golfSoak())) as SoakSnap;
      visits.push({ course: courseId, cycle, snap });
      console.log(`[soak] cycle ${cycle} ${courseId}: meshes=${snap.meshes} mats=${snap.materials} tex=${snap.textures} obs=${snap.beforeRenderObservers} heap=${snap.heapMB}MB`);
    }
  }
  expect(pageErrors, `page errors during soak:\n${pageErrors.join('\n')}`).toEqual([]);

  writeFileSync('tests/visual/__shots__/soak-baseline.json', JSON.stringify(visits, null, 2));

  for (const courseId of COURSES) {
    const first = visits.find((v) => v.course === courseId && v.cycle === 0)!.snap;
    const second = visits.find((v) => v.course === courseId && v.cycle === 1)!.snap;
    const label = (k: keyof SoakSnap): string =>
      `${courseId} ${String(k)}: cycle0=${String(first[k])} cycle1=${String(second[k])}`;
    // The probe must be measuring the course we started (guards against a
    // silent course-switch failure making the whole soak vacuous).
    expect(first.course.toLowerCase().replace(/\s+/g, '')).toContain(
      courseId === 'portjohnson' ? 'portjohnson' : courseId === 'sablebay' ? 'sablebay' : courseId
    );
    // The engine must never hold more than the one live scene.
    expect(second.engineScenes, label('engineScenes')).toBe(1);
    // Scene-scoped resources return to the same level for the same course.
    // Mesh counts carry ambient-spawner variance at snapshot time (Wildwood's
    // petal field spawns over time; observed run-to-run band ~±55 on a 2.2k
    // count) — so meshes get a wide-but-meaningful band, while the DURABLE
    // classes below (materials/textures/observers/particle systems/scenes)
    // are held tight: a genuinely retained scene adds hundreds of meshes AND
    // dozens of materials, which still trips every one of these gates.
    // PROPORTIONAL band (was a fixed 64): seeded pin/tee layouts shift the
    // planting keep-out radii between cycles, and that variance scales with
    // total instance count — Wild Prairie's terrain-pass prairie (~19k
    // instances) legitimately oscillates ~±90 without any retention. 1% of
    // the course's own count keeps the gate meaningful at every density: a
    // genuinely retained scene re-adds its full planting (thousands).
    const meshBand = Math.max(64, Math.round(first.meshes * 0.01));
    expect(Math.abs(second.meshes - first.meshes), label('meshes')).toBeLessThanOrEqual(meshBand);
    expect(Math.abs(second.materials - first.materials), label('materials')).toBeLessThanOrEqual(4);
    expect(Math.abs(second.textures - first.textures), label('textures')).toBeLessThanOrEqual(4);
    expect(
      Math.abs(second.beforeRenderObservers - first.beforeRenderObservers),
      label('beforeRenderObservers')
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(second.particleSystems - first.particleSystems),
      label('particleSystems')
    ).toBeLessThanOrEqual(2);
  }
  // The SFX cache is keyed by sample name — bounded by the sample set, never
  // by rounds played.
  const last = visits[visits.length - 1].snap;
  expect(last.sfxCacheSize).toBeLessThanOrEqual(12);
});
