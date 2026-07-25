import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import sablebay from '../../src/data/courses/v2/sablebay.json';
import {
  calibrateRivalSkill,
  emptyRival,
  hasRival,
  houseRival,
  mergeRival,
  migrateRival,
  recalibrateRival,
  RivalState,
  rivalStanding,
  settleRivalDay
} from '../../src/systems/Rival';
import { rivalRoundSeed, synthesiseRivalRound } from '../../src/systems/RivalRound';
import { replayRound, ReplayOptions } from '../../src/systems/RoundReplay';
import { verifyRecording } from '../../src/systems/RoundVerify';
import { GhostRun } from '../../src/systems/GhostRun';

/**
 * The Rival.
 *
 * Two properties carry the whole feature:
 *
 *  1. the head-to-head is HONEST — a day counts exactly once, no matter how the
 *     round is replayed, resumed or synced. It is the only number the player is
 *     asked to care about, so it cannot be paddable;
 *  2. a house rival's round is REAL — it replays to the score it claims, which
 *     is what makes their ghost a golfer rather than a decoration.
 */

const course = loadCourse(sablebay as unknown as CourseAuthoring);
const courses = { sablebay: course };
const OPTS: ReplayOptions = { useAuthoredPins: true, bounded: true };

function armed(over: Partial<RivalState> = {}): RivalState {
  return { ...emptyRival(), id: 'house-7', name: 'Dana Vaughn', seed: 7, ...over };
}

describe('rival state', () => {
  it('is not armed until someone has been chosen', () => {
    expect(hasRival(emptyRival())).toBe(false);
    expect(hasRival(armed())).toBe(true);
  });

  it('settles a day exactly once, however many times it is reported', () => {
    // Replaying, resuming or a late sync must never pad the record — it is the
    // one number the feature asks the player to believe.
    let s = armed();
    const first = settleRivalDay(s, '2026-07-25', 3, 4);
    expect(first.result).toBe('win');
    s = first.state;
    const again = settleRivalDay(s, '2026-07-25', 2, 9);
    expect(again.result).toBeNull();
    expect(again.state.wins).toBe(1);
    expect(again.state.history).toHaveLength(1);
  });

  it('counts lower strokes as the win, and ties as ties', () => {
    expect(settleRivalDay(armed(), '2026-07-25', 3, 4).result).toBe('win');
    expect(settleRivalDay(armed(), '2026-07-25', 5, 4).result).toBe('loss');
    expect(settleRivalDay(armed(), '2026-07-25', 4, 4).result).toBe('tie');
  });

  it('ignores a nonsense or unarmed result rather than recording one', () => {
    expect(settleRivalDay(emptyRival(), '2026-07-25', 3, 4).result).toBeNull();
    expect(settleRivalDay(armed(), '2026-07-25', 0, 4).result).toBeNull();
    expect(settleRivalDay(armed(), '', 3, 4).result).toBeNull();
    expect(settleRivalDay(armed(), '2026-07-25', 3, Number.NaN).result).toBeNull();
  });

  it('keeps the history bounded — it is a form line, not a ledger', () => {
    let s = armed();
    for (let d = 1; d <= 30; d++) {
      s = settleRivalDay(s, `2026-06-${String(d).padStart(2, '0')}`, 3, 4).state;
    }
    expect(s.wins).toBe(30);
    expect(s.history.length).toBeLessThanOrEqual(14);
    // The newest day survives; the oldest does not.
    expect(s.history[s.history.length - 1].date).toBe('2026-06-30');
  });

  it('keeps the settled result, so a recalibration cannot rewrite the past', () => {
    // The card reads a settled day out of history rather than re-deriving it.
    // Without that, a sweep that moves the rival's standard would re-synthesise
    // today's round and report a score the player never played against.
    const s = settleRivalDay(armed(), '2026-07-25', 3, 5).state;
    const today = s.history.find((d) => d.date === '2026-07-25')!;
    expect(today.them).toBe(5);
    expect(recalibrateRival({ ...s, skill: 1 }).history).toEqual(s.history);
  });

  it('reads the standing from the player point of view', () => {
    expect(rivalStanding(armed()).label).toBe('First round against Dana Vaughn');
    expect(rivalStanding(armed({ wins: 12, losses: 9 })).label).toBe('You lead 12–9');
    expect(rivalStanding(armed({ wins: 9, losses: 12 })).label).toBe('Dana Vaughn leads 12–9');
    expect(rivalStanding(armed({ wins: 4, losses: 4 })).label).toBe('All square 4–4');
  });

  it('survives corrupt storage without inventing a rivalry', () => {
    expect(hasRival(migrateRival(null))).toBe(false);
    expect(hasRival(migrateRival('nope'))).toBe(false);
    const clamped = migrateRival({ id: 'x', name: 'Y', wins: -5, skill: 99, history: [{ date: 'd' }] });
    expect(clamped.wins).toBe(0);
    expect(clamped.skill).toBeLessThanOrEqual(6);
    expect(clamped.history).toEqual([]);
  });

  it('merges two devices without double-counting a day', () => {
    const a = settleRivalDay(armed(), '2026-07-24', 3, 4).state;
    const b = settleRivalDay(armed(), '2026-07-24', 3, 4).state;
    const m = mergeRival(a, b);
    expect(m.wins).toBe(1);
    expect(m.history).toHaveLength(1);
  });

  it('refuses to blend two different rivals', () => {
    // Two devices pointed at different people is not a mergeable state; the
    // more recently active relationship wins outright rather than producing a
    // record that belongs to nobody.
    const a = settleRivalDay(armed({ id: 'house-1', name: 'A' }), '2026-07-24', 3, 4).state;
    const b = settleRivalDay(armed({ id: 'house-2', name: 'B' }), '2026-07-25', 3, 4).state;
    expect(mergeRival(a, b).id).toBe('house-2');
  });
});

