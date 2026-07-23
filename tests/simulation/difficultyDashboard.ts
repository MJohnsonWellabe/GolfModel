import { CellStats, GolferTier, GridResult, UserTier } from '../../src/systems/SkillSimulator';

/**
 * Self-contained HTML difficulty dashboard: a user×golfer grid of median toPar
 * with the good-round(p10)/bad-round(p90) spread, FIR/GIR/putts, and the swing
 * band mix — rendered for BOTH the baseline and the tuned constants so the lead
 * can compare side by side. No external assets (inline CSS only).
 */

export interface DashboardPayload {
  rounds: number;
  courses: number;
  users: UserTier[];
  golfers: GolferTier[];
  baselineKnobs: Record<string, number>;
  tunedKnobs: Record<string, number>;
  baseline: GridResult;
  tuned: GridResult;
}

function sign(n: number, d = 1): string {
  return (n >= 0 ? '+' : '') + n.toFixed(d);
}

/** Diverging color for a toPar value: green (under) → grey (even) → red (over). */
function scoreColor(toPar: number): string {
  // Map roughly [-5 .. +6] onto the scale.
  const t = Math.max(-1, Math.min(1, toPar / 5));
  if (t < 0) {
    // under par: grey→green
    const g = Math.round(120 + -t * 90);
    const other = Math.round(90 + t * 30);
    return `rgb(${other}, ${g}, ${Math.round(90 + t * 20)})`;
  }
  const r = Math.round(120 + t * 110);
  const other = Math.round(120 - t * 70);
  return `rgb(${r}, ${other}, ${other})`;
}

function cellHtml(c: CellStats): string {
  const bg = scoreColor(c.medianToPar);
  const band = c.band;
  const pb = c.puttBand;
  return `<td style="background:${bg}">
    <div class="med">${sign(c.medianToPar)}</div>
    <div class="spread"><span class="good">${sign(c.p10ToPar)}</span> / <span class="bad">${sign(c.p90ToPar)}</span></div>
    <div class="sub">FIR ${Number.isNaN(c.meanFir) ? '–' : c.meanFir.toFixed(0)} · GIR ${c.meanGir.toFixed(0)} · ${c.meanPutts.toFixed(2)} p/h</div>
    <div class="mix">swing ${(100 * band.perfect).toFixed(0)}/${(100 * band.good).toFixed(0)}/${(100 * band.miss).toFixed(0)} · putt ${(100 * pb.perfect).toFixed(0)}/${(100 * pb.good).toFixed(0)}/${(100 * pb.miss).toFixed(0)}</div>
  </td>`;
}

