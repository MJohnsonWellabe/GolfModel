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

// CALIBRATION WIND (Step 1): the sim models a realistic light "typical round"
// instead of the course fallback of a constant 2..20mph breeze on every hole.
// That fallback overstated wind by ~1 stroke and fattened the tails, running the
// sim harder & wider than the owner's real play; a light band reproduces the
// owner's ground truth (Expert+good ≈ −2/−3, bad round ≈ even = unpunishing).
const CAL_WIND = {
  windMin: Number(process.env.CAL_WMIN ?? 1),
  windMax: Number(process.env.CAL_WMAX ?? 8)
};

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
  // Ball-striking dispersion levers (Step 2 — spread lives tee-to-green).
  dispGood: number; // dispersionQualityMult.good  (lateral residual, good click)
  dispMiss: number; // dispersionQualityMult.miss  (lateral residual, miss click)
  carryGood: number; // carryNoiseQualityMult.good  (depth 1σ, good power click)
  carryMiss: number; // carryNoiseQualityMult.miss  (depth 1σ, miss power click)
  golferErrBase: number; // errFactor base
  golferErrGain: number; // errFactor per-(100−accuracy) gain
}

// BASELINE = the shipped constants (linear accuracy, current dispersion + putt
// forgiveness) — the reference the tuned curve is compared against. Now run at
// the calibrated wind so it reproduces the owner's real −2/−3 expert round.
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
  putterErrorDiv: 2.4,
  dispGood: 2.4,
  dispMiss: 6,
  carryGood: 2,
  carryMiss: 3.2,
  golferErrBase: 0.4,
  golferErrGain: 1.2
};

// TUNED = the Step-2 re-tune (mirrors src/config.ts once landed). Env vars
// override for iteration; the defaults below are the LANDED values so the
// dashboard shows the real tuned grid with no env set.
const TUNED: KnobSet = {
  perfectBandMin: Number(process.env.K_pbmin ?? 0.005),
  perfectBandMax: Number(process.env.K_pbmax ?? 0.018),
  goodBandMin: Number(process.env.K_gbmin ?? 0.055),
  goodBand: Number(process.env.K_gb ?? 0.09),
  accuracyCurveExp: Number(process.env.K_aexp ?? 1.6),
  accuracyCurveGain: Number(process.env.K_again ?? 1.3),
  powerShortExp: Number(process.env.K_pse ?? 1.5),
  puttPacePerfect: Number(process.env.K_ppp ?? 1),
  puttPaceGood: Number(process.env.K_ppg ?? 3),
  puttPaceMiss: Number(process.env.K_ppm ?? 6),
  puttPaceNoise: Number(process.env.K_ppn ?? 0.055),
  puttPaceGrowPx: Number(process.env.K_ppgrow ?? 70),
  putterErrorDiv: Number(process.env.K_ped ?? 2.4),
  dispGood: Number(process.env.K_dg ?? 3.6),
  dispMiss: Number(process.env.K_dm ?? 7.5),
  carryGood: Number(process.env.K_cg ?? 2.8),
  carryMiss: Number(process.env.K_cm ?? 3.8),
  golferErrBase: Number(process.env.K_geb ?? 0.35),
  golferErrGain: Number(process.env.K_geg ?? 1.5)
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
  (p.dispersionQualityMult as Record<string, number>).good = k.dispGood;
  (p.dispersionQualityMult as Record<string, number>).miss = k.dispMiss;
  (p.carryNoiseQualityMult as Record<string, number>).good = k.carryGood;
  (p.carryNoiseQualityMult as Record<string, number>).miss = k.carryMiss;
  p.golferErrBase = k.golferErrBase;
  p.golferErrGain = k.golferErrGain;
}

function run(k: KnobSet): GridResult {
  apply(k);
  return runGrid(COURSES, {
    roundsPerCourse: ROUNDS,
    seedBase: 900_000,
    windMin: CAL_WIND.windMin,
    windMax: CAL_WIND.windMax
  });
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
        putterErrorDiv: PHYSICS.putterErrorDiv,
        dispGood: PHYSICS.dispersionQualityMult.good,
        dispMiss: PHYSICS.dispersionQualityMult.miss,
        carryGood: PHYSICS.carryNoiseQualityMult.good,
        carryMiss: PHYSICS.carryNoiseQualityMult.miss,
        golferErrBase: PHYSICS.golferErrBase,
        golferErrGain: PHYSICS.golferErrGain
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
    lines.push('--- FIR % (fairways hit) ---');
    for (let ui = 0; ui < g.users.length; ui++) {
      const cols = g.cells[ui].map((c) => (Number.isNaN(c.meanFir) ? '--' : c.meanFir.toFixed(0)));
      lines.push([g.users[ui].name, ...cols].join('\t'));
    }
    lines.push('--- GIR % (greens in regulation) ---');
    for (let ui = 0; ui < g.users.length; ui++) {
      const cols = g.cells[ui].map((c) => c.meanGir.toFixed(0));
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
