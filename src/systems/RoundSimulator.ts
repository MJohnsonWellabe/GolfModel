import { RULES } from '../config';
import { CourseData, Golfer, HoleData, Surface, Wind } from '../core/types';
import { resolveTheme } from '../core/rendering/Theme';
import { mulberry32, Rng } from '../utils/Random';
import { AIController } from './AIController';
import { FireSystem } from './FireSystem';
import { buildHeightField } from './HeightField';
import { PhysicsEngine } from './PhysicsEngine';
import { withPlayableBoundary } from './PlayableBoundary';
import { TreeSpecies } from './treeField';
import { DEFAULT_TREE_MIX } from './treeHitbox';

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
  /** Per-course wind band (mph); defaults 2..20. */
  windMin?: number;
  windMax?: number;
  /** Ordinary-bunker depth multiplier (theme.bunkerDepthScale); defaults 1.
   *  Threaded from the course theme so the headless physics matches the live
   *  round's terrain (Sable Bay's deeper dished traps). */
  bunkerDepthScale?: number;
  /** Waste blowout dish multiplier (theme.wasteDepthScale); defaults 0 (flat). */
  wasteDepthScale?: number;
  /** Tree-species mix (theme.treeKeys/accentTreeKeys, defaulted) so the headless
   *  physics shapes each trunk's hitbox like the live-drawn asset. */
  treeSpecies?: TreeSpecies;
  /** BOUNDED WORLD (`boundedWorld` flag): when true, derive a playable boundary
   *  for the hole so the balancing AI pays the same off-course penalties the
   *  live round does. Defaults false (classic full-world behavior). */
  bounded?: boolean;
}

/**
 * Draw a hole's wind from a course's band. Shared by the headless simulator and
 * the live round (main.ts windForHole) so both floor the speed at the same
 * per-course minimum — a links like Port Johnson (minWind 20) is always breezy,
 * never dead calm. `windMin`/`windMax` default to the game-wide 2..20 mph band.
 */
export function drawWind(rng: Rng, windMin = 2, windMax = 20): Wind {
  return {
    angle: rng() * Math.PI * 2,
    speed: Math.round(windMin + rng() * Math.max(0, windMax - windMin))
  };
}

export function simulateHole(hole: HoleData, golfer: Golfer, opts: SimulateHoleOpts): HoleSimResult {
  const { rng } = opts;
  const wind = opts.wind ?? drawWind(rng, opts.windMin, opts.windMax);
  hole = withPlayableBoundary(hole, opts.bounded ?? false);
  const engine = new PhysicsEngine(
    hole,
    buildHeightField(hole, opts.bunkerDepthScale ?? 1, opts.wasteDepthScale ?? 0),
    rng,
    opts.treeSpecies
  );
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
    strokes += 1 + (out.waterPenalty ? 1 : 0) + (out.obPenalty ? 1 : 0);
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

export function simulateRound(
  course: CourseData,
  golfer: Golfer,
  seed: number,
  holeCount?: number,
  bounded = false
): RoundSimResult {
  const rng = mulberry32(seed);
  const holes = course.holes.slice(0, holeCount ?? Math.min(RULES.holesPerRound, course.holes.length));
  const theme = resolveTheme(course);
  const bunkerDepthScale = theme.bunkerDepthScale ?? 1;
  const wasteDepthScale = theme.wasteDepthScale ?? 0;
  const treeSpecies: TreeSpecies = {
    trees: theme.treeKeys ?? DEFAULT_TREE_MIX,
    accents: theme.accentTreeKeys ?? []
  };
  const results = holes.map((h) =>
    simulateHole(h, golfer, {
      rng,
      windMin: course.minWind,
      windMax: course.maxWind,
      bunkerDepthScale,
      wasteDepthScale,
      treeSpecies,
      bounded
    })
  );
  const total = results.reduce((a, r) => a + r.strokes, 0);
  const par = holes.reduce((a, h) => a + h.par, 0);
  return { holes: results, total, par, toPar: total - par };
}
