import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { PHYSICS, SWING } from '../../src/config';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { CourseData } from '../../src/core/types';
import { GridResult, GOLFER_TIERS, runGrid, USER_TIERS } from '../../src/systems/SkillSimulator';
import { buildDashboard } from './difficultyDashboard';

// All PLAYABLE production courses (both content flags default ON live): the v2
// rebuilds actually played for sablebay/timberline/portjohnson, plus wildwood
// and the two generated courses. A "round" = one course's 3 holes (par 12).
import wildwood from '../../src/data/courses/wildwood.json';
import redhollow from '../../src/data/courses/redhollow.json';
import wildvalley from '../../src/data/courses/wildvalley.json';
import sablebayV2 from '../../src/data/courses/v2/sablebay.json';
import timberlineV2 from '../../src/data/courses/v2/timberline.json';
import portjohnsonV2 from '../../src/data/courses/v2/portjohnson.json';

const COURSES: CourseData[] = [
  wildwood,
  sablebayV2,
  timberlineV2,
  portjohnsonV2,
  redhollow,
  wildvalley
].map((c) => loadCourse(c as unknown as CourseAuthoring));

const SCRATCH = '/tmp/claude-0/-home-user/dfe4e2d5-ec7d-58bc-86bb-a04745c2265b/scratchpad';
const ROUNDS = Number(process.env.GRID_ROUNDS ?? 40); // per course per cell

/** Config knob set the simulator can force (baseline vs tuned) at runtime. */
interface KnobSet {
  [k: string]: number;
  perfectBandMin: number;
  perfectBandMax: number;
  goodBandMin: number;
  goodBand: number;
  accuracyCurveExp: number;
  accuracyCurveGain: number;
  powerShortExp: number;
  puttPacePerfect: number;
  puttPaceGood: number;
  puttPaceMiss: number;
  puttPaceNoise: number;
  puttPaceGrowPx: number;
  putterErrorDiv: number;
}

// BASELINE = the original shipped constants (linear accuracy, current putt
// forgiveness) — the reference the tuned curve is compared against.
const BASELINE: KnobSet = {
  perfectBandMin: 0.008,
  perfectBandMax: 0.026,
  goodBandMin: 0.055,
  goodBand: 0.09,
  accuracyCurveExp: 1,
  accuracyCurveGain: 1,
  powerShortExp: 1,
  puttPacePerfect: 1,
  puttPaceGood: 3,
  puttPaceMiss: 6,
  puttPaceNoise: 0.055,
  puttPaceGrowPx: 70,
  putterErrorDiv: 2.4
};

// TUNED = the LANDED curve (mirrors src/config.ts). Env vars override for
// re-tuning; the defaults below are the shipped values so the dashboard shows
// the real tuned grid with no env set.
const TUNED: KnobSet = {
  perfectBandMin: Number(process.env.K_pbmin ?? 0.012),
  perfectBandMax: Number(process.env.K_pbmax ?? 0.04),
  goodBandMin: Number(process.env.K_gbmin ?? 0.09),
  goodBand: Number(process.env.K_gb ?? 0.135),
  accuracyCurveExp: Number(process.env.K_aexp ?? 1.7),
  accuracyCurveGain: Number(process.env.K_again ?? 0.42),
  powerShortExp: Number(process.env.K_pse ?? 1.6),
  puttPacePerfect: Number(process.env.K_ppp ?? 1),
  puttPaceGood: Number(process.env.K_ppg ?? 2.8),
  puttPaceMiss: Number(process.env.K_ppm ?? 3.5),
  puttPaceNoise: Number(process.env.K_ppn ?? 0.04),
  puttPaceGrowPx: Number(process.env.K_ppgrow ?? 70),
  putterErrorDiv: Number(process.env.K_ped ?? 4.0)
};

function apply(k: KnobSet): void {
  const s = SWING as unknown as Record<string, number>;
  s.perfectBandMin = k.perfectBandMin;
  s.perfectBandMax = k.perfectBandMax;
  s.goodBandMin = k.goodBandMin;
  s.goodBand = k.goodBand;
  s.accuracyCurveExp = k.accuracyCurveExp;
  s.accuracyCurveGain = k.accuracyCurveGain;
  s.powerShortExp = k.powerShortExp;
  const p = PHYSICS as unknown as Record<string, unknown>;
  (p.puttPaceQualityMult as Record<string, number>).perfect = k.puttPacePerfect;
  (p.puttPaceQualityMult as Record<string, number>).good = k.puttPaceGood;
  (p.puttPaceQualityMult as Record<string, number>).miss = k.puttPaceMiss;
  p.puttPaceNoise = k.puttPaceNoise;
  p.puttPaceGrowPx = k.puttPaceGrowPx;
  p.putterErrorDiv = k.putterErrorDiv;
}

function run(k: KnobSet): GridResult {
  apply(k);
  return runGrid(COURSES, { roundsPerCourse: ROUNDS, seedBase: 900_000 });
}

// HEAVY instrument (thousands of seeded rounds, writes the dashboard) — OPT-IN
// so the default `vitest run` stays fast. Invoke with:
//   RUN_DIFFICULTY_GRID=1 GRID_ROUNDS=40 npx vitest run tests/simulation/difficultyGrid.test.ts
const RUN = !!process.env.RUN_DIFFICULTY_GRID;

