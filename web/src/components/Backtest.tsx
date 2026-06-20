import type { Backtest } from "../types";
import { LineChart, Reliability } from "./charts";

export function BacktestView({ backtest }: { backtest: Backtest | null }) {
  if (!backtest) return <p className="muted">No backtest yet. Run <code>make backtest</code>.</p>;
  if (!backtest.n_predictions) return <p className="muted">{backtest.note ?? "No backtestable rounds."}</p>;

  const p = backtest.prediction!;
  const ou = backtest.over_under!;
  const bet = backtest.betting_synthetic!;
  const bank = (backtest.bankroll_curve ?? []).map((d, i) => ({ x: i, y: d.bankroll }));

  return (
    <section>
      <p className="muted">
        Walk-forward over {backtest.n_predictions.toLocaleString()} predictions
        {backtest.date_range && ` (${backtest.date_range[0]} → ${backtest.date_range[1]})`}.
      </p>

      <div className="cards">
        <Card label="RMSE" value={p.rmse.toFixed(2)} sub={`naive ${p.rmse_naive.toFixed(2)}`} good={p.rmse < p.rmse_naive} />
        <Card label="MAE" value={p.mae.toFixed(2)} />
        <Card label="80% coverage" value={p.interval_coverage_80.toFixed(2)} sub="target 0.80" good={Math.abs(p.interval_coverage_80 - 0.8) < 0.05} />
        <Card label="CRPS" value={p.crps.toFixed(2)} sub="lower better" />
        <Card label="O/U Brier" value={ou.brier.toFixed(3)} sub={`vs 0.5 → ${ou["brier_baseline_0.5"].toFixed(3)}`} good={ou.brier < ou["brier_baseline_0.5"]} />
        <Card label="Synthetic ROI" value={`${(bet.roi * 100).toFixed(1)}%`} sub={`${bet.n_bets} bets · hit ${(bet.hit_rate * 100).toFixed(0)}%`} good={bet.roi > 0} />
      </div>

      <div className="detail-grid">
        <div>
          <h3>Bankroll (synthetic, flat 1u)</h3>
          <LineChart points={bank} />
        </div>
        <div>
          <h3>O/U calibration</h3>
          <Reliability data={ou.reliability} />
        </div>
      </div>

      {backtest.disclaimer && <p className="muted small">{backtest.disclaimer}</p>}
    </section>
  );
}

function Card({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className={`card ${good === undefined ? "" : good ? "good" : "bad"}`}>
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}
