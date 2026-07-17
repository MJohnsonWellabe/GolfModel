import { describe, expect, it } from 'vitest';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { buildHeightField } from '../../src/systems/HeightField';
import { AimControl, ShotContext } from '../../src/core/input/AimControl';
import { computeTrueVisionPath } from '../../src/systems/TrueVision';
import { golferWith } from './simHelpers';
import { HoleData, Point, SpinState, Surface, Wind } from '../../src/core/types';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import portjohnson from '../../src/data/courses/portjohnson.json';
import timberline from '../../src/data/courses/timberline.json';
import sablebay from '../../src/data/courses/sablebay.json';
import wildwood from '../../src/data/courses/wildwood.json';

/**
 * True Vision is a v1.0 QUALITY GATE (A2 / ADJ-6). It reveals the REAL flight of
 * the shot the player is currently aimed at, on the same terrain+slope engine
 * (engine2d) the real shot uses, with all randomness zeroed (preview:true). The
 * promise the whole feature rests on: a PERFECT, noise-free real shot lands
 * EXACTLY where True Vision showed it — anything else would be True Vision lying.
 *
 * These tests build engines EXACTLY as the shipped game does (a FLAT preview
 * engine for the aim line + the real heightfield engine for pace/shot), derive
 * the shot power through the shipped AimControl path, then compare:
 *   - TrueVision:  computeTrueVisionPath(engine2d, …)              (TrueVision.ts)
 *   - Real shot:   engine2d.resolveLaunch({…, preview:true})
 *                    → engine2d.integrateLaunch(launch, {side:0, top}, 0)
 *     which is byte-for-byte the noise-free version of executeShot's two-call
 *     path in main.ts. If TrueVision.ts ever drifts from that path (drops the
 *     stroke count, mishandles shape spin / launchMult, forgets the slope-aware
 *     power), the endpoints diverge and this fails.
 *
 * Every governing input — slope, lie, wind, rollout, fringe, rough, green speed,
 * club, spin (shape), launchMult, elevation, physics constants — is identical
 * between the two by construction, so the endpoints must match to the pixel.
 */

const golfer = golferWith(85);

interface Scenario {
  name: string;
  hole: HoleData;
  ball: Point;
  lie: Surface;
  strokes: number;
  clubId?: string;
  yaw?: number;
  distPx?: number;
  spin: SpinState;
  launchMult: number;
  wind: Wind;
  fireBoost?: number;
}

