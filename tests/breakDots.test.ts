import { describe, expect, it } from 'vitest';
import { CELL, dotSpeed, lineLattice, localBreak } from '../src/slice3d/breakDots';

describe('grid-locked break dots', () => {
  it('dot speed has a visible floor and clamps on severe break', () => {
    expect(dotSpeed(0)).toBe(2);
    expect(dotSpeed(30)).toBeCloseTo(5.5);
    expect(dotSpeed(60)).toBe(9);
    expect(dotSpeed(500)).toBe(9); // clamped — dots never streak
  });

  it('spawns dots exactly on the grid lattice, strictly inside the span', () => {
    const half = 62; // timberline h2 rx 56 + 6
    for (let i = 0; i < 500; i++) {
      const u = (i * 0.6180339887) % 1;
      const coord = lineLattice(half, u);
      // On a line: coord ≡ -half + CELL·k
      expect((coord + half) % CELL).toBeCloseTo(0, 10);
      expect(Math.abs(coord)).toBeLessThan(half);
    }
  });

  it('decomposes the break onto the grid axes with correct signs', () => {
    // Unrotated green: break to the east (+x) slides x-line dots right and
    // leaves y-line dots still; break toward the golfer (+y, downhill on an
    // uphill putt) slides y-line dots toward the player.
    const east = localBreak(0, 30, 0);
    expect(east.x).toBe(30);
    expect(Math.abs(east.y)).toBe(0);
    expect(localBreak(0, 0, 30).y).toBe(30);
    // Rotated grid: a break along the grid's own x axis stays pure x.
    const rot = 0.4;
    const lb = localBreak(rot, Math.cos(rot) * 20, Math.sin(rot) * 20);
    expect(lb.x).toBeCloseTo(20);
    expect(lb.y).toBeCloseTo(0);
  });

  it('is deterministic for identical inputs (freeze-frame stability)', () => {
    expect(lineLattice(62, 0.37)).toBe(lineLattice(62, 0.37));
    expect(localBreak(0.4, 3, 4)).toEqual(localBreak(0.4, 3, 4));
  });
});
