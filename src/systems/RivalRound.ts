/**
 * Synthesising a house rival's round.
 *
 * A friend rival arrives with a real `RoundRecording` — they played it. A house
 * rival has to have one made for them, and the quality bar is high: the point of
 * a rival is that a BALL FLIES NEXT TO YOURS, hit the way a golfer hits it. A
 * target number with a fake name attached would be a worse version of the
 * scoreboard the game already has.
 *
 * So a house rival's round is genuinely PLAYED, headlessly, before you see it:
 * the game's own `AIController` picks every club, aim and shape, a modeled human
 * swing executes them, the real physics resolves every shot, and each decision
 * is captured as a `ShotInput` exactly as the live recorder captures a human's.
 * The output is an ordinary `RoundRecording` — indistinguishable in kind from
 * one a person produced, and consumed by the same `GhostRun` that flies a
 * friend's.
 *
 * DETERMINISM. Everything derives from (rival seed, date, course), so the rival
 * plays the same round on every device the player owns, and re-opening the app
 * does not re-roll the opponent you are chasing.
 *
 * WHAT IS CALIBRATED, AND WHY IT IS THE SWING
 * -------------------------------------------
 * A replayed recording assembles its golfer from the character and archetype the
 * recording NAMES. So anything varied to hit a difficulty target must be
 * something the recording carries, or the replay plays a different golfer than
 * the one that played — the exact class of divergence that took a day to find
 * once already (docs/26_SCALE_PASS.md).
 *
 * The recording carries every swing verbatim: power, power band, accuracy,
 * accuracy band. So the golfer is FIXED (a named archetype, recorded), and what
 * varies is how steadily the rival strikes it — a gaussian timing error on the
 * meter, the same `UserSwingModel` the difficulty simulator uses to model a
 * human of a given standard. A shakier rival makes worse swings, and those
 * swings are what gets recorded, so the replay reproduces them exactly.
 *
 * Rather than fake the score, the steadiness is searched until the round the
 * rival ACTUALLY plays lands on the target. A rival who was supposed to shoot
 * level and instead shot +4 would be a liar with a ghost to prove it.
 *
 * COST. Simulating a one-hole round is a few milliseconds of pure physics; the
 * search runs a handful of them. It happens when the daily card is built —
 * never during play, never on an input path.
 */

import { AIController } from './AIController';
import { FireSystem } from './FireSystem';
import { PhysicsEngine, statsForClub } from './PhysicsEngine';
import { buildHeightField } from './HeightField';
import { withPlayableBoundary } from './PlayableBoundary';
import { applyTeeVariants } from './Layouts';
import { conditionsForRound, shotRngSeed } from './RoundConditions';
import { RoundRecorder, RoundRecording, ShotInput } from './RoundRecording';
import { swingDifficultyFor, UserSwingModel } from './RoundSimulator';
import { ACCURACY_TARGET, resolveUserSwing, SwingCtx, targetBar } from './swingModel';
import { assembleGolfer } from '../data/golfers';
import { gaussianOf, mulberry32 } from '../utils/Random';
import { PHYSICS, PX_PER_YARD, RULES } from '../config';
import type { CourseData, Golfer, Surface, SwingResult } from '../core/types';
import type { ArchetypeId } from '../data/archetypes';
import type { CharacterKey } from '../data/characters';

export interface RivalRoundOpts {
  /** Mirrors the `layouts` flag — pins and tee variants. */
  useAuthoredPins: boolean;
  /** Mirrors the `boundedWorld` flag. */
  bounded: boolean;
  bunkerDepthScale?: number;
  wasteDepthScale?: number;
  edgeWobble?: number;
  treeSpecies?: ConstructorParameters<typeof PhysicsEngine>[3];
}

/**
 * Steadiness ladder searched during calibration, shakiest first — 1σ meter
 * timing error as a fraction of the bar, on the same scale as
 * `SkillSimulator.USER_TIERS`. It spans a nervous club player to a very steady
 * one; a rival outside that band is either a wall or furniture, and neither is
 * worth playing.
 */
const STEADINESS_LADDER = [0.055, 0.042, 0.03, 0.022, 0.016, 0.011, 0.008] as const;

