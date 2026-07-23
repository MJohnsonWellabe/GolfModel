import { PX_PER_YARD, RULES } from '../config';
import { CourseData, Golfer, HoleData, Surface, SwingResult, Wind } from '../core/types';
import { resolveTheme } from '../core/rendering/Theme';
import { gaussianOf, mulberry32, Rng } from '../utils/Random';
import { AIController } from './AIController';
import { FireSystem } from './FireSystem';
import { buildHeightField } from './HeightField';
import { PhysicsEngine, statsForClub } from './PhysicsEngine';
import { withPlayableBoundary } from './PlayableBoundary';
import { TreeSpecies } from './treeField';
import { DEFAULT_TREE_MIX } from './treeHitbox';
import { ACCURACY_TARGET, resolveUserSwing, SwingCtx, targetBar } from './swingModel';

/**
 * A modeled USER's timing execution: gaussian σ (in bar-fraction units) for the
 * power cursor and the accuracy cursor. When supplied to the round sim, the AI
 * still chooses the club, aim, and intended power (powerTarget), but the SWING
 * itself is drawn from this human error model instead of the AI's stat-band
 * sampler — so the difficulty simulator measures how a real player of a given
 * steadiness scores, not how the AI scores. σ_power/σ_acc are compared directly
 * against the perfect/good band HALF-widths in swingModel to place a tier.
 */
export interface UserSwingModel {
  /** 1σ timing error on the POWER click (fraction of the meter bar). */
  sigmaPower: number;
  /** 1σ timing error on the ACCURACY click (fraction of the meter bar). */
  sigmaAcc: number;
}

/**
 * Replicate main.ts `swingDifficulty()` EXACTLY (the live meter's lie+club perfect
 * zone shrink) so the modeled user's bands match what the live meter would show.
 * Putting → 1; otherwise a lie base, times a per-club factor off any non-tee lie.
 */