/** Run the shipped derivation and return {tv, real} finalPos for a scenario. */
function endpoints(s: Scenario): { tv: Point; real: Point; club: string; power: number } {
  // Shipped wiring: FLAT preview engine drives the aim line AND the (flat, dumb)
  // putt pace; the real heightfield engine runs True Vision + the real shot. The
  // same `power` feeds both sides below, so parity holds regardless of pace model.
  const previewEngine = new PhysicsEngine({ ...s.hole, slope: { angle: 0, strength: 0 } }, null, () => 0.5);
  const engine2d = new PhysicsEngine(s.hole, buildHeightField(s.hole), () => 0.5);
  const aim = new AimControl(s.hole, previewEngine);
  const ctx: ShotContext = { ball: s.ball, lie: s.lie, golfer, fireBoost: s.fireBoost ?? 0, strokes: s.strokes };
  if (s.clubId) aim.setClubById(s.clubId);
  else aim.autoSelectClub(ctx);
  if (s.yaw !== undefined) aim.yaw = s.yaw;
  else aim.resetAim(ctx);
  if (s.distPx !== undefined) aim.distPx = s.distPx;

  // Power derived exactly as executeShot does for a PERFECT swing: a perfect
  // meter stops at barPowerTarget, then barToPhysicsPower converts it. True
  // Vision (main.ts:1566) uses the SAME expression.
  const power = aim.barToPhysicsPower(aim.barPowerTarget(ctx), ctx);

  // True Vision path.
  const tvPath = computeTrueVisionPath(engine2d, s.hole, ctx, {
    aimAngle: aim.yaw,
    power,
    club: aim.club,
    wind: s.wind,
    spin: s.spin,
    launchMult: s.launchMult
  });

  // Real shot's NOISE-FREE path — the exact two-call path executeShot runs, but
  // with preview:true so the only difference from a live perfect shot is the
  // (legitimate) random dispersion we intentionally strip here.
  const launch = engine2d.resolveLaunch({
    origin: s.ball,
    aimAngle: aim.yaw,
    swing: { power, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
    club: aim.club,
    golfer,
    fireBoost: s.fireBoost ?? 0,
    lie: s.lie,
    wind: s.wind,
    hole: s.hole,
    preview: true,
    spin: s.spin,
    launchMult: s.launchMult,
    stroke: s.strokes
  });
  const realOut = engine2d.integrateLaunch(launch, { side: 0, top: s.spin.top }, 0);

  const tv = tvPath[tvPath.length - 1];
  return { tv: { x: tv.x, y: tv.y }, real: realOut.finalPos, club: aim.club.id, power };
}

function buildScenarios(): Scenario[] {
  const courses = [portjohnson, timberline, sablebay, wildwood].map((c) =>
    loadCourse(c as unknown as CourseAuthoring)
  );
  const list: Scenario[] = [];
  const winds: Wind[] = [
    { angle: 0, speed: 0 },
    { angle: Math.PI / 3, speed: 14 }
  ];
  for (const course of courses) {
    for (const h of course.holes) {
      // Tee shot (driver) — flight, rollout, elevation, wind.
      list.push({
        name: `${course.name} h${h.number} tee driver`,
        hole: h, ball: h.tee, lie: 'tee', strokes: 0, clubId: 'driver',
        spin: { side: 0.4, top: 0 }, launchMult: 1, wind: winds[h.number % 2]
      });
      // Approach from a fairway waypoint (iron) with backspin shape.
      const wp = h.aiTargets?.[0];
      if (wp) {
        list.push({
          name: `${course.name} h${h.number} approach 7i (backspin)`,
          hole: h, ball: wp, lie: 'fairway', strokes: 1, clubId: '7i',
          spin: { side: 0, top: -0.6 }, launchMult: 1.15, wind: winds[(h.number + 1) % 2]
        });
        // Same waypoint played from the rough (lie spin/scatter differs).
        list.push({
          name: `${course.name} h${h.number} rough 9i`,
          hole: h, ball: wp, lie: 'rough', strokes: 2, clubId: '9i',
          spin: { side: -0.5, top: 0 }, launchMult: 1, wind: winds[h.number % 2]
        });
      }
      // A putt on the green, on/near the pin, aimed across the authored slope.
      const puttOrigin = { x: h.pin.x - 40, y: h.pin.y + 24 };
      list.push({
        name: `${course.name} h${h.number} putt (sloped green)`,
        hole: h, ball: puttOrigin, lie: 'green', strokes: 2, clubId: 'putter',
        yaw: Math.atan2(h.pin.y - puttOrigin.y, h.pin.x - puttOrigin.x),
        distPx: Math.hypot(h.pin.x - puttOrigin.x, h.pin.y - puttOrigin.y),
        spin: { side: 0, top: 0 }, launchMult: 1, wind: { angle: 0, speed: 0 }
      });
    }
  }
  return list;
}

describe('True Vision parity — a perfect noise-free shot lands exactly where True Vision showed it (A2/ADJ-6)', () => {
  const scenarios = buildScenarios();
  it('covers a broad matrix of surfaces / slopes / clubs / spin / wind', () => {
    expect(scenarios.length).toBeGreaterThan(40);
  });
  for (const s of scenarios) {
    it(s.name, () => {
      const { tv, real } = endpoints(s);
      // Identical engine, params and randomness (none) → identical endpoint. A
      // sub-pixel tolerance absorbs nothing but IEEE re-association; any real
      // divergence (a dropped param, a non-slope-aware power) is many px.
      const d = Math.hypot(tv.x - real.x, tv.y - real.y);
      expect(d, `TrueVision (${tv.x.toFixed(3)},${tv.y.toFixed(3)}) vs real (${real.x.toFixed(3)},${real.y.toFixed(3)}) Δ=${d.toFixed(4)}px`).toBeLessThan(1e-6);
    });
  }
});
