import { RULES } from '../config';
import { CourseData, Golfer, HoleData, Surface, Wind } from '../core/types';
import { mulberry32, Rng } from '../utils/Random';
import { AIController } from './AIController';
import { FireSystem } from './FireSystem';
import { buildHeightField } from './HeightField';
import { PhysicsEngine } from './PhysicsEngine';

/**
 * Headless round player: the AIController + PhysicsEngine drive a golfer
 * around real course data with no DOM or rendering. This is the balancing
 * instrument for the GDD Appendix A targets — seeded, so every simulation
 * suite is deterministic — and doubles as the difficulty proxy for player
 * skill tiers (the AI consumes the same physics and quality bands).
 */

export interface HoleSimResult {
  strokes: number;
  putts: number;
  /** Tee shot finished on the short stuff (par 4/5 only; par 3s are null). */
  fairwayHit: boolean | null;
  /** Green in regulation: on the green with (par - 2) strokes or fewer. */
  gir: boolean;
  holed: boolean;
}

export interface RoundSimResult {
  holes: HoleSimResult[];
  total: number;
  par: number;
  toPar: number;
}

export interface SimulateHoleOpts {
  rng: Rng;
  wind?: Wind;
}

export function simulateHole(hole: HoleData, golfer: Golfer, opts: SimulateHoleOpts): HoleSimResult {
  const { rng } = opts;
  const wind = opts.wind ?? { angle: rng() * Math.PI * 2, speed: Math.round(2 + rng() * 18) };
  const engine = new PhysicsEngine(hole, buildHeightField(hole), rng);
  const ai = new AIController(golfer, new FireSystem(), engine, rng);

  let ball = { ...hole.tee };
  let lie: Surface = 'tee';
  let strokes = 0;
  let putts = 0;
  let fairwayHit: boolean | null = hole.par >= 4 ? false : null;
  let gir = false;
  let holed = false;

  while (!holed && strokes < RULES.maxStrokes) {
    const d = ai.decide(ball, lie, wind, hole);
    const out = engine.simulate({
      origin: ball,
      aimAngle: d.aimAngle,
      swing: d.swing,
      club: d.club,
      golfer,
      fireBoost: 0,
      lie,
      wind,
      hole,
      spin: d.spin,
      launchMult: d.spin ? 1 - d.spin.top * 0.18 : 1
    });
    if (d.club.id === 'putter') putts++;
    strokes += 1 + (out.waterPenalty ? 1 : 0);
    ball = { ...out.finalPos };
    lie = out.surface;
    holed = out.holed;
    if (strokes === 1 && hole.par >= 4) {
      fairwayHit = out.surface === 'fairway' || out.surface === 'green' || out.surface === 'fringe';
    }
    if (!gir && (out.surface === 'green' || holed) && strokes <= hole.par - 2) gir = true;
  }
  return { strokes, putts, fairwayHit, gir, holed };
}

export function simulateRound(course: CourseData, golfer: Golfer, seed: number, holeCount?: number): RoundSimResult {
  const rng = mulberry32(seed);
  const holes = course.holes.slice(0, holeCount ?? Math.min(RULES.holesPerRound, course.holes.length));
  const results = holes.map((h) => simulateHole(h, golfer, { rng }));
  const total = results.reduce((a, r) => a + r.strokes, 0);
  const par = holes.reduce((a, h) => a + h.par, 0);
  return { holes: results, total, par, toPar: total - par };
}
