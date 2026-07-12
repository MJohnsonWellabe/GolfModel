import { describe, expect, it } from 'vitest';
import { collectTreeBlobs } from '../src/systems/treeField';
import { HoleData } from '../src/core/types';
import { pointInPolygon } from '../src/utils/Geometry';
import { loadCourse, CourseAuthoring } from '../src/data/courseLoader';
import timberline from '../src/data/courses/timberline.json';
import wildwood from '../src/data/courses/wildwood.json';
import sablebay from '../src/data/courses/sablebay.json';
import portjohnson from '../src/data/courses/portjohnson.json';

const square: number[][] = [
  [100, 100],
  [400, 100],
  [400, 400],
  [100, 400]
];

function holeWith(spacing?: number): HoleData {
  return {
    number: 1,
    par: 4,
    yardage: 400,
    world: { width: 900, height: 1200 },
    tee: { x: 450, y: 1100 },
    green: { cx: 450, cy: 200, rx: 60, ry: 40 },
    slope: { angle: 0, strength: 0 },
    pin: { x: 450, y: 200 },
    fairway: [],
    hazards: [{ type: 'trees', polygon: square, ...(spacing !== undefined ? { spacing } : {}) }],
    aiTargets: []
  };
}

describe('collectTreeBlobs spacing', () => {
  it('keeps the historical density when no spacing is authored', () => {
    // 300x300 polygon on a 52-unit grid: the exact blob set is jitter-
    // dependent, but the count must match the long-standing default so
    // existing courses (and their balance) are untouched by the knob.
    expect(collectTreeBlobs(holeWith())).toEqual(collectTreeBlobs(holeWith(52)));
  });

  it('plants denser woods when the hazard authors a smaller spacing', () => {
    const sparse = collectTreeBlobs(holeWith()).length;
    const dense = collectTreeBlobs(holeWith(42)).length;
    expect(dense).toBeGreaterThan(sparse * 1.3);
  });

  it('keeps every trunk inside the authored polygon at any density', () => {
    for (const b of collectTreeBlobs(holeWith(40))) {
      expect(pointInPolygon(b.x, b.y, square)).toBe(true);
    }
  });
});

describe('collectTreeBlobs specimen-tree fallback', () => {
  // A lone fairway tree / thinking tree is authored as a polygon finer than the
  // sampling step. Without a fallback the grid pass lands zero trunks and the
  // tree vanishes from BOTH render and collision (playtest: Timberline h1's
  // fairway tree had no hitbox and no mesh).
  const tinyTree = (spacing: number): HoleData => {
    const c = 250; // small ~24-unit specimen polygon, well under any real step
    const poly = [
      [c - 12, c - 12],
      [c + 12, c - 12],
      [c + 12, c + 12],
      [c - 12, c + 12]
    ];
    return {
      number: 1,
      par: 4,
      yardage: 400,
      world: { width: 900, height: 1200 },
      tee: { x: 450, y: 1100 },
      green: { cx: 450, cy: 200, rx: 60, ry: 40 },
      slope: { angle: 0, strength: 0 },
      pin: { x: 450, y: 200 },
      fairway: [],
      hazards: [{ type: 'trees', polygon: poly, spacing }],
      aiTargets: []
    } as HoleData;
  };

  it('plants a centroid trunk when the grid pass would miss a small polygon', () => {
    const blobs = collectTreeBlobs(tinyTree(52));
    expect(blobs.length).toBeGreaterThanOrEqual(1);
    // It sits at the polygon centroid (250,250).
    expect(blobs[0].x).toBeCloseTo(250);
    expect(blobs[0].y).toBeCloseTo(250);
  });

  it('is deterministic across the collision and render passes', () => {
    const collide = collectTreeBlobs(tinyTree(52), 0, false);
    const render = collectTreeBlobs(tinyTree(52), 0, true);
    expect(collide.length).toBe(render.length);
    expect(render[0].x).toBeCloseTo(collide[0].x);
    expect(render[0].y).toBeCloseTo(collide[0].y);
  });

  it('trunks never plant in water (render and collision together)', () => {
    // A woods polygon deliberately overlapping a pond: every emitted trunk
    // must land on dry ground, in BOTH passes, so a creek routed through a
    // treeline never collects floating trees (recurring playtest bug).
    const hole = {
      ...holeWith(),
      hazards: [
        { type: 'trees', polygon: [[100, 100], [500, 100], [500, 500], [100, 500]], spacing: 40 },
        { type: 'water', polygon: [[250, 100], [400, 100], [400, 500], [250, 500]] }
      ]
    } as unknown as HoleData;
    for (const forRender of [false, true]) {
      const blobs = collectTreeBlobs(hole, 0, forRender);
      expect(blobs.length).toBeGreaterThan(10);
      for (const b of blobs) {
        const wet = b.x > 250 && b.x < 400;
        expect(wet, `trunk at ${b.x.toFixed(1)},${b.y.toFixed(1)} (forRender=${forRender})`).toBe(false);
      }
    }
  });

  it('every authored trees hazard on every course yields at least one trunk', () => {
    const courses = { timberline, wildwood, sablebay, portjohnson };
    for (const [id, json] of Object.entries(courses)) {
      const course = loadCourse(json as unknown as CourseAuthoring);
      for (const hole of course.holes) {
        const treeHazards = hole.hazards.filter((h) => h.type === 'trees');
        for (let hi = 0; hi < treeHazards.length; hi++) {
          // Isolate each hazard so one populated grid can't mask a neighbour
          // that lands zero — both collision (forRender=false) and render
          // (forRender=true, which honours visualOnly) must place a trunk.
          const solo = { ...hole, hazards: [treeHazards[hi]] } as HoleData;
          const collide = collectTreeBlobs(solo, 0, false);
          const render = collectTreeBlobs(solo, 0, true);
          const label = `${id} h${hole.number} tree-hazard[${hi}]`;
          if (!treeHazards[hi].visualOnly) {
            expect(collide.length, `${label} collision`).toBeGreaterThanOrEqual(1);
          }
          expect(render.length, `${label} render`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});
