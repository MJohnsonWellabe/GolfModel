import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import wildwood from '../../src/data/courses/wildwood.json';
import sablebay from '../../src/data/courses/sablebay.json';
import timberline from '../../src/data/courses/timberline.json';
import portjohnson from '../../src/data/courses/portjohnson.json';
import { OPPONENTS } from '../../src/data/opponents';
import {
  AI_TOUR_ROUNDS,
  completeRound,
  createAiTournament,
  isFinal,
  pickTournamentCourses,
  purseFor,
  standings
} from '../../src/systems/AiTournament';
import { CourseData } from '../../src/core/types';

const COURSES: Record<string, CourseData> = {
  wildwood: loadCourse(wildwood as unknown as CourseAuthoring),
  sablebay: loadCourse(sablebay as unknown as CourseAuthoring),
  timberline: loadCourse(timberline as unknown as CourseAuthoring),
  portjohnson: loadCourse(portjohnson as unknown as CourseAuthoring)
};
const IDS = Object.keys(COURSES);

describe('AI tournament', () => {
  it('draws three distinct courses, deterministically per seed', () => {
    for (const seed of [1, 7, 42, 999]) {
      const rota = pickTournamentCourses(IDS, seed);
      expect(rota).toHaveLength(AI_TOUR_ROUNDS);
      expect(new Set(rota).size).toBe(AI_TOUR_ROUNDS);
      expect(pickTournamentCourses(IDS, seed)).toEqual(rota); // replayable
      rota.forEach((id) => expect(IDS).toContain(id));
    }
  });

  it('simulates the whole field each round and fills the leaderboard', () => {
    const t = createAiTournament(IDS, OPPONENTS, 12345);
    expect(t.field).toHaveLength(OPPONENTS.length);
    completeRound(t, COURSES, 12, 1); // player shoots +1
    expect(t.played).toBe(1);
    expect(isFinal(t)).toBe(false);
    for (const e of t.field) {
      expect(e.rounds).toHaveLength(1);
      // A real simulated score: positive strokes, sane range for 3 holes.
      expect(e.rounds[0]).toBeGreaterThanOrEqual(3);
      expect(e.rounds[0]).toBeLessThanOrEqual(30);
    }
    const rows = standings(t);
    expect(rows).toHaveLength(OPPONENTS.length + 1);
    // Sorted by cumulative to-par.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].toPar).toBeGreaterThanOrEqual(rows[i - 1].toPar);
    }
    expect(rows.some((r) => r.isPlayer)).toBe(true);
  });

  it('field scores are fixed by the tournament seed (no rerolls)', () => {
    const a = createAiTournament(IDS, OPPONENTS, 777);
    const b = createAiTournament(IDS, OPPONENTS, 777);
    completeRound(a, COURSES, 10, -1);
    completeRound(b, COURSES, 14, 3); // different player score, same seed
    expect(a.field.map((e) => e.rounds[0])).toEqual(b.field.map((e) => e.rounds[0]));
  });

  it('runs to a final after three rounds and ranks a runaway winner first', () => {
    const t = createAiTournament(IDS, OPPONENTS, 2024);
    // The player birdies everything — impossibly good, must top the board.
    for (let r = 0; r < AI_TOUR_ROUNDS; r++) {
      expect(isFinal(t)).toBe(false);
      completeRound(t, COURSES, 3, -8);
    }
    expect(isFinal(t)).toBe(true);
    const rows = standings(t);
    expect(rows[0].isPlayer).toBe(true);
    // Extra rounds are ignored once final.
    completeRound(t, COURSES, 3, -8);
    expect(t.played).toBe(AI_TOUR_ROUNDS);
  });

  it('field scoring sits in the calibrated +1..-3 band, skill-ordered', { timeout: 60_000 }, () => {
    // Design target (playtest: "AI should shoot ~+1 to -3 each round, with Tiger
    // usually best but not always"), everyone mostly in the +1..-3 band.
    //
    // Re-calibrated in the v1.0 Final UX pass: item 2 moved the Timberline hole-2
    // front-of-green pine's COLLISION 3 yd left (it caught too many approaches).
    // Timberline appears in ~3/4 of the drawn rotas, so freeing that approach
    // lowered EVERY opponent's mean by ~0.4-0.45 strokes/round (measured: JD
    // -1.13 -> -1.59, Tiger -2.65 -> -2.92). That is the intended fairness fix,
    // not a regression, so the per-opponent floors track the new means; the
    // skill ordering and the "mostly in-band" guard below are unchanged and are
    // what actually protect the scoring feel.
    const perOpp: Record<string, number[]> = {};
    // 40 tournaments: the per-opponent floors sit close enough to the sampled
    // mean that fewer tournaments would let the (deterministic) mean drift, so
    // this keeps its full sample (the suite's speed win is scoring.test.ts's
    // shared batch instead).
    for (let s = 0; s < 40; s++) {
      const t = createAiTournament(IDS, OPPONENTS, 5000 + s * 131);
      for (let r = 0; r < AI_TOUR_ROUNDS; r++) completeRound(t, COURSES, 11, 0);
      for (const e of t.field) (perOpp[e.golfer.id] ??= []).push(...e.toPars);
    }
    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    const jd = mean(perOpp.sunny); // JD's persisted id
    const tiger = mean(perOpp.tiger);
    // JD (the field's weakest) now averages ~-1.6; floor at -2.1 with headroom up
    // to the old +0.3 ceiling so a scoring regression in either direction trips.
    expect(jd).toBeGreaterThan(-2.1);
    expect(jd).toBeLessThan(0.3);
    // Tiger (the best) now averages ~-2.9; floor -3.2 (its individual rounds
    // still spread through the -3 band, guarded below), ceiling -1.4.
    expect(tiger).toBeGreaterThan(-3.2);
    expect(tiger).toBeLessThan(-1.4);
    expect(tiger).toBeLessThan(jd); // skill ordering holds on average
    const all = Object.values(perOpp).flat();
    const inBand = all.filter((v) => v <= 1 && v >= -3).length / all.length;
    // Still the real guard that scoring stays "mostly +1..-3". Re-calibrated
    // (0.75 -> 0.73) with the Red Rock pass-7 AI upgrades: opponents now
    // compensate for elevation (plays-like distance) and escape walled lies
    // — the same class of intended fairness fix as the pine note above; the
    // per-opponent mean floors/ceilings still hold unchanged (measured
    // in-band 0.746 after the change, from 0.769).
    expect(inBand).toBeGreaterThan(0.73);
  });

  it('ties on to-par break toward the player, and the purse pays the podium', () => {
    const t = createAiTournament(IDS, OPPONENTS, 5);
    completeRound(t, COURSES, 99, 0);
    // Force an exact tie with the best AI entrant on both keys.
    const best = [...t.field].sort((x, y) => x.toPars[0] - y.toPars[0] || x.rounds[0] - y.rounds[0])[0];
    t.player.rounds[0] = best.rounds[0];
    t.player.toPars[0] = best.toPars[0];
    const rows = standings(t);
    const playerIdx = rows.findIndex((r) => r.isPlayer);
    const rivalIdx = rows.findIndex((r) => r.id === best.golfer.id);
    expect(playerIdx).toBeLessThan(rivalIdx);
    expect(purseFor(1)).toBeGreaterThan(purseFor(2));
    expect(purseFor(2)).toBeGreaterThan(purseFor(3));
    expect(purseFor(4)).toBeGreaterThan(0);
  });
});
