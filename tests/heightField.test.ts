import { describe, expect, it } from 'vitest';
import { buildHeightField, HeightField } from '../src/systems/HeightField';
import { PhysicsEngine } from '../src/systems/PhysicsEngine';
import { Golfer, HoleData } from '../src/core/types';
import { clubById } from '../src/data/clubs';

const flatHole: HoleData = {
  number: 1,
  par: 4,
  yardage: 400,
  world: { width: 2000, height: 2000 },
  tee: { x: 1000, y: 1800 },
  green: { cx: 1000, cy: 300, rx: 100, ry: 100 },
  slope: { angle: 0, strength: 0 },
  pin: { x: 1000, y: 300 },
  fairway: [
    [
      [800, 1900],
      [1200, 1900],
      [1200, 200],
      [800, 200]
    ]
  ],
  hazards: [],
  aiTargets: []
};

const GOLFER: Golfer = {
  id: 'g',
  name: 'G',
  color: 0,
  stats: { drivingPower: 85, drivingAccuracy: 100, approach: 100, chipping: 100, putting: 100 }
};

describe('HeightField sampling', () => {
  it('dome peaks at its center and vanishes beyond its radius', () => {
    const hf = new HeightField([{ x: 500, y: 500, h: 5, r: 200 }], 1000, 1000);
    expect(hf.heightAt(500, 500)).toBeCloseTo(5, 1);
    expect(hf.heightAt(500 + 210, 500)).toBe(0);
    expect(hf.heightAt(500 + 100, 500)).toBeGreaterThan(0.5);
  });

  it('plateau is flat across its inner region', () => {
    const hf = new HeightField([{ x: 500, y: 500, h: 4, r: 200, shape: 'plateau' }], 1000, 1000);
    expect(hf.heightAt(500, 500)).toBeCloseTo(4, 1);
    expect(hf.heightAt(500 + 90, 500)).toBeCloseTo(4, 1); // d=0.45 < flat 0.55
    expect(hf.heightAt(500 + 190, 500)).toBeLessThan(1); // skirt
  });

  it('gradient points uphill', () => {
    const hf = new HeightField([{ x: 500, y: 500, h: 5, r: 200 }], 1000, 1000);
    const g = hf.gradientAt(400, 500); // west of peak → uphill is +x
    expect(g.x).toBeGreaterThan(0);
    expect(Math.abs(g.y)).toBeLessThan(Math.abs(g.x) * 0.2);
  });

  it('buildHeightField returns null for flat holes', () => {
    expect(buildHeightField(flatHole)).toBeNull();
    expect(buildHeightField({ ...flatHole, elevation: [] })).toBeNull();
  });
});

describe('PhysicsEngine + heightfield', () => {
  it('an all-zero heightfield reproduces the flat engine exactly', () => {
    const zeroHf = new HeightField([], 2000, 2000);
    const flat = new PhysicsEngine(flatHole);
    const withHf = new PhysicsEngine(flatHole, zeroHf);
    const params = {
      origin: { x: 1000, y: 1800 },
      aimAngle: -Math.PI / 2,
      swing: { power: 0.9, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
      club: clubById('7i'),
      golfer: GOLFER,
      fireBoost: 0,
      lie: 'fairway',
      wind: { angle: 0, speed: 0 },
      hole: flatHole,
      preview: true
    } as const;
    const a = flat.simulate({ ...params });
    const b = withHf.simulate({ ...params });
    expect(b.path).toEqual(a.path);
    expect(b.finalPos).toEqual(a.finalPos);
    expect(b.holed).toBe(a.holed);
  });

  it('downhill putts roll out farther than uphill putts', () => {
    // Green-sized dome: ball starts mid-slope, putts along ±y
    const hole: HoleData = {
      ...flatHole,
      green: { cx: 1000, cy: 1000, rx: 400, ry: 400 },
      pin: { x: 1000, y: 700 }
    };
    const hf = new HeightField([{ x: 1000, y: 700, h: 6, r: 500 }], 2000, 2000);
    const engine = new PhysicsEngine(hole, hf);
    const base = {
      origin: { x: 1000, y: 1000 },
      swing: { power: 0.35, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
      club: clubById('putter'),
      golfer: GOLFER,
      fireBoost: 0,
      lie: 'green',
      wind: { angle: 0, speed: 0 },
      hole,
      preview: true
    } as const;
    const uphill = engine.simulate({ ...base, aimAngle: -Math.PI / 2 }); // toward the dome peak
    const downhill = engine.simulate({ ...base, aimAngle: Math.PI / 2 }); // away from it
    const dUp = Math.hypot(uphill.finalPos.x - 1000, uphill.finalPos.y - 1000);
    const dDown = Math.hypot(downhill.finalPos.x - 1000, downhill.finalPos.y - 1000);
    expect(dDown).toBeGreaterThan(dUp * 1.1);
  });

  it('terrain-aware landing: a shot into a hill lands short of its flat carry', () => {
    const hf = new HeightField([{ x: 1000, y: 1000, h: 20, r: 300 }], 2000, 2000);
    const flat = new PhysicsEngine(flatHole);
    const hilly = new PhysicsEngine(flatHole, hf);
    const params = {
      origin: { x: 1000, y: 1800 },
      aimAngle: -Math.PI / 2, // straight at the hill
      swing: { power: 1, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
      club: clubById('driver'),
      golfer: GOLFER,
      fireBoost: 0,
      lie: 'tee',
      wind: { angle: 0, speed: 0 },
      hole: flatHole,
      preview: true
    } as const;
    const a = flat.simulate({ ...params });
    const b = hilly.simulate({ ...params });
    // Flat-ground carry passes over y≈1230; the 20-unit hill meets the ball earlier
    expect(b.finalPos.y).toBeGreaterThan(a.finalPos.y - 5);
    const landFlat = a.path.findIndex((p, i) => i > 5 && p.z <= 0.001);
    const landHill = b.path.findIndex((p, i) => i > 5 && p.z <= 0.001);
    expect(landHill).toBeLessThanOrEqual(landFlat);
  });

  it('slopeAccelAlong matches the legacy single-slope formula on flat holes', () => {
    const hole: HoleData = { ...flatHole, slope: { angle: Math.PI / 2, strength: 0.5 } };
    const engine = new PhysicsEngine(hole);
    // Putting straight downhill (yaw = slope angle): full positive assist
    const along = engine.slopeAccelAlong({ x: 1000, y: 350 }, Math.PI / 2, 100);
    expect(along).toBeCloseTo(55 * 0.5, 5);
  });
});
