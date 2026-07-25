/**
 * Replays a `RoundRecording` through the real physics.
 *
 * ONE implementation, three consumers:
 *
 *   - `RoundVerify` asks "does this recording actually produce the score it
 *     claims?" — the thing that turns a leaderboard from an honour system into
 *     a fact.
 *   - Ghost head-to-head asks for the trajectories, so an opponent's shots can
 *     be drawn beside the player's.
 *   - Round replay / highlights ask for the same trajectories.
 *
 * They must never diverge, because a ghost that flies somewhere the verifier
 * did not see would be a bug nobody could reproduce. Hence one function.
 *
 * FAITHFULNESS TO THE LIVE ROUND
 * ------------------------------
 * The stroke accounting here mirrors `HoleScene.executeShot` exactly:
 *
 *   - one stroke per shot, plus one for a water penalty, plus one for an
 *     out-of-bounds penalty;
 *   - the Fire streak is fed AFTER each shot resolves and its boost is read
 *     BEFORE the next one (the live ordering — get this backwards and a
 *     legend-tier round drifts by a stroke or two);
 *   - a ball at rest on the green inside the gimme radius is conceded as one
 *     tap-in, exactly as `tryGimme` does at the start of every turn.
 *
 * Pure and Babylon-free, so it runs in the browser, in vitest, and in a Cloud
 * Function without change.
 */

import { assembleGolfer } from '../data/golfers';
import { perkById } from '../data/perks';
import { buildHeightField } from './HeightField';
import { FireSystem } from './FireSystem';
import { PhysicsEngine } from './PhysicsEngine';
import { withPlayableBoundary } from './PlayableBoundary';
import { applyTeeVariants } from './Layouts';
import { conditionsForRound, shotRngSeed } from './RoundConditions';
import { isValidRecording, RoundRecording } from './RoundRecording';
import { PHYSICS, PX_PER_YARD, RULES } from '../config';
import { mulberry32 } from '../utils/Random';
import type { CharacterKey } from '../data/characters';
import type { ArchetypeId } from '../data/archetypes';
import type { ClubSpec, CourseData, Point, Surface, TrajectoryPoint } from '../core/types';
import { CLUBS } from '../data/clubs';

/** Feet inside which a resting ball on the green is conceded (HoleScene). */
const GIMME_FEET = 3;

export interface ReplayedShot {
  holeIdx: number;
  origin: Point;
  lie: Surface;
  clubId: string;
  path: TrajectoryPoint[];
  finalPos: Point;
  holed: boolean;
  waterPenalty: boolean;
  obPenalty: boolean;
}

export interface ReplayedHole {
  holeIdx: number;
  strokes: number;
  holed: boolean;
  /** True when the hole ended by concession rather than by holing out. */
  conceded: boolean;
  /** True when the hole ended at the stroke cap — the live round's "Pick up —
   *  max N" (RULES.maxStrokes). A picked-up hole is FINISHED; treating it as
   *  unfinished would reject every honest round that contained a disaster. */
  pickedUp: boolean;
  shots: ReplayedShot[];
}

export interface ReplayResult {
  ok: boolean;
  /** Populated when ok is false — why the recording could not be replayed. */
  reason?: string;
  holes: ReplayedHole[];
  total: number;
  scores: number[];
}

export interface ReplayOptions {
  /** Mirrors the `layouts` feature flag for pin selection. */
  useAuthoredPins: boolean;
  /** Mirrors the `boundedWorld` feature flag. */
  bounded: boolean;
  bunkerDepthScale?: number;
  wasteDepthScale?: number;
  edgeWobble?: number;
  treeSpecies?: ConstructorParameters<typeof PhysicsEngine>[3];
}

function clubById(id: string): ClubSpec | undefined {
  return CLUBS.find((c) => c.id === id);
}

/**
 * Replay every recorded shot. Returns the per-hole outcome and the score the
 * inputs ACTUALLY produce — which is the number a verifier compares against the
 * claimed score, and the trajectories a ghost draws.
 */
