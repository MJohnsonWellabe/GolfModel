import { describe, expect, it } from 'vitest';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { buildHeightField } from '../../src/systems/HeightField';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { golferWith, PERFECT_SWING, openHole } from '../simulation/simHelpers';
import { TREE_HITBOX, DEFAULT_TREE_MIX, resolveTreeHitbox, pickSpeciesKey } from '../../src/systems/treeHitbox';
import type { HoleData, Hazard } from '../../src/core/types';

// A hole with a single lone tree of a chosen species sitting on the shot line.
function holeWithTree(species: string, r = 22): { hole: HoleData; tx: number; ty: number } {
  const base = openHole() as HoleData;
  const tx = base.tee.x;
  const ty = base.tee.y - 260; // ~130yd up the fairway, on the aim line
  const tree: Hazard = {
    type: 'trees',
    spacing: 20,
    visualSpacing: 14,
    treeR: r,
    polygon: [
      [tx - 8, ty - 8],
      [tx + 8, ty - 8],
      [tx + 8, ty + 8],
      [tx - 8, ty + 8]
    ]
  } as unknown as Hazard;
  return { hole: { ...base, hazards: [tree] }, tx, ty };
}

function fire(hole: HoleData, species: { trees: string[]; accents: string[] }, launchMult: number) {
  const origin = { ...hole.tee };
  const aim = Math.atan2(hole.pin.y - origin.y, hole.pin.x - origin.x);
  return new PhysicsEngine(hole, buildHeightField(hole), mulberry32(3), species).simulate({
    origin,
    aimAngle: aim,
    swing: PERFECT_SWING(1.0),
    club: clubById('driver'),
    golfer: golferWith(90),
    fireBoost: 0,
    lie: 'tee',
    wind: { angle: 0, speed: 0 },
    hole,
    launchMult,
    spin: { side: 0, top: 0 }
  });
}

describe('per-asset tree hitboxes', () => {
  it('every plantable tree species has a hitbox profile', () => {
    // Mirrors natureModels tree keys; the table must cover each so a trunk is
    // never sized by the fallback by accident.
    const keys = [
      'tree_a', 'tree_b', 'tree_c', 'tree_d',
      'tree_oak', 'tree_birch', 'tree_birch_b', 'tree_birch_c', 'tree_maple', 'tree_aspen', 'tree_poplar',
      'tree_sakura', 'tree_fir_a', 'tree_fir_b', 'tree_fir_c', 'tree_spruce', 'tree_pine_k1', 'tree_pine_k3',
      'tree_palm', 'tree_palm_b'
    ];
    for (const k of keys) expect(TREE_HITBOX[k], `hitbox for ${k}`).toBeTruthy();
  });

  it('a conifer is a narrow tapering cone; a broadleaf is a wider ball', () => {
    const fir = resolveTreeHitbox('tree_fir_a');
    const oak = resolveTreeHitbox('tree_oak');
    expect(fir.cone).toBe(true);
    expect(oak.cone).toBe(false);
    // Measured: the conifer's canopy is markedly NARROWER than the broad oak's.
    expect(fir.canopyRadMul).toBeLessThan(oak.canopyRadMul);
    // The oak is squat-and-wide (aspect ~1.9) so its canopy nearly fills r; the
    // fir is slender (aspect ~4.7) so its cone is roughly half as wide.
    expect(oak.canopyRadMul).toBeGreaterThan(0.85);
    expect(fir.canopyRadMul).toBeLessThan(0.6);
  });

  it('the collision species pick mirrors the render pick (deterministic per x,y)', () => {
    const k1 = pickSpeciesKey(123, 456, DEFAULT_TREE_MIX, [], undefined, undefined);
    const k2 = pickSpeciesKey(123, 456, DEFAULT_TREE_MIX, [], undefined, undefined);
    expect(k1).toBe(k2);
    expect(DEFAULT_TREE_MIX).toContain(k1);
  });

  it('a lone tree on the line stops a shot flown into its canopy', () => {
    const { hole } = holeWithTree('tree_oak');
    // A mid/low trajectory that crosses the tree in its canopy band is stopped.
    const out = fire(hole, { trees: ['tree_oak'], accents: [] }, 0.5);
    expect(out.hitTrees).toBe(true);
  });

  it('a ball flown well OVER a tree clears it (top of the lollipop)', () => {
    const { hole } = holeWithTree('tree_oak', 18);
    const out = fire(hole, { trees: ['tree_oak'], accents: [] }, 1.0);
    // A full-height driver is far above an r=18 tree by 130yd out — no phantom hit.
    expect(out.hitTrees).toBe(false);
  });
});