export function swingDifficultyFor(lie: Surface, clubId: string, isPutt: boolean): number {
  if (isPutt) return 1;
  let d = lie === 'sand' ? 0.62 : lie === 'trees' ? 0.68 : lie === 'rough' ? 0.8 : lie === 'fringe' ? 0.92 : 1;
  if (lie !== 'tee') {
    const byClub: Record<string, number> = {
      driver: 0.68, '3w': 0.74, '5w': 0.8, '3i': 0.82, '4h': 0.85, '5i': 0.88, '7i': 0.93, '9i': 0.97, pw: 1, sw: 1
    };
    d *= byClub[clubId] ?? 1;
  }
  return d;
}

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
  /** Theme edgeWobble amplitude — widens the physics near-water band to match
   *  the visible painted shore so the sim pays the same splash penalties the
   *  live round does. Defaults 1 (historical 12px floor). */
  edgeWobble?: number;
  /** Tree-species mix (theme.treeKeys/accentTreeKeys, defaulted) so the headless
   *  physics shapes each trunk's hitbox like the live-drawn asset. */
  treeSpecies?: TreeSpecies;
  /** BOUNDED WORLD (`boundedWorld` flag): when true, derive a playable boundary
   *  for the hole so the balancing AI pays the same off-course penalties the
   *  live round does. Defaults false (classic full-world behavior). */
  bounded?: boolean;
  /** When set, keep the AI's club/aim/powerTarget but SUBSTITUTE a modeled user
   *  swing (this timing-error model) for the AI's stat-band swing. Defaults
   *  undefined → the classic AI swing (existing sims + tests unchanged). */
  userModel?: UserSwingModel;
  /** Verification hook: called with each resolved swing's band qualities (the
   *  difficulty simulator tallies the realized perfect/good/miss mix per tier).
   *  Off the critical path for the live game (only the sim passes it). */
  onSwing?: (info: { isPutt: boolean; powerQuality: string; accuracyQuality: string }) => void;
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
    opts.treeSpecies,
    opts.edgeWobble ?? 1
  );
  // ONE shared FireSystem drives both the AI's club/quality reads and the shot's
  // stat boost — exactly as the live round shares the competitor's fire instance
  // between AIController and executeShot (main.ts). Previously the sim built a
  // throwaway FireSystem, hard-coded fireBoost:0, and never fed recordSwing, so
  // it could NEVER ignite — the #1 reason the sim scored the AI harder than live
  // (a legend-tier golfer is on fire most of a round). The sim now reproduces it.
  const fire = new FireSystem();
  const ai = new AIController(golfer, fire, engine, rng);

  // Feet inside which live concedes a putt as a single tap-in stroke
  // (HoleScene.GIMME_FEET). The sim used to putt everything out and could 3-putt
  // from inside 3 ft — strokes the live round never charges.
  const GIMME_FEET = 3;

  let ball = { ...hole.tee };
  let lie: Surface = 'tee';
  let strokes = 0;
  let putts = 0;
  let fairwayHit: boolean | null = hole.par >= 4 ? false : null;
  let gir = false;
  let holed = false;

  while (!holed && strokes < RULES.maxStrokes) {
    // GIMME: a ball at rest on the green inside GIMME_FEET is conceded as one
    // tap-in (live tryGimme runs at the start of every turn, AI included).
    if (lie === 'green' && (Math.hypot(ball.x - hole.pin.x, ball.y - hole.pin.y) / PX_PER_YARD) * 3 <= GIMME_FEET) {
      strokes += 1;
      putts += 1;
      holed = true;
      break;
    }
    const d = ai.decide(ball, lie, wind, hole);
    // Pre-shot fire boost (the streak earned by PRIOR swings), then feed THIS
    // swing into the streak after it resolves — the live ordering (main.ts).
    const fireBoost = fire.statBoost;
    // Swing execution: the AI's stat-band sampler by default, OR a modeled
    // user's timing error (userModel). The user path builds the EXACT SwingCtx
    // the live meter would (statsForClub.zone, fire perfect-zone mult, lie+club
    // difficulty), samples the two cursors as gaussian jitter around their
    // targets, and resolves them through the shared swingModel — identical math
    // to the live meter, so the sim tunes the real difficulty curve.
    let swing: SwingResult = d.swing;
    if (opts.userModel) {
      const isPutt = d.club.id === 'putter';
      const ctx: SwingCtx = {
        stat: statsForClub(d.club, golfer, fireBoost).zone,
        powerTarget: d.powerTarget,
        isPutt,
        perfectMult: fire.perfectZoneMultiplier,
        difficultyMult: swingDifficultyFor(lie, d.club.id, isPutt)
      };
      const powerCursor = targetBar(ctx) + gaussianOf(rng, 0, opts.userModel.sigmaPower);
      const accCursor = ACCURACY_TARGET + gaussianOf(rng, 0, opts.userModel.sigmaAcc);
      swing = resolveUserSwing(ctx, powerCursor, accCursor, rng);
      opts.onSwing?.({ isPutt, powerQuality: swing.powerQuality, accuracyQuality: swing.accuracyQuality });
    }
    const out = engine.simulate({
      origin: ball,
      aimAngle: d.aimAngle,
      swing,
      club: d.club,
      golfer,
      fireBoost,
      lie,
      wind,
      hole,
      spin: d.spin,
      launchMult: d.spin ? 1 - d.spin.top * 0.18 : 1,
      // Recovery shots (2nd/3rd around a tree) get the forgiving hitbox live
      // gives them — the sim omitted this and over-punished escapes.
      stroke: strokes
    });
    fire.recordSwing(swing);
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
  bounded = false,
  userModel?: UserSwingModel,
  onSwing?: SimulateHoleOpts['onSwing']
): RoundSimResult {
  const rng = mulberry32(seed);
  const holes = course.holes.slice(0, holeCount ?? Math.min(RULES.holesPerRound, course.holes.length));
  const theme = resolveTheme(course);
  const bunkerDepthScale = theme.bunkerDepthScale ?? 1;
  const wasteDepthScale = theme.wasteDepthScale ?? 0;
  const edgeWobble = theme.edgeWobble ?? 1;
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
      edgeWobble,
      treeSpecies,
      bounded,
      userModel,
      onSwing
    })
  );
  const total = results.reduce((a, r) => a + r.strokes, 0);
  const par = holes.reduce((a, h) => a + h.par, 0);
  return { holes: results, total, par, toPar: total - par };
}
