import { describe, expect, it } from 'vitest';
import { formatToPar, scoreName, Scoring } from '../src/systems/Scoring';
import { CourseData } from '../src/core/types';

const COURSE = {
  name: 'Test Links',
  holes: [{ par: 4 }, { par: 3 }, { par: 5 }]
} as CourseData;

describe('scoreName', () => {
  it('names the classics', () => {
    expect(scoreName(1, 3)).toBe('Hole in One!');
    expect(scoreName(2, 4)).toBe('Eagle!');
    expect(scoreName(3, 4)).toBe('Birdie!');
    expect(scoreName(4, 4)).toBe('Par');
    expect(scoreName(5, 4)).toBe('Bogey');
    expect(scoreName(6, 4)).toBe('Double Bogey');
  });

  it('falls back to +N beyond triple bogey', () => {
    expect(scoreName(8, 4)).toBe('+4');
  });
});

describe('formatToPar', () => {
  it('formats even, over and under par', () => {
    expect(formatToPar(12, 12)).toBe('E');
    expect(formatToPar(14, 12)).toBe('+2');
    expect(formatToPar(10, 12)).toBe('-2');
  });
});

describe('Scoring', () => {
  it('totals strokes per player', () => {
    const s = new Scoring('1v1', COURSE, 2);
    s.recordHole(0, 0, 4);
    s.recordHole(0, 1, 2);
    s.recordHole(1, 0, 5);
    expect(s.totalStrokes(0)).toBe(6);
    expect(s.totalStrokes(1)).toBe(5);
  });

  it('totalToPar only counts holes actually played', () => {
    const s = new Scoring('solo', COURSE, 1);
    s.recordHole(0, 0, 5); // +1
    s.recordHole(0, 1, 2); // -1
    // hole 3 unplayed (0 strokes) must not count as -5
    expect(s.totalToPar(0, 2)).toBe(0);
    s.recordHole(0, 2, 7); // +2
    expect(s.totalToPar(0, 2)).toBe(2);
    // through-hole limit
    expect(s.totalToPar(0, 0)).toBe(1);
  });
});