/** The archetype a house rival plays. Recorded, so the replay assembles the
 *  same golfer. Fixed rather than rolled: the rival's standard comes from their
 *  striking, not from a stat block the player cannot see. */
const RIVAL_CHARACTER: CharacterKey = 'chip';
const RIVAL_ARCHETYPE: ArchetypeId = 'sniper';

/** Deterministic per-rival, per-day, per-course seed. Mixed rather than
 *  concatenated so adjacent dates do not produce adjacent rounds. */
export function rivalRoundSeed(rivalSeed: number, dateKey: string, courseId: string): number {
  let h = 2166136261 ^ (rivalSeed >>> 0);
  const s = `${dateKey}|${courseId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

/** The golfer a house rival plays as — and, crucially, the golfer a replay of
 *  their recording will assemble. */
export function rivalGolfer(name = 'Rival'): Golfer {
  return assembleGolfer(name, RIVAL_CHARACTER, RIVAL_ARCHETYPE);
}

interface PlayedRound {
  shots: ShotInput[];
  scores: number[];
}

/**
 * Play a round headlessly, capturing every decision as a recordable input.
 *
 * This is the live round's loop — AI decision, modeled swing, resolve,
 * integrate, count — with the same gimme and max-stroke rules, because a
 * recording that does not obey them cannot be replayed by the engine that does.
 */
function playRound(
  course: CourseData,
  seed: number,
  holes: number,
  golfer: Golfer,
  swingModel: UserSwingModel,
  opts: RivalRoundOpts
): PlayedRound {
  const recorder = new RoundRecorder();
  recorder.start();
  const teed = opts.useAuthoredPins ? applyTeeVariants(course, seed) : course;
  const holeCount = Math.min(holes, teed.holes.length);
  const conditions = conditionsForRound(teed, seed, holeCount, {
    useAuthoredPins: opts.useAuthoredPins,
    bunkerDepthScale: opts.bunkerDepthScale,
    wasteDepthScale: opts.wasteDepthScale,
    maxWind: PHYSICS.maxWind
  });
  const scores: number[] = [];
  // Fire carries across holes in a live round, so one instance spans the round.
  const fire = new FireSystem();

  for (let h = 0; h < holeCount; h++) {
    const hole = withPlayableBoundary({ ...teed.holes[h], pin: conditions.pins[h] }, opts.bounded);
    let shotRng: () => number = mulberry32(shotRngSeed(seed, h, 0));
    const engine = new PhysicsEngine(
      hole,
      buildHeightField(hole, opts.bunkerDepthScale ?? 1, opts.wasteDepthScale ?? 0),
      () => shotRng(),
      opts.treeSpecies,
      opts.edgeWobble ?? 1
    );
    // The rival's DECISION and TIMING randomness is a separate stream from the
    // physics one. Mixing them would make a calibration re-run at a different
    // steadiness perturb the shot resolution too, so the search would be
    // measuring noise instead of standard.
    const humanRng = mulberry32((seed ^ (h * 0x9e3779b1)) >>> 0);
    const ai = new AIController(golfer, fire, engine, humanRng);
    const wind = conditions.winds[h];

    let ball = { ...hole.tee };
    let lie: Surface = 'tee';
    let strokes = 0;

    for (let i = 0; i < RULES.maxStrokes; i++) {
      // Gimme: a ball at rest on the green inside the concession radius is one
      // tap-in, exactly as the live round concedes it.
      if (lie === 'green' && (Math.hypot(ball.x - hole.pin.x, ball.y - hole.pin.y) / PX_PER_YARD) * 3 <= 3) {
        strokes += 1;
        break;
      }
      // Re-seed BEFORE the resolve: it is the first and heaviest consumer of
      // the stream (see RoundConditions.shotRngSeed).
      shotRng = mulberry32(shotRngSeed(seed, h, strokes));
      const d = ai.decide(ball, lie, wind, hole);
      const fireBoost = fire.statBoost;
      // The AI chose the club, the aim and the intended power; the SWING is a
      // modeled human's — two gaussian cursor errors resolved through the same
      // model the live meter uses, so the bands are the bands a person gets.
      const isPutt = d.club.id === 'putter';
      const ctx: SwingCtx = {
        stat: statsForClub(d.club, golfer, fireBoost).zone,
        powerTarget: d.powerTarget,
        isPutt,
        perfectMult: fire.perfectZoneMultiplier,
        difficultyMult: swingDifficultyFor(lie, d.club.id, isPutt)
      };
      const swing: SwingResult = resolveUserSwing(
        ctx,
        targetBar(ctx) + gaussianOf(humanRng, 0, swingModel.sigmaPower),
        ACCURACY_TARGET + gaussianOf(humanRng, 0, swingModel.sigmaAcc),
        humanRng
      );
      recorder.add({
        h,
        a: d.aimAngle,
        c: d.club.id,
        p: swing.power,
        pq: swing.powerQuality,
        ac: swing.accuracy,
        aq: swing.accuracyQuality,
        ss: d.spin?.side ?? 0,
        st: d.spin?.top ?? 0,
        lm: 1,
        rm: 1
      });
      const launch = engine.resolveLaunch({
        origin: ball,
        aimAngle: d.aimAngle,
        swing,
        club: d.club,
        golfer,
        fireBoost,
        lie,
        wind,
        hole,
        spin: { side: d.spin?.side ?? 0, top: d.spin?.top ?? 0 },
        launchMult: 1,
        riskMult: 1,
        stroke: strokes
      });
      const outcome = engine.integrateLaunch(launch, { side: 0, top: d.spin?.top ?? 0 }, 0);
      fire.recordSwing(swing);
      strokes += 1 + (outcome.waterPenalty ? 1 : 0) + (outcome.obPenalty ? 1 : 0);
      ball = outcome.finalPos;
      lie = outcome.surface;
      if (outcome.holed) break;
    }
    scores.push(strokes);
  }

  const rec = recorder.finish({
    courseId: 'pending',
    seed,
    holes: holeCount,
    golfer: { character: RIVAL_CHARACTER, archetype: RIVAL_ARCHETYPE },
    scores,
    at: 0
  });
  return { shots: rec?.shots ?? [], scores };
}

export interface SynthesiseRivalOpts extends RivalRoundOpts {
  courseId: string;
  course: CourseData;
  holes: number;
  /** Rival identity. */
  name: string;
  seed: number;
  /** Target standard in strokes over par PER HOLE (negative = under par). */
  skill: number;
  dateKey: string;
  /** Epoch ms stamped on the recording. Passed in rather than read so this
   *  module stays pure and testable. */
  at: number;
}

/**
 * Produce the rival's round for a day. Returns null when nothing playable came
 * out of the search — the caller then simply has no rival round to show, which
 * is always better than showing a wrong one.
 */
export function synthesiseRivalRound(opts: SynthesiseRivalOpts): RoundRecording | null {
  const seed = rivalRoundSeed(opts.seed, opts.dateKey, opts.courseId);
  const holes = Math.min(opts.holes, opts.course.holes.length);
  if (holes <= 0) return null;
  const par = opts.course.holes.slice(0, holes).reduce((a, h) => a + h.par, 0);
  const target = par + opts.skill * holes;
  const golfer = rivalGolfer(opts.name);

  let best: { played: PlayedRound; miss: number } | null = null;
  for (const sigma of STEADINESS_LADDER) {
    const played = playRound(opts.course, seed, holes, golfer, { sigmaPower: sigma, sigmaAcc: sigma }, opts);
    if (!played.shots.length) continue;
    const total = played.scores.reduce((a, b) => a + b, 0);
    const miss = Math.abs(total - target);
    if (!best || miss < best.miss) best = { played, miss };
    // The ladder runs shakiest → steadiest, so scores fall as it advances.
    // Once the rival is beating the target there is nothing further to gain by
    // making them steadier still.
    if (total <= target) break;
  }
  if (!best) return null;

  return {
    v: 1,
    courseId: opts.courseId,
    seed,
    holes,
    golfer: { character: RIVAL_CHARACTER, archetype: RIVAL_ARCHETYPE },
    shots: best.played.shots,
    scores: best.played.scores,
    at: opts.at,
    name: opts.name
  };
}
