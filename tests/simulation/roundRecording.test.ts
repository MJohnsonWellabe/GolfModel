import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import sablebay from '../../src/data/courses/v2/sablebay.json';
import { isValidRecording, RoundRecorder, RoundRecording, ShotInput } from '../../src/systems/RoundRecording';
import { replayRound, ReplayOptions } from '../../src/systems/RoundReplay';
import { verifyRecording } from '../../src/systems/RoundVerify';
import { GhostRun, standingLabel } from '../../src/systems/GhostRun';
import { clearRecordings, loadRecordings, saveRecording, bestRecordingFor } from '../../src/systems/RecordingStore';
import { conditionsForRound, shotRngSeed, windForSeed } from '../../src/systems/RoundConditions';
import { PHYSICS, PX_PER_YARD, RULES } from '../../src/config';
import { AIController } from '../../src/systems/AIController';
import { FireSystem } from '../../src/systems/FireSystem';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { buildHeightField } from '../../src/systems/HeightField';
import { withPlayableBoundary } from '../../src/systems/PlayableBoundary';
import { applyTeeVariants } from '../../src/systems/Layouts';
import { assembleGolfer } from '../../src/data/golfers';
import { mulberry32 } from '../../src/utils/Random';
import type { Surface } from '../../src/core/types';

/**
 * The recording stack: rounds stored as INPUTS, replayed through the real
 * physics, and checked against the score they claim.
 *
 * The property that matters is not "the numbers look right" — it is that the
 * replay is a FUNCTION of the recording. Two replays of the same recording must
 * agree exactly, or verification would randomly reject honest rounds and ghosts
 * would fly somewhere their owner never hit the ball.
 */

const course = loadCourse(sablebay as unknown as CourseAuthoring);
const courses = { sablebay: course };
const OPTS: ReplayOptions = { useAuthoredPins: true, bounded: true };

function shot(over: Partial<ShotInput> = {}): ShotInput {
  return {
    h: 0,
    a: 0.1,
    c: 'driver',
    p: 0.9,
    pq: 'perfect',
    ac: 0,
    aq: 'perfect',
    ss: 0,
    st: 0,
    lm: 1,
    rm: 1,
    ...over
  };
}

/**
 * Build an HONEST recording by actually playing the round: drive the shared
 * AIController through each hole with the round's real conditions, recording
 * every decision as a `ShotInput`. This is a much better fixture than
 * hand-written numbers — it produces a round that genuinely holes out, and it
 * proves the recording format can express real play rather than just parse.
 */