export function replayRound(
  rec: RoundRecording,
  course: CourseData,
  opts: ReplayOptions
): ReplayResult {
  if (!isValidRecording(rec)) {
    return { ok: false, reason: 'malformed recording', holes: [], total: 0, scores: [] };
  }
  // TEE VARIANTS: the live round materialises this seed's alternate tees before
  // playing (`playHole` → applyTeeVariants, under the `layouts` flag). Skipping
  // that here made every replayed round start from the AUTHORED tee — so the
  // very first shot landed somewhere the player never hit it, and no honest
  // round could ever verify. Same flag, same seed, same function.
  const teed = opts.useAuthoredPins ? applyTeeVariants(course, rec.seed) : course;
  const holeCount = Math.min(rec.holes, teed.holes.length);
  const conditions = conditionsForRound(teed, rec.seed, holeCount, {
    useAuthoredPins: opts.useAuthoredPins,
    bunkerDepthScale: opts.bunkerDepthScale,
    wasteDepthScale: opts.wasteDepthScale,
    // EASE-IN PINS: a device's first casual rounds are played to the kindest
    // authored cup rather than the seeded one. That choice is not derivable from
    // the seed, so the recording carries it; without this the replay plays the
    // round into a different hole than the player did.
    gentlePins: rec.gp === true,
    maxWind: PHYSICS.maxWind
  });
  const golfer = assembleGolfer(
    rec.name || 'Player',
    rec.golfer.character as CharacterKey,
    rec.golfer.archetype as ArchetypeId,
    rec.golfer.upgrades ?? {},
    // A perk raises stats and widens the perfect zone. Omitting it assembles a
    // weaker golfer than the one that played, so the round does not reproduce.
    perkById(rec.pk)
  );

  const holes: ReplayedHole[] = [];
  const scores: number[] = [];
  // Fire carries ACROSS holes in a live round, so one instance spans the replay.
  const fire = new FireSystem();

  for (let h = 0; h < holeCount; h++) {
    const base = teed.holes[h];
    // The pin is seeded per round, so the hole the ball is played into is the
    // authored hole with this round's cup — not the authored cup.
    const hole = withPlayableBoundary({ ...base, pin: conditions.pins[h] }, opts.bounded);
    // The engine's one random branch (a putt lipping out) is seeded per shot
    // from the round seed, hole and stroke number — exactly as the live round
    // seeds it (RoundConditions.shotRngSeed). Without this, an honest round
    // containing a lip-out would replay differently and fail verification.
    let shotRng: () => number = mulberry32(shotRngSeed(rec.seed, h, 0));
    const engine = new PhysicsEngine(
      hole,
      buildHeightField(hole, opts.bunkerDepthScale ?? 1, opts.wasteDepthScale ?? 0),
      () => shotRng(),
      opts.treeSpecies,
      opts.edgeWobble ?? 1
    );
    const wind = conditions.winds[h];
    const shots = rec.shots.filter((s) => s.h === h);

    let ball: Point = { ...hole.tee };
    let lie: Surface = 'tee';
    let strokes = 0;
    let holed = false;
    let conceded = false;
    let pickedUp = false;
    const played: ReplayedShot[] = [];

    for (const shot of shots) {
      if (holed) return fail(`hole ${h + 1}: shot recorded after the ball was holed`);
      // Gimme: the live round concedes before the player can play again, so a
      // recording cannot contain a shot from inside the radius.
      if (isGimme(ball, hole.pin, lie)) {
        strokes += 1;
        holed = true;
        conceded = true;
        break;
      }
      const club = clubById(shot.c);
      if (!club) return fail(`hole ${h + 1}: unknown club "${shot.c}"`);

      shotRng = mulberry32(shotRngSeed(rec.seed, h, strokes));
      const fireBoost = fire.statBoost;
      const launch = engine.resolveLaunch({
        origin: ball,
        aimAngle: shot.a,
        swing: { power: shot.p, powerQuality: shot.pq, accuracy: shot.ac, accuracyQuality: shot.aq },
        club,
        golfer,
        fireBoost,
        lie,
        wind,
        hole,
        spin: { side: shot.ss, top: shot.st },
        launchMult: shot.lm,
        riskMult: shot.rm,
        stroke: strokes
      });
      // Mirrors executeShot exactly: the ball launches with the PRE-SHOT shape
      // only (side spin rides on the launch itself, the live spin channel starts
      // with just top spin), and an in-flight swipe re-integrates the same
      // launch with the new spin applied from the step it was made on.
      const swiped = shot.fs !== undefined || shot.ft !== undefined;
      const outcome = swiped
        ? engine.integrateLaunch(
            launch,
            { side: shot.fs ?? 0, top: shot.ft ?? shot.st },
            Math.max(0, Math.floor(shot.fst ?? 0))
          )
        : engine.integrateLaunch(launch, { side: 0, top: shot.st }, 0);
      fire.recordSwing({
        power: shot.p,
        powerQuality: shot.pq,
        accuracy: shot.ac,
        accuracyQuality: shot.aq
      });

      strokes += 1 + (outcome.waterPenalty ? 1 : 0) + (outcome.obPenalty ? 1 : 0);
      played.push({
        holeIdx: h,
        origin: { ...ball },
        lie,
        clubId: shot.c,
        path: outcome.path,
        finalPos: outcome.finalPos,
        holed: outcome.holed,
        waterPenalty: outcome.waterPenalty,
        obPenalty: outcome.obPenalty
      });
      ball = outcome.finalPos;
      lie = outcome.surface;
      holed = outcome.holed;
      if (strokes >= RULES.maxStrokes) break;
    }

    // A hole that ran out of recorded shots without the ball going in, and
    // without a concession, did not finish — the recording is incomplete.
    if (!holed && isGimme(ball, hole.pin, lie)) {
      strokes += 1;
      holed = true;
      conceded = true;
    }
    // The live round makes the player pick up at the stroke cap
    // (HoleScene.afterShot, "Pick up — max N"). That hole is over and its score
    // stands, so the replay has to end it the same way — otherwise any round
    // containing a blow-up hole fails verification.
    if (!holed && strokes >= RULES.maxStrokes) pickedUp = true;
    holes.push({ holeIdx: h, strokes, holed, conceded, pickedUp, shots: played });
    scores.push(strokes);
  }

  return {
    ok: true,
    holes,
    scores,
    total: scores.reduce((a, b) => a + b, 0)
  };

  function fail(reason: string): ReplayResult {
    return { ok: false, reason, holes, total: 0, scores };
  }
}

function isGimme(ball: Point, pin: Point, lie: Surface): boolean {
  if (lie !== 'green') return false;
  const feet = (Math.hypot(ball.x - pin.x, ball.y - pin.y) / PX_PER_YARD) * 3;
  return feet <= GIMME_FEET;
}
