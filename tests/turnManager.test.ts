import { describe, expect, it } from 'vitest';
import { RULES } from '../src/config';
import { TurnManager, TurnPlayer } from '../src/systems/TurnManager';
import { Point, ShotOutcome, Surface } from '../src/core/types';

const PIN: Point = { x: 0, y: 0 };
const TEE: Point = { x: 0, y: 1000 };

const player = (ball: Point, over: Partial<TurnPlayer> = {}): TurnPlayer => ({
  ball,
  lie: 'fairway',
  strokes: 0,
  holed: false,
  isAI: false,
  ...over
});

const outcome = (
  finalPos: Point,
  over: Partial<ShotOutcome> = {}
): ShotOutcome => ({
  path: [],
  finalPos,
  surface: 'fairway' as Surface,
  waterPenalty: false,
  obPenalty: false,
  hitTrees: false,
  holed: false,
  ...over
});

describe('stroke play', () => {
  it('farthest ball from the pin plays first', () => {
    const tm = new TurnManager('1v1', PIN, TEE);
    const players = [player({ x: 0, y: 100 }), player({ x: 0, y: 400 })];
    expect(tm.nextPlayer(players)).toBe(1);
  });

  it('near-ties (within the slack) do not steal the turn', () => {
    const tm = new TurnManager('1v1', PIN, TEE);
    const players = [player({ x: 0, y: 400 }), player({ x: 0, y: 410 })];
    expect(tm.nextPlayer(players)).toBe(0);
  });

  it('holed players are skipped; all holed ends the hole', () => {
    const tm = new TurnManager('1v1', PIN, TEE);
    const players = [
      player({ x: 0, y: 500 }, { holed: true }),
      player({ x: 0, y: 100 })
    ];
    expect(tm.nextPlayer(players)).toBe(1);
    players[1].holed = true;
    expect(tm.nextPlayer(players)).toBeNull();
  });

  it('applyPickups retires players at the stroke cap', () => {
    const tm = new TurnManager('solo', PIN, TEE);
    const players = [
      player({ x: 0, y: 500 }, { strokes: RULES.maxStrokes }),
      player({ x: 0, y: 500 }, { strokes: RULES.maxStrokes - 1 })
    ];
    expect(tm.applyPickups(players)).toEqual([0]);
    expect(players[0].holed).toBe(true);
    expect(players[1].holed).toBe(false);
  });
});

describe('scramble', () => {
  it('teammates hit from the team ball, better ball wins the cycle', () => {
    const tm = new TurnManager('scramble', PIN, TEE);
    const players = [player({ x: 9, y: 9 }), player({ x: 9, y: 9 })];

    expect(tm.beginScrambleShot(players)).toBe(0);
    expect(players[0].ball).toEqual(TEE);
    expect(tm.recordScrambleOutcome(outcome({ x: 0, y: 500 }))).toBe(false);

    expect(tm.beginScrambleShot(players)).toBe(1);
    expect(players[1].ball).toEqual(TEE);
    expect(tm.recordScrambleOutcome(outcome({ x: 0, y: 300 }))).toBe(true);

    const { chooserIdx } = tm.resolveScramble(players);
    expect(chooserIdx).toBe(1); // closer to the pin
    expect(tm.teamStrokes).toBe(1);
    expect(tm.teamBall).toEqual({ x: 0, y: 300 });
    expect(players[0].ball).toEqual({ x: 0, y: 300 }); // everyone moves up
  });

  it('a water-penalty ball loses to a dry one and costs an extra stroke when chosen', () => {
    const tm = new TurnManager('scramble', PIN, TEE);
    const players = [player(TEE), player(TEE)];
    tm.beginScrambleShot(players);
    // Wet but much closer to the pin
    tm.recordScrambleOutcome(outcome({ x: 0, y: 50 }, { waterPenalty: true }));
    tm.beginScrambleShot(players);
    tm.recordScrambleOutcome(outcome({ x: 0, y: 800 }));

    const { chooserIdx } = tm.resolveScramble(players);
    expect(chooserIdx).toBe(1); // dry ball wins despite being farther
    expect(tm.teamStrokes).toBe(1); // no penalty because the dry ball was taken
  });

  it('holing out finishes the team hole', () => {
    const tm = new TurnManager('scramble', PIN, TEE);
    const players = [player(TEE), player(TEE)];
    tm.beginScrambleShot(players);
    tm.recordScrambleOutcome(outcome(PIN, { holed: true }));
    tm.beginScrambleShot(players);
    tm.recordScrambleOutcome(outcome({ x: 0, y: 600 }));

    const { chosen } = tm.resolveScramble(players);
    expect(chosen.holed).toBe(true);
    expect(tm.teamHoled).toBe(true);
    expect(tm.scrambleFinished).toBe(true);
  });
});