describe('rival calibration', () => {
  it('aims just out of reach — and no further', () => {
    // A rival who wins every day is a wall; one who never wins is furniture.
    // Half a stroke a hole better than recent form is the beatable gap.
    expect(calibrateRivalSkill([2, 2, 2])).toBe(1.5);
    expect(calibrateRivalSkill([0, 0])).toBe(-0.5);
    // No history at all → level par, a fair opening assumption.
    expect(calibrateRivalSkill([])).toBe(0);
    // Clamped at both ends so the rival stays a golfer.
    expect(calibrateRivalSkill([9, 9, 9])).toBe(2);
    expect(calibrateRivalSkill([-9, -9])).toBe(-1);
  });

  it('drifts the standard only on a clean sweep, and only for a house rival', () => {
    // A good rivalry must be left alone. The dial exists for the two failure
    // modes — a rival who is furniture, and one who is a wall.
    const sweep = (you: number, them: number): RivalState => {
      let s = armed();
      for (let d = 1; d <= 3; d++) s = settleRivalDay(s, `2026-07-0${d}`, you, them).state;
      return s;
    };
    // Player wins three straight → the rival gets better (lower target).
    expect(recalibrateRival(sweep(3, 5)).skill).toBe(-0.25);
    // Player loses three straight → the rival eases off.
    expect(recalibrateRival(sweep(5, 3)).skill).toBe(0.25);

    // A mixed window is a good rivalry — untouched.
    let mixed = armed();
    mixed = settleRivalDay(mixed, '2026-07-01', 3, 5).state;
    mixed = settleRivalDay(mixed, '2026-07-02', 5, 3).state;
    mixed = settleRivalDay(mixed, '2026-07-03', 3, 5).state;
    expect(recalibrateRival(mixed).skill).toBe(0);

    // Too little history to read form yet.
    const young = settleRivalDay(armed(), '2026-07-01', 3, 5).state;
    expect(recalibrateRival(young).skill).toBe(0);

    // A friend's standard is whatever they actually shot — never adjusted.
    const friend = { ...sweep(3, 5), kind: 'friend' as const };
    expect(recalibrateRival(friend).skill).toBe(0);
  });

  it('never drifts past the band that keeps them a golfer', () => {
    let s = armed({ skill: -1 });
    for (let d = 1; d <= 3; d++) s = settleRivalDay(s, `2026-07-0${d}`, 2, 9).state;
    expect(recalibrateRival(s).skill).toBe(-1);
  });

  it('gives the same seed the same person, every time', () => {
    expect(houseRival(12345, 0)).toEqual(houseRival(12345, 0));
    expect(houseRival(12345, 0).name).not.toBe(houseRival(999, 0).name);
    expect(houseRival(12345, 0).name).toMatch(/^\S+ \S+$/);
  });
});