function playRecording(seed: number, holes = 1, gentlePins = false): RoundRecording {
  const recorder = new RoundRecorder();
  recorder.start();
  const golfer = assembleGolfer('Tester', 'chip', 'bigHitter');
  // The live round materialises this seed's alternate tees before playing
  // (playHole → applyTeeVariants), and so does the replay — so a fixture that
  // skipped it would tee off somewhere the replay never looks.
  const teed = applyTeeVariants(course, seed);
  const conditions = conditionsForRound(teed, seed, holes, {
    useAuthoredPins: OPTS.useAuthoredPins,
    gentlePins,
    maxWind: PHYSICS.maxWind
  });
  const scores: number[] = [];
  const fire = new FireSystem();

  for (let h = 0; h < holes; h++) {
    const hole = withPlayableBoundary({ ...teed.holes[h], pin: conditions.pins[h] }, OPTS.bounded);
    // Seed the engine's one random branch (a putt lipping out) exactly as the
    // live round and the replay do, or a fixture containing one would not
    // reproduce — and the test would be measuring the fixture, not the replay.
    let shotRng: () => number = mulberry32(shotRngSeed(seed, h, 0));
    const engine = new PhysicsEngine(hole, buildHeightField(hole, 1, 0), () => shotRng(), OPTS.treeSpecies);
    const ai = new AIController(golfer, fire, engine, () => 0.5);
    const wind = conditions.winds[h];
    let ball = { ...hole.tee };
    let lie: Surface = 'tee';
    let strokes = 0;

    for (let i = 0; i < RULES.maxStrokes; i++) {
      // Mirrors the live gimme: a resting ball inside the radius is conceded.
      if (lie === 'green' && (Math.hypot(ball.x - hole.pin.x, ball.y - hole.pin.y) / PX_PER_YARD) * 3 <= 3) {
        strokes += 1;
        break;
      }
      shotRng = mulberry32(shotRngSeed(seed, h, strokes));
      const d = ai.decide(ball, lie, wind, hole);
      recorder.add({
        h,
        a: d.aimAngle,
        c: d.club.id,
        p: d.swing.power,
        pq: d.swing.powerQuality,
        ac: d.swing.accuracy,
        aq: d.swing.accuracyQuality,
        ss: d.spin?.side ?? 0,
        st: d.spin?.top ?? 0,
        lm: 1,
        rm: 1
      });
      const fireBoost = fire.statBoost;
      const launch = engine.resolveLaunch({
        origin: ball,
        aimAngle: d.aimAngle,
        swing: d.swing,
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
      fire.recordSwing(d.swing);
      strokes += 1 + (outcome.waterPenalty ? 1 : 0) + (outcome.obPenalty ? 1 : 0);
      ball = outcome.finalPos;
      lie = outcome.surface;
      if (outcome.holed) break;
    }
    scores.push(strokes);
  }

  return recorder.finish({
    courseId: 'sablebay',
    seed,
    holes,
    golfer: { character: 'chip', archetype: 'bigHitter' },
    scores,
    at: 1_700_000_000_000,
    name: 'Tester',
    gentlePins
  })!;
}

describe('round recording', () => {
  it('records only what the human chose', () => {
    const r = new RoundRecorder();
    r.start();
    r.add(shot());
    const out = r.finish({
      courseId: 'sablebay',
      seed: 1,
      holes: 1,
      golfer: { character: 'chip', archetype: 'bigHitter' },
      scores: [4],
      at: 1
    })!;
    expect(Object.keys(out.shots[0]).sort()).toEqual(
      ['a', 'ac', 'aq', 'c', 'h', 'lm', 'p', 'pq', 'rm', 'ss', 'st'].sort()
    );
  });

  it('ignores shots when not recording (a stopped recorder is inert)', () => {
    const r = new RoundRecorder();
    r.add(shot());
    expect(r.shotCount()).toBe(0);
    expect(r.finish({ courseId: 'x', seed: 1, holes: 1, golfer: { character: 'c', archetype: 'a' }, scores: [1], at: 1 })).toBeNull();
  });

  it('keeps only the last in-flight swipe, with the step it was made on', () => {
    const r = new RoundRecorder();
    r.start();
    r.add(shot());
    r.setFlightSpin(0.5, 0.2, 10);
    r.setFlightSpin(-0.3, 0.8, 25);
    const out = r.finish({ courseId: 'sablebay', seed: 1, holes: 1, golfer: { character: 'chip', archetype: 'bigHitter' }, scores: [4], at: 1 })!;
    expect(out.shots[0].fs).toBe(-0.3);
    expect(out.shots[0].ft).toBe(0.8);
    expect(out.shots[0].fst).toBe(25);
  });

  it('rejects structurally impossible recordings before they reach the physics', () => {
    const good = playRecording(4242);
    expect(isValidRecording(good)).toBe(true);
    expect(isValidRecording({ ...good, v: 99 })).toBe(false);
    expect(isValidRecording({ ...good, seed: NaN })).toBe(false);
    expect(isValidRecording({ ...good, shots: [] })).toBe(false);
    expect(isValidRecording({ ...good, scores: [] })).toBe(false);
    // Out-of-range power is the obvious tamper — a 10x swing.
    expect(isValidRecording({ ...good, shots: [shot({ p: 10 })] })).toBe(false);
    expect(isValidRecording({ ...good, shots: [shot({ pq: 'amazing' as never })] })).toBe(false);
  });
});

describe('round replay', () => {
  it('is a function of the recording — two replays agree exactly', () => {
    const rec = playRecording(90210);
    const a = replayRound(rec, course, OPTS);
    const b = replayRound(rec, course, OPTS);
    expect(a.ok).toBe(true);
    expect(a.scores).toEqual(b.scores);
    // Trajectories must match sample for sample; a ghost is drawn from these.
    expect(a.holes[0].shots[0].path.length).toBe(b.holes[0].shots[0].path.length);
    expect(a.holes[0].shots[0].finalPos).toEqual(b.holes[0].shots[0].finalPos);
  });

  it('a different seed is a different round (conditions really are applied)', () => {
    const base = playRecording(1);
    const other = replayRound({ ...base, seed: 2 }, course, OPTS);
    const mine = replayRound(base, course, OPTS);
    expect(other.ok && mine.ok).toBe(true);
    // Same inputs, different wind and pin — the ball cannot finish in the same
    // place. (If this ever ties, the conditions are not reaching the physics.)
    expect(other.holes[0].shots[0].finalPos).not.toEqual(mine.holes[0].shots[0].finalPos);
  });

  it('refuses a recording that keeps playing after holing out', () => {
    const rec = playRecording(4242);
    // Force an impossible continuation: many putts on a hole already finished.
    const stuffed: RoundRecording = {
      ...rec,
      shots: [...rec.shots, ...rec.shots.map((s) => ({ ...s }))]
    };
    const replay = replayRound(stuffed, course, OPTS);
    // Either it is rejected outright, or the extra strokes show up in the score
    // — what must NOT happen is the claimed score surviving untouched.
    if (replay.ok) expect(replay.total).toBeGreaterThan(rec.scores.reduce((a, b) => a + b, 0));
    else expect(replay.reason).toContain('holed');
  });
});

describe('ease-in pins round-trip', () => {
  // The ease-in pass plays a device's first casual rounds to the KINDEST cup on
  // each green instead of the seeded one. That is the only condition in a round
  // that is not derivable from the seed, so it has to travel with the recording
  // — otherwise the replay plays the round into a different hole and rejects an
  // honest score. The seed below is one where the two choices genuinely differ.
  const SEED = 1234567;

  it('the gentle pin is really a different cup (this test would be vacuous otherwise)', () => {
    const opts = { useAuthoredPins: true, maxWind: PHYSICS.maxWind };
    const seeded = conditionsForRound(course, SEED, 3, opts);
    const gentle = conditionsForRound(course, SEED, 3, { ...opts, gentlePins: true });
    expect(gentle.pins).not.toEqual(seeded.pins);
  });

  it('records the choice and replays to the score that was played', () => {
    const rec = playRecording(SEED, 3, true);
    expect(rec.gp).toBe(true);
    expect(verifyRecording(rec, courses, OPTS).status).toBe('verified');
  });

  it('a replay that ignores the choice plays a different round', () => {
    // Strip the flag exactly as an older client would have written it. The
    // replay then draws the seeded pin, and the score it produces is not the
    // score that was played — which is precisely the failure mode the field
    // exists to prevent.
    const rec = playRecording(SEED, 3, true);
    const { gp: _gp, ...blind } = rec;
    expect(verifyRecording(blind as RoundRecording, courses, OPTS).status).not.toBe('verified');
  });

  it('an ease-in round is not offered as a ghost', () => {
    // It replays perfectly — but a ghost race uses the SEEDED pins, so racing it
    // would mean racing a score set on an easier course.
    const gentle = new GhostRun(playRecording(SEED, 1, true), course, OPTS);
    expect(gentle.ok).toBe(false);
    expect(gentle.reason).toMatch(/ease-in/);
    expect(new GhostRun(playRecording(SEED, 1, false), course, OPTS).ok).toBe(true);
  });
});

describe('score verification', () => {
  it('verifies a round that really was played', () => {
    const rec = playRecording(777);
    const res = verifyRecording(rec, courses, OPTS);
    expect(res.status).toBe('verified');
    expect(res.ok).toBe(true);
    expect(res.actualTotal).toBe(res.claimedTotal);
  });

  it('catches the only cheat anyone actually performs — editing the score', () => {
    const rec = playRecording(777);
    const tampered = { ...rec, scores: rec.scores.map(() => 1) };
    const res = verifyRecording(tampered, courses, OPTS);
    expect(res.ok).toBe(false);
    expect(res.status).toBe('score-mismatch');
    expect(res.actualTotal).toBeGreaterThan(res.claimedTotal);
  });

  it('rejects malformed and unknown-course submissions without touching physics', () => {
    expect(verifyRecording(null, courses, OPTS).status).toBe('malformed');
    expect(verifyRecording({ nope: true }, courses, OPTS).status).toBe('malformed');
    const rec = playRecording(5);
    expect(verifyRecording({ ...rec, courseId: 'atlantis' }, courses, OPTS).status).toBe('unknown-course');
  });
});

describe('ghost run', () => {
  it('exposes the opponent shot for the hole and shot number being played', () => {
    const rec = playRecording(31337);
    const ghost = new GhostRun(rec, course, OPTS);
    expect(ghost.ok).toBe(true);
    expect(ghost.shotCount(0)).toBeGreaterThan(0);
    expect(ghost.shot(0, 0)?.path.length).toBeGreaterThan(1);
    // Nothing left to show once the ghost has holed out.
    expect(ghost.shot(0, 99)).toBeNull();
  });

  it('compares like for like — an unplayed hole never counts against you', () => {
    const rec = playRecording(31337, 1);
    const ghost = new GhostRun(rec, course, OPTS);
    // Standing on the first shot of hole 1: the ghost's completed hole must not
    // be charged in full against a player who has taken one stroke.
    const st = ghost.standing([], 0, 1, 0);
    expect(st.you).toBe(1);
    expect(st.ghost).toBe(1);
    expect(st.label).toBe('All square');
  });

  it('reads the standing from the player point of view', () => {
    expect(standingLabel(0)).toBe('All square');
    expect(standingLabel(1)).toBe('You lead by 1 shot');
    expect(standingLabel(-2)).toBe('Down by 2 shots');
  });
});

describe('recording store', () => {
  function mem(): Record<string, string> & { getItem: (k: string) => string | null } {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k)
    } as never;
  }

  it('keeps the best round per course and refuses a worse one', () => {
    const s = mem() as never;
    const good = playRecording(1);
    const better = { ...good, scores: good.scores.map((v) => Math.max(1, v - 1)) };
    expect(saveRecording(good, s)).toBe(true);
    expect(saveRecording(better, s)).toBe(true);
    expect(saveRecording(good, s)).toBe(false); // worse — not stored
    expect(loadRecordings(s)).toHaveLength(1);
    expect(bestRecordingFor('sablebay', good.holes, s)?.scores).toEqual(better.scores);
  });

  it('never offers an ease-in round as the one to beat', () => {
    // It would set the bar on an easier course than the player is about to
    // play, so it is stored but never surfaced as an opponent.
    const s = mem() as never;
    const gentle = playRecording(1, 1, true);
    expect(saveRecording(gentle, s)).toBe(true);
    expect(loadRecordings(s)).toHaveLength(1);
    expect(bestRecordingFor('sablebay', gentle.holes, s)).toBeNull();
  });

  it('reads corrupt storage as an empty library', () => {
    const s = mem() as never;
    (s as unknown as { setItem: (k: string, v: string) => void }).setItem('bsg.recordings.v1', 'not json');
    expect(loadRecordings(s)).toEqual([]);
    clearRecordings(s);
  });
});

describe('round conditions', () => {
  it('are a pure function of the seed (the whole replay rests on this)', () => {
    const a = windForSeed(12345, 1, 2, PHYSICS.maxWind);
    const b = windForSeed(12345, 1, 2, PHYSICS.maxWind);
    expect(a).toEqual(b);
    expect(windForSeed(12346, 1, 2, PHYSICS.maxWind)).not.toEqual(a);
  });

  it('produce one wind and one pin per hole played', () => {
    const c = conditionsForRound(course, 42, 3, { useAuthoredPins: true, maxWind: PHYSICS.maxWind });
    expect(c.winds).toHaveLength(3);
    expect(c.pins).toHaveLength(3);
  });
});
