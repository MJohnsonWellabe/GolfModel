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
    // Design target (playtest: "AI should shoot ~+1 to -3 each round, around
    // my -1.5 average, with Tiger usually best but not always"). Means per
    // round: JD ~-0.3..-0.7, Tiger ~-1.7..-2.3, everyone mostly in-band.
    const perOpp: Record<string, number[]> = {};
    for (let s = 0; s < 40; s++) {
      const t = createAiTournament(IDS, OPPONENTS, 5000 + s * 131);
      for (let r = 0; r < AI_TOUR_ROUNDS; r++) completeRound(t, COURSES, 11, 0);
      for (const e of t.field) (perOpp[e.golfer.id] ??= []).push(...e.toPars);
    }
    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    const jd = mean(perOpp.sunny); // JD's persisted id
    const tiger = mean(perOpp.tiger);
    expect(jd).toBeGreaterThan(-1.25);
    expect(jd).toBeLessThan(0.3);
    expect(tiger).toBeGreaterThan(-2.6);
    expect(tiger).toBeLessThan(-1.4);
    expect(tiger).toBeLessThan(jd); // skill ordering holds on average
    const all = Object.values(perOpp).flat();
    const inBand = all.filter((v) => v <= 1 && v >= -3).length / all.length;
    expect(inBand).toBeGreaterThan(0.75);
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