function gridTable(g: GridResult): string {
  const head = ['<th>user \\ golfer</th>', ...g.golfers.map((x) => `<th>${x.name}<br><span class="stat">stat ${x.stat}</span></th>`)].join('');
  const rows = g.users
    .map((u: UserTier, ui: number) => {
      const cells = g.cells[ui].map((c) => cellHtml(c)).join('');
      return `<tr><th class="rowh">${u.name}<br><span class="stat">σ ${u.sigmaPower}</span></th>${cells}</tr>`;
    })
    .join('');
  return `<table class="grid"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function puttsTable(g: GridResult): string {
  const head = ['<th>user \\ golfer</th>', ...g.golfers.map((x) => `<th>${x.name}</th>`)].join('');
  const rows = g.users
    .map((u, ui) => {
      const cells = g.cells[ui]
        .map((c) => {
          const v = c.meanPutts;
          const tourish = v <= 1.85 && v >= 1.55;
          return `<td class="${tourish ? 'tour' : ''}">${v.toFixed(2)}<div class="pp">${c.meanOnePuttPct.toFixed(0)}%1p · ${c.meanThreePuttPct.toFixed(0)}%3p</div></td>`;
        })
        .join('');
      return `<tr><th class="rowh">${u.name}</th>${cells}</tr>`;
    })
    .join('');
  return `<table class="grid putts"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function targetChecks(t: GridResult): string {
  const novBadBad = t.cells[0][0].p90ToPar;
  const expGoodGood = t.cells[3][2].p10ToPar;
  const span = novBadBad - expGoodGood;
  const chk = (ok: boolean): string => (ok ? '<span class="ok">✓</span>' : '<span class="no">✗</span>');
  // monotonic checks on median
  let userMono = true;
  let golferMono = true;
  let luckMono = true;
  for (let gi = 0; gi < t.golfers.length; gi++) {
    for (let ui = 1; ui < t.users.length; ui++) {
      if (t.cells[ui][gi].medianToPar > t.cells[ui - 1][gi].medianToPar + 0.05) userMono = false;
    }
  }
  for (let ui = 0; ui < t.users.length; ui++) {
    for (let gi = 1; gi < t.golfers.length; gi++) {
      if (t.cells[ui][gi].medianToPar > t.cells[ui][gi - 1].medianToPar + 0.05) golferMono = false;
    }
    for (let gi = 0; gi < t.golfers.length; gi++) {
      if (t.cells[ui][gi].p10ToPar > t.cells[ui][gi].medianToPar + 0.001) luckMono = false;
      if (t.cells[ui][gi].medianToPar > t.cells[ui][gi].p90ToPar + 0.001) luckMono = false;
    }
  }
  return `<ul class="targets">
    <li>${chk(novBadBad >= 2.5 && novBadBad <= 4.5)} Novice+Bad bad round (p90) = <b>${sign(novBadBad)}</b> <span class="tgt">target +3..+4</span></li>
    <li>${chk(expGoodGood <= -2.5 && expGoodGood >= -4.5)} Expert+Good good round (p10) = <b>${sign(expGoodGood)}</b> <span class="tgt">target −3..−4</span></li>
    <li>${chk(span >= 5.5 && span <= 7.5)} End-to-end span = <b>${span.toFixed(1)}</b> <span class="tgt">target 6..7</span></li>
    <li>${chk(userMono)} monotonic in USER skill (novice→expert)</li>
    <li>${chk(golferMono)} monotonic in GOLFER skill (bad→good)</li>
    <li>${chk(luckMono)} monotonic in ROUND luck (good p10 ≤ median ≤ bad p90)</li>
  </ul>`;
}

function knobsTable(base: Record<string, number>, tuned: Record<string, number>): string {
  const keys = Object.keys(base);
  const rows = keys
    .map((k) => {
      const changed = base[k] !== tuned[k];
      return `<tr class="${changed ? 'chg' : ''}"><td>${k}</td><td>${base[k]}</td><td>${tuned[k]}</td></tr>`;
    })
    .join('');
  return `<table class="knobs"><thead><tr><th>knob</th><th>baseline</th><th>tuned</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function buildDashboard(p: DashboardPayload): string {
  const style = `
  <style>
    :root { color-scheme: light dark; }
    body { font: 14px/1.4 -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; background: #f7f8f7; color: #14201a; }
    @media (prefers-color-scheme: dark) { body { background: #10140f; color: #e8efe4; } }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 18px; margin: 28px 0 8px; }
    .meta { opacity: 0.7; font-size: 13px; margin-bottom: 8px; }
    .wrap { overflow-x: auto; }
    table.grid { border-collapse: collapse; margin: 6px 0 4px; }
    table.grid th, table.grid td { border: 1px solid rgba(128,128,128,0.35); padding: 8px 10px; text-align: center; vertical-align: top; }
    table.grid thead th { background: rgba(128,128,128,0.14); }
    th.rowh { text-align: left; background: rgba(128,128,128,0.10); white-space: nowrap; }
    .stat { font-weight: 400; opacity: 0.6; font-size: 11px; }
    td .med { font-size: 20px; font-weight: 700; color: #101510; }
    td .spread { font-size: 12px; color: #1c241c; }
    td .spread .good { font-weight: 700; }
    td .spread .bad { font-weight: 700; }
    td .sub { font-size: 11px; color: #26301f; margin-top: 3px; }
    td .mix { font-size: 10px; color: #33402c; opacity: 0.85; margin-top: 2px; }
    table.putts td { min-width: 62px; font-weight: 600; }
    table.putts td.tour { outline: 2px solid #2e8b57; }
    table.putts .pp { font-size: 10px; font-weight: 400; opacity: 0.7; margin-top: 2px; }
    .note { font-size: 13px; background: rgba(255,190,60,0.14); border-left: 3px solid #d9a300; padding: 8px 12px; margin: 10px 0; border-radius: 3px; max-width: 900px; }
    ul.targets { list-style: none; padding: 0; font-size: 15px; }
    ul.targets li { margin: 4px 0; }
    .ok { color: #2e8b57; font-weight: 700; }
    .no { color: #c0392b; font-weight: 700; }
    .tgt { opacity: 0.6; font-size: 12px; }
    table.knobs { border-collapse: collapse; font-size: 13px; }
    table.knobs th, table.knobs td { border: 1px solid rgba(128,128,128,0.35); padding: 4px 10px; text-align: right; }
    table.knobs td:first-child { text-align: left; }
    table.knobs tr.chg { background: rgba(255,200,0,0.18); font-weight: 600; }
    .legend { font-size: 12px; opacity: 0.75; margin: 4px 0 12px; }
    .cols { display: flex; gap: 40px; flex-wrap: wrap; }
  </style>`;

  return `${style}
  <h1>Golf difficulty calibration — swing curve grid</h1>
  <div class="meta">${p.rounds} rounds / course / cell · ${p.courses} courses · ${p.rounds * p.courses} rounds per cell · seeded (mulberry32). Each cell: <b>median toPar</b>, then <span>good-round p10 / bad-round p90</span>, FIR/GIR/putts-per-hole, and the swing/putt band mix (perfect/good/miss %).</div>

  <h2>Target checks (tuned)</h2>
  ${targetChecks(p.tuned)}

  <div class="cols">
    <div>
      <h2>Constants</h2>
      ${knobsTable(p.baselineKnobs, p.tunedKnobs)}
    </div>
  </div>

  <h2>TUNED grid — median toPar [good p10 / bad p90]</h2>
  <div class="legend">Green = under par, red = over par. Rows worsen top→bottom by user skill; columns improve left→right by golfer skill.</div>
  <div class="wrap">${gridTable(p.tuned)}</div>
  <h3>TUNED putts / hole <span class="stat">(green outline = tour-ish 1.55–1.85; sub-line = one-putt% · three-putt%)</span></h3>
  <div class="wrap">${puttsTable(p.tuned)}</div>
  <div class="note"><b>The spread lives in ball-striking, not putts.</b> GIR ranges from ~44% (Novice+Bad) to ~86% (Expert+Good) — weak users AND weak golfers genuinely miss greens, turning poor ball-striking into scrambles and recoveries. Putting stays near tour and is a <i>secondary</i> contributor (Good user ~1.6, Expert ~1.4 putts/hole), left at the shipped forgiveness (1/3/6). The Step-2 levers were the DISPERSION terms (dispersionQualityMult 2.4/6→3.6/7.5, carryNoiseQualityMult 2/3.2→2.8/3.8, golferErrGain 1.2→1.5) plus a smaller perfect zone (0.008/0.026→0.005/0.018) and a harsher convex accuracy curve (exp 1→1.6, gain 1→1.3). <b>Calibration (Step 1):</b> both grids run at a realistic light wind (CAL_WIND, default 1–8mph) with the recalibrated σ ladder — the instrument's old uniform 2–20mph-every-hole plus a loose "Expert" σ ran the sim ~1 stroke harder and wider than the owner's real −2/−3. <b>Known tension:</b> the corner-to-corner span (Novice+Bad bad-round vs Expert+Good good-round) reads ~9 because weak players missing greens on Wildwood's water (a course property, out of scope) fattens their bad-round tail; the median skill span is ~5 and the typical span ~6–7.</div>

  <h2>BASELINE grid (current shipped constants) — median toPar [p10 / p90]</h2>
  <div class="wrap">${gridTable(p.baseline)}</div>
  <h3>BASELINE putts / hole</h3>
  <div class="wrap">${puttsTable(p.baseline)}</div>
  `;
}
