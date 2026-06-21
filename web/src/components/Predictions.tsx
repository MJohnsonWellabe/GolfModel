import { useState } from "react";
import type { Prediction, Predictions } from "../types";

type SortKey = "e_score" | "e_to_par" | "sd" | "n_eff";

export function PredictionsView({ data, onSelect }: { data: Predictions; onSelect: (id: string) => void }) {
  const [sort, setSort] = useState<SortKey>("e_score");

  const rows: Prediction[] = [...data.predictions].sort((a, b) =>
    sort === "n_eff" ? b.n_eff - a.n_eff : Number(a[sort]) - Number(b[sort])
  );

  return (
    <section>
      <p className="muted">
        Predicted single-round scores for <strong>{data.course_name}</strong> R{data.round_num} (par {data.par}),
        ranked best to worst. Click a golfer for their rating, course history and score distribution.
      </p>
      <div className="controls">
        <label>
          Sort by:&nbsp;
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="e_score">Expected score</option>
            <option value="e_to_par">Expected to par</option>
            <option value="sd">Volatility (SD)</option>
            <option value="n_eff">Sample (n_eff)</option>
          </select>
        </label>
        <span className="muted">{rows.length} players</span>
      </div>

      <table className="board">
        <thead>
          <tr>
            <th>#</th><th>Golfer</th><th>Wave</th><th>E[score]</th><th>To par</th>
            <th>80% range</th><th>SD</th><th>n_eff</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.player_id} onClick={() => onSelect(p.player_id)}>
              <td className="muted">{i + 1}</td>
              <td className="name">{p.player_name}</td>
              <td>{p.wave}</td>
              <td><strong>{p.e_score.toFixed(1)}</strong></td>
              <td className={p.e_to_par <= 0 ? "pos" : "neg"}>{p.e_to_par > 0 ? "+" : ""}{p.e_to_par.toFixed(1)}</td>
              <td className="muted">{p.p10.toFixed(1)}–{p.p90.toFixed(1)}</td>
              <td>{p.sd.toFixed(1)}</td>
              <td>{p.n_eff.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
