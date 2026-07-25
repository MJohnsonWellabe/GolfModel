import { describe, expect, it } from 'vitest';
import { coursesFor } from '../../src/data/courseRoster';
import { simulateRound } from '../../src/systems/RoundSimulator';
import { USER_TIERS } from '../../src/systems/SkillSimulator';
import { assembleGolfer } from '../../src/data/golfers';
import { perkById } from '../../src/data/perks';
import { ARCHETYPES } from '../../src/data/archetypes';
import type { CourseData, Golfer } from '../../src/core/types';

/**
 * THE SCORING ANCHORS.
 *
 * The owner reported that dev played far harder than production and asked for
 * the difference to be found. `?env=dev` and production are the SAME BUILD
 * (src/config/env.ts) — same physics, same courses — so it could not be the
 * code. These tests exist to keep the answer measured rather than remembered.
 *
 * WHAT THE MEASUREMENT ACTUALLY SHOWED
 * ------------------------------------
 * Three legitimate sources of variance, none of them a regression:
 *
 *   - **which course** is worth up to ~2 strokes to the same player. A kitted
 *     expert averages about −3.2 on Red Hollow and about −1.2 on Timberline
 *     West. "3-4 under" is a real Red Hollow score and an impossible Timberline
 *     West one.
 *   - **which archetype** is worth ~0.55 strokes on average, because
 *     `statsForClub` reads `drivingPower` as the distance for EVERY club and
 *     archetypes span 79..100. An unlocked profile re-rolls one per round.
 *   - **kit** (upgrades + perk) is worth ~1.1 strokes to a novice and ~0.14 to
 *     an expert — it widens the perfect band, which barely helps somebody who
 *     was already hitting perfects.
 *
 * The new-player end matches the owner's production telemetry closely: the sim
 * puts a bare novice at about +1.3, he measures +1.5 live. That agreement is
 * what makes the rest of the numbers worth trusting.
 *
 * These tests assert PROPERTIES that must hold, not a remembered score. A test
 * pinned to "an expert shoots 3-4 under" would be pinned to a course choice.
 */

const COURSES = coursesFor({ newCourses: true, courseRebuilds: true });
const COURSE_LIST = Object.entries(COURSES) as Array<[string, CourseData]>;

/** Rounds per course. Enough that a mean is stable to about a tenth of a stroke. */
const ROUNDS = 60;

/**
 * CALIBRATION WIND — the light band the difficulty work settled on
 * (tests/simulation/difficultyGrid.test.ts). The course fallback of a constant
 * 2..20mph breeze on every hole overstates wind by roughly a stroke and does not
 * reproduce a typical round.
 */
const WIND = { windMin: 1, windMax: 8 };

const EXPERT = USER_TIERS.find((t) => t.name === 'Expert')!;
const NOVICE = USER_TIERS.find((t) => t.name === 'Novice')!;

/** The golfer a long-time production player swings: locked Big Hitter, maxed
 *  club upgrades, best perk equipped. */
function veteran(): Golfer {
  return assembleGolfer(
    'Veteran',
    'chip',
    'bigHitter',
    { driver: 2, irons: 2, wedges: 2, putter: 2 },
    perkById('perk_iron_t2_r3')
  );
}

/** A brand-new player: stock archetype, nothing bought, nothing equipped. */
function rookie(): Golfer {
  return assembleGolfer('Rookie', 'chip', 'bigHitter');
}

function meanOn(course: CourseData, golfer: Golfer, sigma: { sigmaPower: number; sigmaAcc: number }): number {
  let total = 0;
  for (let i = 0; i < ROUNDS; i++) {
    total += simulateRound(course, golfer, 1000 + i * 7919, undefined, true, sigma, undefined, WIND).toPar;
  }
  return total / ROUNDS;
}

function meanAcrossRoster(golfer: Golfer, sigma: { sigmaPower: number; sigmaAcc: number }): number {
  return COURSE_LIST.reduce((sum, [, c]) => sum + meanOn(c, golfer, sigma), 0) / COURSE_LIST.length;
}

