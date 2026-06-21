import type { Backtest } from "../types";
import { Histogram, Scatter } from "./charts";

export function BacktestView({ backtest }: { backtest: Backtest | null }) {
  if (!backtest) return <p className="muted">No backtest yet. Run <code>make backtest</code>.</p>;
  if (!backtest.n_predictions || !backtest.headline)
    return <p className="muted">{backtest.note ?? "No backtestable rounds."}</p>;

  const h = backtest.headline;
  const scatter = backtest.scatter ?? [];
  const lo = Math.min(...scatter.map((p) => Math.min(p.pred, p.actual)), 60);
  const hi = Math.max(...scatter.map((p) => Math.max(p.pred, p.actual)), 80);

  return (
    <section>
      <p className="muted">
        Walk-forward test on <strong>{backtest.test_year ?? "all"}</strong> rounds — for each round the model
        is rebuilt from data <em>before</em> that round, then compared to the score that actually happened.
        {backtest.date_range && ` ${backtest.date_range[0]} → ${backtest.date_range[1]}.`}{" "}
        {backtest.n_predictions.toLocaleString()} predictions over {backtest.n_rounds ?? "?"} rounds.
      </p>

      <div className="cards">
        <Card label="RMSE" value={h.rmse.toFixed(2)} sub={`naive ${h.rmse_naive.toFixed(2)}`} good={h.rmse < h.rmse_naive} />
        <Card label="vs naive" value={`${h.improvement_vs_naive_pct > 0 ? "+" : ""}${h.improvement_vs_naive_pct}%`} sub="lower RMSE" good={h.improvement_vs_naive_pct > 0} />
        <Card label="MAE" value={h.mae.toFixed(2)} sub={`naive ${h.mae_naive.toFixed(2)}`} good={h.mae < h.mae_naive} />
        <Card label="80% coverage" value={h.interval_coverage_80.toFixed(2)} sub="target 0.80" good={Math.abs(h.interval_coverage_80 - 0.8) < 0.05} />
        <Card label="CRPS" value={h.crps.toFixed(2)} sub="lower better" />
        <Card label="Mean score" value={h.mean_pred.toFixed(1)} sub={`actual ${h.mean_actual.toFixed(1)}`} good={Math.abs(h.mean_pred - h.mean_actual) < 0.3} />
      </div>

      <div className="detail-grid">
        <div>
          <h3>Predicted vs actual</h3>
          <Scatter points={scatter} min={lo} max={hi} />
          <p className="muted small">Each point is one golfer-round. The dashed line is a perfect prediction.</p>
        </div>
        <div>
          <h3>Prediction error (pred − actual)</h3>
          {backtest.error_hist && <Histogram counts={backtest.error_hist.counts} edges={backtest.error_hist.edges} markers={[{ value: 0, label: "0", color: "#2e7d32" }]} />}
          <h3>By round</h3>
          <table className="mini wide">
            <thead><tr><th>Round</th><th>n</th><th>RMSE</th></tr></thead>
            <tbody>
              {(backtest.by_round ?? []).map((r) => (
                <tr key={r.round}><td>R{r.round}</td><td>{r.n}</td><td>{r.rmse.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {backtest.examples && (
        <div className="detail-grid">
          <ExampleTable title="Closest predictions" rows={backtest.examples.best} />
          <ExampleTable title="Biggest misses" rows={backtest.examples.worst} />
        </div>
      )}

      {backtest.by_event && backtest.by_event.length > 0 && (
        <>
          <h3>By event</h3>
          <table className="mini wide">
            <thead><tr><th>Date</th><th>Event</th><th>n</th><th>RMSE</th><th>naive</th></tr></thead>
            <tbody>
              {backtest.by_event.map((e, i) => (
                <tr key={i}>
                  <td>{e.date}</td><td>{e.event}</td><td>{e.n}</td>
                  <td className={e.rmse < e.rmse_naive ? "pos" : "neg"}>{e.rmse.toFixed(2)}</td>
                  <td className="muted">{e.rmse_naive.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function ExampleTable({ title, rows }: { title: string; rows: { player: string; event: string; round: number; pred: number; actual: number }[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <table className="mini wide">
        <thead><tr><th>Player</th><th>Event</th><th>Rd</th><th>Pred</th><th>Actual</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.player}</td><td className="muted">{r.event}</td><td>R{r.round}</td>
              <td>{r.pred.toFixed(1)}</td><td>{r.actual.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