describe('difficulty calibration grid', () => {
  it.skipIf(!RUN)(
    'runs baseline + tuned grids and writes the dashboard',
    () => {
      const snapshot: KnobSet = { ...BASELINE }; // captured for restore
      Object.assign(snapshot, {
        perfectBandMin: SWING.perfectBandMin,
        perfectBandMax: SWING.perfectBandMax,
        goodBandMin: SWING.goodBandMin,
        goodBand: SWING.goodBand,
        accuracyCurveExp: SWING.accuracyCurveExp,
        accuracyCurveGain: SWING.accuracyCurveGain,
        powerShortExp: SWING.powerShortExp,
        puttPacePerfect: PHYSICS.puttPaceQualityMult.perfect,
        puttPaceGood: PHYSICS.puttPaceQualityMult.good,
        puttPaceMiss: PHYSICS.puttPaceQualityMult.miss,
        puttPaceNoise: PHYSICS.puttPaceNoise,
        puttPaceGrowPx: PHYSICS.puttPaceGrowPx,
        putterErrorDiv: PHYSICS.putterErrorDiv
      });

      const tuned = run(TUNED);
      // Search mode: skip the (identical-shape) baseline pass to halve runtime.
      const baseline = process.env.SKIP_BASELINE ? tuned : run(BASELINE);
      apply(snapshot); // restore

      const payload = {
        rounds: ROUNDS,
        courses: COURSES.length,
        users: USER_TIERS,
        golfers: GOLFER_TIERS,
        baselineKnobs: BASELINE,
        tunedKnobs: TUNED,
        baseline,
        tuned
      };
      writeFileSync(`${SCRATCH}/difficulty-grid.json`, JSON.stringify(payload, null, 2));

      const html = buildDashboard(payload);
      writeFileSync(`${SCRATCH}/difficulty-dashboard.html`, html);

      // A compact text summary too (vitest swallows console.log, so file it).
      writeFileSync(`${SCRATCH}/difficulty-summary.txt`, textSummary(payload));
    },
    600_000
  );
});

function fmt(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(1);
}

function textSummary(p: {
  rounds: number;
  baseline: GridResult;
  tuned: GridResult;
  tunedKnobs: KnobSet;
}): string {
  const lines: string[] = [];
  const grid = (label: string, g: GridResult): void => {
    lines.push(`\n=== ${label} (rounds/cell=${p.rounds * 6}) ===`);
    const header = ['user\\golfer', ...g.golfers.map((x) => x.name)].join('\t');
    lines.push(header);
    for (let ui = 0; ui < g.users.length; ui++) {
      const cols = g.cells[ui].map((c) => `${fmt(c.medianToPar)} [${fmt(c.p10ToPar)}/${fmt(c.p90ToPar)}]`);
      lines.push([g.users[ui].name, ...cols].join('\t'));
    }
    lines.push('--- putts/hole ---');
    for (let ui = 0; ui < g.users.length; ui++) {
      const cols = g.cells[ui].map((c) => c.meanPutts.toFixed(2));
      lines.push([g.users[ui].name, ...cols].join('\t'));
    }
    lines.push('--- one-putt % / three-putt % ---');
    for (let ui = 0; ui < g.users.length; ui++) {
      const cols = g.cells[ui].map((c) => `${c.meanOnePuttPct.toFixed(0)}/${c.meanThreePuttPct.toFixed(0)}`);
      lines.push([g.users[ui].name, ...cols].join('\t'));
    }
    lines.push('--- unfinished holes / round (blow-up proxy) ---');
    for (let ui = 0; ui < g.users.length; ui++) {
      const cols = g.cells[ui].map((c) => c.meanPenalties.toFixed(2));
      lines.push([g.users[ui].name, ...cols].join('\t'));
    }
    lines.push('--- band mix (full swing) perfect/good/miss & putt band ---');
    for (let ui = 0; ui < g.users.length; ui++) {
      const c = g.cells[ui][2]; // vs Good golfer
      const b = c.band;
      const pb = c.puttBand;
      lines.push(
        `${g.users[ui].name} vs Good: full ${(100 * b.perfect).toFixed(0)}/${(100 * b.good).toFixed(0)}/${(100 * b.miss).toFixed(0)}  putt ${(100 * pb.perfect).toFixed(0)}/${(100 * pb.good).toFixed(0)}/${(100 * pb.miss).toFixed(0)}  FIR ${c.meanFir.toFixed(0)} GIR ${c.meanGir.toFixed(0)}`
      );
    }
  };
  grid('BASELINE', p.baseline);
  grid('TUNED', p.tuned);
  lines.push(`\nTUNED knobs: ${JSON.stringify(p.tunedKnobs)}`);

  // Target checks against the tuned grid.
  const t = p.tuned;
  const novBadBad = t.cells[0][0].p90ToPar; // Novice × Bad, bad round
  const expGoodGood = t.cells[3][2].p10ToPar; // Expert × Good, good round
  lines.push('\n=== TARGET CHECKS (tuned) ===');
  lines.push(`Novice+Bad bad-round (p90): ${fmt(novBadBad)} (target +3..+4)`);
  lines.push(`Expert+Good good-round (p10): ${fmt(expGoodGood)} (target -3..-4)`);
  lines.push(`Span: ${(novBadBad - expGoodGood).toFixed(1)} (target 6..7)`);
  return lines.join('\n');
}
