/**
 * Measurement entry for `node scripts/calibrate-tour-field.mjs` (esbuild
 * bundles this and runs it in node). Prints, per tour course:
 *   - each tier's mean toPar under the LIVE simulateEntrantRound pipeline,
 *   - the bootstrapped E[best of the 10-rival field], tie odds, and
 *   - the suggested easing delta against the target winning score
 *     W = −3 − clamp((|expertAnchor| − 1.1) / 2.4, 0, 1).
 * Run it after any physics/course change and fold deltas into
 * src/data/courseDifficulty.ts (tests/simulation/tourFieldCalibration.test.ts
 * pins the result).
 */
import { coursesFor } from '../src/data/courseRoster';
import { TOUR_RIVALS } from '../src/data/tourRivals';
import { simulateEntrantRound } from '../src/systems/AiTournament';

const COURSES = coursesFor({ newCourses: true, courseRebuilds: true });

/** Expert-modeled-human mean toPar per course — the difficultyAnchors
 *  measurement (veteran + Expert sigma, bounded, calibration wind). Re-derive
 *  from tests/simulation/difficultyAnchors.test.ts if courses change. */
const EXPERT_ANCHOR: Record<string, number> = {
  wildwood: -1.13,
  wildvalley: -1.35,
  timberline: -1.77,
  sablebay: -1.93,
  portjohnson: -2.65,
  maplevale: -3.25,
  redhollow: -3.45,
  timberlinewest: -1.2
};

const EVENTS = 400; // bootstrapped events per course
const ids = Object.keys(COURSES).filter((id) => id in EXPERT_ANCHOR);

for (const id of ids) {
  const course = COURSES[id];
  const wins: number[] = [];
  const tierSum: Record<string, { s: number; n: number }> = {};
  let leadTies = 0;
  let bigTies = 0;
  for (let ev = 0; ev < EVENTS; ev++) {
    let best = Infinity;
    let bestCount = 0;
    TOUR_RIVALS.forEach((r, i) => {
      const res = simulateEntrantRound(
        course,
        id,
        r,
        r.difficulty,
        1000 + ev * 15013 + i * 104729,
        (2000 ^ 0x9e3779b9) + ev * 8191 + i * 3079
      );
      const t = tierSum[r.difficulty] ?? (tierSum[r.difficulty] = { s: 0, n: 0 });
      t.s += res.toPar;
      t.n += 1;
      if (res.toPar < best) {
        best = res.toPar;
        bestCount = 1;
      } else if (res.toPar === best) bestCount++;
    });
    wins.push(best);
    if (bestCount > 1) leadTies++;
    if (bestCount > 3) bigTies++;
  }
  const mean = wins.reduce((a, b) => a + b, 0) / wins.length;
  const anchor = EXPERT_ANCHOR[id];
  const target = -3 - Math.min(1, Math.max(0, (Math.abs(anchor) - 1.1) / 2.4));
  const tiers = Object.entries(tierSum)
    .map(([k, v]) => `${k} ${(v.s / v.n).toFixed(2)}`)
    .join(' · ');
  console.log(
    `${id.padEnd(14)} E[win] ${mean.toFixed(2)}  target ${target.toFixed(2)}  ` +
      `easing-delta ${(mean - target).toFixed(2)}  P(tie) ${(leadTies / EVENTS).toFixed(2)}  ` +
      `P(4+way) ${(bigTies / EVENTS).toFixed(2)}  | ${tiers}`
  );
}
console.log(
  '\nFold any easing-delta beyond ±0.3 into COURSE_FIELD_EASING by SUBTRACTING it ' +
    'from the entry (easing is subtracted from the form shift, so a too-weak field ' +
    '— positive delta — needs a smaller easing).'
);