describe('scoring anchors', () => {
  it('a new player averages a little over par — the number the owner measures live', () => {
    // Production telemetry: new players average about +1.5. If this drifts, the
    // first-round experience has changed and nothing else would say so.
    const mean = meanAcrossRoster(rookie(), NOVICE);
    expect(mean, `new player averaged ${mean.toFixed(2)}`).toBeGreaterThan(0.3);
    expect(mean, `new player averaged ${mean.toFixed(2)}`).toBeLessThan(2.5);
  }, 180_000);

  it('an expert with kit shoots comfortably under par on every course', () => {
    const g = veteran();
    for (const [id, course] of COURSE_LIST) {
      const mean = meanOn(course, g, EXPERT);
      expect(mean, `${id}: expert veteran averaged ${mean.toFixed(2)}`).toBeLessThan(-0.75);
    }
  }, 300_000);

  it('timing is the biggest lever — an expert beats a novice by several strokes', () => {
    const g = veteran();
    const gap = meanAcrossRoster(g, NOVICE) - meanAcrossRoster(g, EXPERT);
    expect(gap, `expert beats novice by ${gap.toFixed(2)}`).toBeGreaterThan(1.5);
  }, 300_000);
});

describe('what actually varies between two rounds', () => {
  it('the course is worth up to about two strokes — so "3-4 under" names a course', () => {
    // This is the single largest source of the reported dev-vs-prod gap. It is
    // also why the landing must make the course you are about to play obvious:
    // one-tap Play silently tees off on whatever was played last.
    const g = veteran();
    const means = COURSE_LIST.map(([id, c]) => ({ id, m: meanOn(c, g, EXPERT) }));
    const easiest = Math.min(...means.map((x) => x.m));
    const hardest = Math.max(...means.map((x) => x.m));
    const spread = hardest - easiest;
    expect(
      spread,
      `spread ${spread.toFixed(2)}: ${means.map((x) => `${x.id} ${x.m.toFixed(2)}`).join(', ')}`
    ).toBeGreaterThan(0.75);
    // A roster where one course is wildly out of line is a balance bug, not
    // variety.
    expect(spread, `spread ${spread.toFixed(2)} is too wide — one course is an outlier`).toBeLessThan(3.5);
  }, 300_000);

  it('a locked loadout beats a random one, because distance follows the archetype', () => {
    // `roundGolfer` re-rolls character AND archetype every round unless the
    // player has locked a loadout. Worth measuring, because it is invisible: a
    // player who never opened the Locker Room is quietly playing a different
    // golfer each round, which is corrosive in a game built on timing.
    const perArchetype = ARCHETYPES.map((a) => meanAcrossRoster(assembleGolfer('X', 'chip', a.id), EXPERT));
    const randomAverage = perArchetype.reduce((a, b) => a + b, 0) / perArchetype.length;
    const locked = meanAcrossRoster(assembleGolfer('X', 'chip', 'bigHitter'), EXPERT);
    expect(
      randomAverage - locked,
      `random archetype costs ${(randomAverage - locked).toFixed(2)} strokes vs a locked Big Hitter`
    ).toBeGreaterThan(0.25);
  }, 600_000);

  it('kit helps the players who need it most', () => {
    // Deliberate economy design: upgrades and perks widen the perfect band, so
    // they are worth about a stroke to a novice and almost nothing to an expert
    // who was already hitting perfects. If this ever inverts, the upgrade
    // economy has become a rich-get-richer ladder.
    const noviceGain = meanAcrossRoster(rookie(), NOVICE) - meanAcrossRoster(veteran(), NOVICE);
    const expertGain = meanAcrossRoster(rookie(), EXPERT) - meanAcrossRoster(veteran(), EXPERT);
    expect(noviceGain, `kit is worth ${noviceGain.toFixed(2)} to a novice`).toBeGreaterThan(0.4);
    expect(noviceGain, `novice ${noviceGain.toFixed(2)} vs expert ${expertGain.toFixed(2)}`).toBeGreaterThan(
      expertGain
    );
  }, 600_000);
});

describe('the simulator swings the same meter the player does', () => {
  it('models the perfect-zone widening that upgrades and perks buy', () => {
    // The sim armed its swing context with the fire multiplier ALONE while the
    // live meter arms with fire × upgrades × perk (main.ts). So every
    // calibration ever run through it modelled a player who owned nothing — the
    // same class of bug as a replay assembling a different golfer than the one
    // that played. Kit must move the number, or the divergence is back.
    const kitted = meanAcrossRoster(veteran(), NOVICE);
    const bare = meanAcrossRoster(rookie(), NOVICE);
    expect(bare - kitted, `kit moved the sim by ${(bare - kitted).toFixed(2)} strokes`).toBeGreaterThan(0.4);
  }, 300_000);
});
