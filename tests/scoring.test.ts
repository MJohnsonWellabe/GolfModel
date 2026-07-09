import { describe, expect, it } from 'vitest';
import { scoreName } from '../src/systems/Scoring';

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
