import { useState } from "react";
import type { Bet, ValueBoard } from "../types";

type SortKey = "ev_per_unit" | "edge" | "model_prob" | "line" | "e_score" | "n_eff";

export function ValueBoardView({ board, onSelect }: { board: ValueBoard; onSelect: (id: string) => void }) {
  const [sort, setSort] = useState<SortKey>("ev_per_unit");
  const [onlyActionable, setOnlyActionable] = useState(false);

  let bets: Bet[] = [...board.bets];
  if (onlyActionable) bets = bets.filter((b) => b.actionable);
  bets.sort((a, b) => Number(b[sort]) - Number(a[sort]));

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  return (
    <section>
      <div className="controls">
        <label>
          Sort by:&nbsp;
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="ev_per_unit">EV per unit</option>
            <option value="edge">Edge</option>
            <option value="model_prob">Model probability</option>
            <option value="line">Line</option>
            <option value="e_score">Expected score</option>
            <option value="n_eff">Sample (n_eff)</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyActionable} onChange={(e) => setOnlyActionable(e.target.checked)} />
          Actionable only
        </label>
        <span className="muted">{bets.length} rows</span>
      </div>

      <table className="board">
        <thead>
          <tr>
            <th>Golfer</th><th>Wave</th><th>Side</th><th>Line</th><th>Price</th>
            <th>Model P</th><th>No-vig P</th><th>Edge</th><th>EV/u</th><th>¼-Kelly</th><th>E[score]</th><th>n_eff</th>
          </tr>
        </thead>
        <tbody>
          {bets.map((b) => (
            <tr key={b.player_id} className={b.actionable ? "actionable" : ""} onClick={() => onSelect(b.player_id)}>
              <td className="name">{b.player_name}</td>
              <td>{b.wave}</td>
              <td className={b.side === "Over" ? "over" : "under"}>{b.side}</td>
              <td>{b.line.toFixed(1)}</td>
              <td>{b.price > 0 ? `+${b.price}` : b.price}</td>
              <td>{pct(b.model_prob)}</td>
              <td>{pct(b.novig_prob)}</td>
              <td className={b.edge > 0 ? "pos" : "neg"}>{pct(b.edge)}</td>
              <td className={b.ev_per_unit > 0 ? "pos" : "neg"}>{b.ev_per_unit.toFixed(3)}</td>
              <td>{(b.kelly * 100).toFixed(1)}%</td>
              <td>{b.e_score.toFixed(1)}</td>
              <td>{b.n_eff.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Click a row for the golfer's strokes-gained profile, course fit, weather and predicted score distribution.</p>
    </section>
  );
}