describe('a house rival plays a real round', () => {
  const base = {
    courseId: 'sablebay',
    course,
    holes: 3,
    name: 'Dana Vaughn',
    seed: 4242,
    dateKey: '2026-07-25',
    at: 1_700_000_000_000,
    ...OPTS
  };

  it('replays to the score it claims — the ghost is a golfer, not a number', () => {
    // This is the property that separates a rival from a target score. If the
    // recording did not replay, the ball flying next to the player would be
    // going somewhere the rival never hit it.
    const rec = synthesiseRivalRound({ ...base, skill: 0 })!;
    expect(rec).toBeTruthy();
    expect(rec.shots.length).toBeGreaterThan(0);
    expect(verifyRecording(rec, courses, OPTS).status).toBe('verified');
  });

  it('is raceable as a ghost with a shot to fly on every hole', () => {
    const rec = synthesiseRivalRound({ ...base, skill: 0 })!;
    const ghost = new GhostRun(rec, course, OPTS);
    expect(ghost.ok).toBe(true);
    expect(ghost.name).toBe('Dana Vaughn');
    for (let h = 0; h < 3; h++) {
      expect(ghost.shotCount(h), `hole ${h + 1}`).toBeGreaterThan(0);
      expect(ghost.shot(h, 0)!.path.length).toBeGreaterThan(1);
    }
  });

  it('is the same round on every device and every launch', () => {
    const a = synthesiseRivalRound({ ...base, skill: 0 })!;
    const b = synthesiseRivalRound({ ...base, skill: 0 })!;
    expect(b.shots).toEqual(a.shots);
    expect(b.scores).toEqual(a.scores);
  });

  it('plays a different round tomorrow, and a different one for another rival', () => {
    const today = synthesiseRivalRound({ ...base, skill: 0 })!;
    const tomorrow = synthesiseRivalRound({ ...base, skill: 0, dateKey: '2026-07-26' })!;
    const someoneElse = synthesiseRivalRound({ ...base, skill: 0, seed: 99 })!;
    expect(tomorrow.seed).not.toBe(today.seed);
    expect(someoneElse.seed).not.toBe(today.seed);
  });

  it('a harder target really does produce a better round', () => {
    // The calibration has to bite, or "skill" is decoration. A rival asked for
    // level par must not shoot the same score as one asked for two over.
    const level = synthesiseRivalRound({ ...base, skill: 0 })!;
    const loose = synthesiseRivalRound({ ...base, skill: 2 })!;
    const total = (r: { scores: number[] }): number => r.scores.reduce((a, b) => a + b, 0);
    expect(total(level)).toBeLessThanOrEqual(total(loose));
  });

  it('lands near the standard it was asked for', () => {
    const par = course.holes.slice(0, 3).reduce((a, h) => a + h.par, 0);
    for (const skill of [0, 1, 2]) {
      const rec = synthesiseRivalRound({ ...base, skill })!;
      const total = rec.scores.reduce((a, b) => a + b, 0);
      const target = par + skill * 3;
      // Within a stroke a hole of the target. A rival is a person having a
      // round, not a metronome — but they must be recognisably the standard
      // they were built to be.
      expect(Math.abs(total - target), `skill ${skill}: shot ${total}, wanted ${target}`).toBeLessThanOrEqual(3);
    }
  });

  it('mixes the seed so adjacent days are not adjacent rounds', () => {
    const a = rivalRoundSeed(7, '2026-07-25', 'sablebay');
    const b = rivalRoundSeed(7, '2026-07-26', 'sablebay');
    expect(Math.abs(a - b)).toBeGreaterThan(1000);
  });

  it('refuses a course with no holes rather than producing an empty rival', () => {
    expect(synthesiseRivalRound({ ...base, skill: 0, course: { ...course, holes: [] }, holes: 0 })).toBeNull();
  });
});

describe('a rival round is a recording like any other', () => {
  it('replays identically twice — the ghost never re-rolls mid-rivalry', () => {
    const rec = synthesiseRivalRound({
      courseId: 'sablebay',
      course,
      holes: 1,
      name: 'Dana Vaughn',
      seed: 4242,
      skill: 0,
      dateKey: '2026-07-25',
      at: 1_700_000_000_000,
      ...OPTS
    })!;
    const a = replayRound(rec, course, OPTS);
    const b = replayRound(rec, course, OPTS);
    expect(a.ok).toBe(true);
    expect(b.scores).toEqual(a.scores);
    expect(b.holes[0].shots[0].path).toEqual(a.holes[0].shots[0].path);
  });
});
