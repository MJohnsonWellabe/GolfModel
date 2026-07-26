/**
 * Measurement entry for `node scripts/calibrate-tour-field.mjs` (esbuild
 * bundles this and runs it in node). Per tour course it prints:
 *   - every rival's mean toPar under the LIVE simulateEntrantRound pipeline,
 *   - the bootstrapped E[best of the 10-rival field] for a single round and
 *     the suggested easing delta against the target winning score
 *     W = −3 − clamp((|expertAnchor| − 1.1) / 2.4, 0, 1),
 *   - the MAJOR arc: the top rival's mean and the field best for each of the
 *     three escalating rounds, and the 3-round winning TOTAL (owner pass 9:
 *     the leading rival should average ≈ −10 over a major), and
 *   - the identity metrics: P(top rival finishes top-3), P(a mid rival lands
 *     ranks 4–8), P(an Easy-tier rival wins), Spearman ρ(OVR, finish).
 *
 * Run it after any physics/course/form change and fold deltas into
 * src/data/courseDifficulty.ts by SUBTRACTING the printed delta from the
 * entry (easing is subtracted from the form, so a too-weak field — positive
 * delta — needs a SMALLER easing). tests/simulation/tourFieldCalibration.test.ts
 * and tourConsistency.test.ts pin the result.
 */
import { coursesFor } from '../src/data/courseRoster';
import { TOUR_RIVALS } from '../src/data/tourRivals';
import { entrantOvr, simulateEntrantRound } from '../src/systems/AiTournament';
import { majorCourseForRound } from '../src/systems/TourMajorSetup';

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
const MAJOR_EVENTS = 150; // 3× the sim cost, so a smaller (still tight) sample
const ids = Object.keys(COURSES).filter((id) => id in EXPERT_ANCHOR);
const OVR = TOUR_RIVALS.map((r) => entrantOvr(r));
const TOP = OVR.indexOf(Math.max(...OVR));
/** A "mid" rival: the one whose rating is closest to 85 (the owner's example
 *  of a golfer who should be consistently middle of the leaderboard). */
const MID = OVR.reduce((best, v, i) => (Math.abs(v - 85) < Math.abs(OVR[best] - 85) ? i : best), 0);
const EASY_IDS = TOUR_RIVALS.map((r, i) => (r.difficulty === 'Easy' ? i : -1)).filter((i) => i >= 0);

const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

/** Spearman rank correlation between rating and finishing position (1 = the
 *  board is exactly the rating order). */
function spearman(order: number[]): number {
  // order[i] = finishing rank of rival i (0 = best score)
  const n = order.length;
  const byOvr = [...Array(n).keys()].sort((a, b) => OVR[b] - OVR[a]);
  const ovrRank = Array(n).fill(0);
  byOvr.forEach((idx, rank) => (ovrRank[idx] = rank));
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (ovrRank[i] - order[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

/** One event's per-rival toPars on a given course. */
function playEvent(course: (typeof COURSES)[string], id: string, ev: number, round = 0): number[] {
  return TOUR_RIVALS.map(
    (r, i) =>
      simulateEntrantRound(
        course,
        id,
        r,
        1000 + ev * 15013 + round * 7919 + i * 104729,
        (2000 ^ 0x9e3779b9) + ev * 8191 + round * 6151 + i * 3079
      ).toPar
  );
}

for (const id of ids) {
  const course = COURSES[id];
  const perRival: number[][] = TOUR_RIVALS.map(() => []);
  const wins: number[] = [];
  const rhos: number[] = [];
  let leadTies = 0;
  let bigTies = 0;
  let topThree = 0;
  let midBand = 0;
  let easyWins = 0;

  for (let ev = 0; ev < EVENTS; ev++) {
    const toPars = playEvent(course, id, ev);
    toPars.forEach((v, i) => perRival[i].push(v));
    const best = Math.min(...toPars);
    const bestCount = toPars.filter((v) => v === best).length;
    wins.push(best);
    if (bestCount > 1) leadTies++;
    if (bestCount > 3) bigTies++;
    // Finishing order (ties broken by rating so the metric never rewards luck).
    const order = [...TOUR_RIVALS.keys()].sort((a, b) => toPars[a] - toPars[b] || OVR[b] - OVR[a]);
    const rank = Array(TOUR_RIVALS.length).fill(0);
    order.forEach((idx, r) => (rank[idx] = r));
    if (rank[TOP] <= 2) topThree++;
    if (rank[MID] >= 3 && rank[MID] <= 7) midBand++;
    if (EASY_IDS.some((i) => rank[i] === 0)) easyWins++;
    rhos.push(spearman(rank));
  }

  const anchor = EXPERT_ANCHOR[id];
  const target = -3 - Math.min(1, Math.max(0, (Math.abs(anchor) - 1.1) / 2.4));
  const eWin = mean(wins);

  // MAJOR: three escalating rounds on the materialized setup.
  const roundTop: number[][] = [[], [], []];
  const roundBest: number[][] = [[], [], []];
  const totals: number[] = [];
  const topTotals: number[] = [];
  for (let ev = 0; ev < MAJOR_EVENTS; ev++) {
    const cum = TOUR_RIVALS.map(() => 0);
    for (let r = 0; r < 3; r++) {
      const toPars = playEvent(majorCourseForRound(course, r), id, 5000 + ev, r);
      toPars.forEach((v, i) => (cum[i] += v));
      roundTop[r].push(toPars[TOP]);
      roundBest[r].push(Math.min(...toPars));
    }
    totals.push(Math.min(...cum));
    topTotals.push(cum[TOP]);
  }

  console.log(
    `${id.padEnd(14)} E[win] ${eWin.toFixed(2)}  target ${target.toFixed(2)}  ` +
      `easing-delta ${(eWin - target).toFixed(2)}  P(tie) ${(leadTies / EVENTS).toFixed(2)}  ` +
      `P(4+way) ${(bigTies / EVENTS).toFixed(2)}`
  );
  console.log(
    `${''.padEnd(14)} MAJOR win ${mean(totals).toFixed(2)} (target -10.0)  ` +
      `top total ${mean(topTotals).toFixed(2)}  arc ` +
      roundTop.map((r) => mean(r).toFixed(2)).join(' / ') +
      `  field best ` +
      roundBest.map((r) => mean(r).toFixed(2)).join(' / ')
  );
  console.log(
    `${''.padEnd(14)} IDENTITY P(top3) ${(topThree / EVENTS).toFixed(2)}  ` +
      `P(mid 4-8) ${(midBand / EVENTS).toFixed(2)}  P(easy wins) ${(easyWins / EVENTS).toFixed(3)}  ` +
      `rho ${mean(rhos).toFixed(2)}`
  );
  console.log(
    `${''.padEnd(14)} ` +
      TOUR_RIVALS.map((r, i) => `${r.id} ${OVR[i].toFixed(1)}:${mean(perRival[i]).toFixed(2)}`).join(' · ')
  );
}
console.log(
  '\nFold any easing-delta beyond ±0.3 into COURSE_FIELD_EASING by SUBTRACTING it ' +
    'from the entry. The MAJOR winning total is the primary gate (owner pass 9): ' +
    'where it and E[win] disagree, the major wins.'
);
