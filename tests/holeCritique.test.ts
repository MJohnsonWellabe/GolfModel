import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../src/data/courseLoader';
import sablebay from '../src/data/courses/v2/sablebay.json';
import {
  critiqueHole,
  holeBrief,
  HOLE_BRIEF_CONSTRAINTS,
  parseHoleBrief,
  structuralIssues
} from '../src/systems/HoleCritique';
import type { HoleData } from '../src/core/types';

/**
 * The hole critique is the editor's oracle. It has to be two things at once:
 * right about holes that are broken, and STABLE — a designer changes one bunker
 * and reads the difference, so a number that wanders on its own is worse than no
 * number at all.
 */

const course = loadCourse(sablebay as unknown as CourseAuthoring);

describe('structural checks', () => {
  const good = course.holes[0];

  it('passes a shipped hole', () => {
    expect(structuralIssues(good).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('catches a pin that is not on its green', () => {
    const broken: HoleData = { ...good, pin: { x: good.pin.x + 400, y: good.pin.y } };
    expect(structuralIssues(broken).map((i) => i.message)).toContain('The pin is not on the green.');
  });

  it('catches a layup target dropped in the water', () => {
    const water = good.hazards.find((h) => h.type === 'water');
    expect(water, 'fixture needs a water hazard').toBeTruthy();
    const inside = water!.polygon.reduce(
      (a, p) => ({ x: a.x + p[0] / water!.polygon.length, y: a.y + p[1] / water!.polygon.length }),
      { x: 0, y: 0 }
    );
    const broken: HoleData = { ...good, aiTargets: [inside] };
    expect(structuralIssues(broken).some((i) => /Layup target 1 sits inside a water/.test(i.message))).toBe(true);
  });

  it('catches an elevation point with no radius, and one in the wrong unit', () => {
    const broken: HoleData = {
      ...good,
      elevation: [
        { x: 500, y: 500, h: 10, r: 0 },
        { x: 500, y: 500, h: 300, r: 50 }
      ]
    };
    const msgs = structuralIssues(broken).map((i) => i.message);
    expect(msgs.some((m) => /Elevation point 1 has no radius/.test(m))).toBe(true);
    // 300 units is ~450 ft — the classic yards-vs-1.5ft mistake.
    expect(msgs.some((m) => /Elevation point 2 is 300 units/.test(m))).toBe(true);
  });

  it('catches geometry outside the world', () => {
    const broken: HoleData = { ...good, tee: { x: -50, y: 10 } };
    expect(structuralIssues(broken).map((i) => i.message)).toContain('The tee is outside the world bounds.');
  });
});

describe('play read', () => {
  it('is identical run to run — an edit must be the only thing that moves it', () => {
    const a = critiqueHole(course, 0);
    const b = critiqueHole(course, 0);
    expect(b.tiers).toEqual(a.tiers);
    expect(b.verdict).toBe(a.verdict);
  });

  it('reports every tier with sane rates', () => {
    const c = critiqueHole(course, 0);
    expect(c.tiers.map((t) => t.tier)).toEqual(['Casual', 'Regular', 'Strong']);
    for (const t of c.tiers) {
      expect(t.parRate).toBeGreaterThanOrEqual(0);
      expect(t.parRate).toBeLessThanOrEqual(1);
      expect(t.blowupRate).toBeGreaterThanOrEqual(0);
      expect(t.blowupRate).toBeLessThanOrEqual(1);
    }
  });

  it('says a better player scores better on a shipped hole', () => {
    // If this ever inverts, either the hole or the difficulty model is wrong,
    // and both are worth being told about loudly.
    const c = critiqueHole(course, 0);
    expect(c.tiers[2].meanToPar).toBeLessThan(c.tiers[0].meanToPar);
  });

  it('leads with structure — a broken hole is not graded on its scoring', () => {
    const broken = { ...course, holes: [{ ...course.holes[0], pin: { x: 5, y: 5 } }] };
    const c = critiqueHole(broken, 0);
    expect(c.ok).toBe(false);
    expect(c.verdict).toMatch(/structural problem/);
  });

  it('has something to say about a hole that does not exist', () => {
    const c = critiqueHole(course, 99);
    expect(c.ok).toBe(false);
    expect(c.issues).toHaveLength(1);
  });
});

describe('the Claude round trip', () => {
  it('carries the hole, the evidence, the intent and the rules', () => {
    const brief = holeBrief(course, 0, 'Make the tee shot a real decision.');
    expect(brief.format).toBe('bsgolf.hole.v1');
    expect(brief.hole.number).toBe(course.holes[0].number);
    expect(brief.critique.tiers).toHaveLength(3);
    expect(brief.intent).toContain('decision');
    // The units rule is the one that has actually bitten this project — the
    // shipping conversion is 1.5 ft/unit (field guide §2), and the brief must
    // quote the real horizontal scale too, not a hard-coded one.
    expect(brief.constraints.join(' ')).toMatch(/1\.5 ft/);
    expect(brief.constraints.join(' ')).toContain('1 yd = 2 px');
    expect(brief.constraints).toEqual(HOLE_BRIEF_CONSTRAINTS);
  });

  it('round-trips its own envelope', () => {
    const brief = holeBrief(course, 0, 'unchanged');
    const back = parseHoleBrief(JSON.stringify(brief));
    expect(back.error).toBeUndefined();
    expect(back.hole!.pin).toEqual(course.holes[0].pin);
  });

  it('accepts a bare hole, and a fenced code block', () => {
    // Both are what a chat interface actually hands back.
    const bare = parseHoleBrief(JSON.stringify(course.holes[0]));
    expect(bare.error).toBeUndefined();
    const fenced = parseHoleBrief('```json\n' + JSON.stringify(course.holes[0]) + '\n```');
    expect(fenced.error).toBeUndefined();
  });

  it('refuses prose, half a hole, and an implausible par', () => {
    expect(parseHoleBrief('Sure! Here is your hole:').hole).toBeNull();
    expect(parseHoleBrief('{"world":{"width":10,"height":10}}').hole).toBeNull();
    expect(parseHoleBrief(JSON.stringify({ ...course.holes[0], par: 11 })).error).toMatch(/par/);
  });
});
