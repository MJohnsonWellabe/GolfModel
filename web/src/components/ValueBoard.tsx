import { useState } from "react";
import type { Bet, ValueBoard } from "../types";

type SortKey = "ev_per_unit" | "edge" | "model_prob" | "line" | "e_score" | "n_eff";

const num = (x: number | null, digits = 2, suffix = "") =>
  x === null || x === undefined ? "—" : `${x.toFixed(digits)}${suffix}`;
const pct = (x: number | null) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(1)}%`);

export function ValueBoardView({ board, onSelect }: { board: ValueBoard; onSelect: (id: string) => void }) {
  const [sort, setSort] = useState<SortKey>("e_score");
  const [onlyActionable, setOnlyActionable] = useState(false);

  const anyLines = board.bets.some((b) => b.has_line);

  let bets: Bet[] = [...board.bets];
  if (onlyActionable) bets = bets.filter((b) => b.actionable);
  bets.sort((a, b) => {
    const av = a[sort], bv = b[sort];
    const an = av === null || av === undefined ? (sort === "e_score" ? Infinity : -Infinity) : Number(av);
    const bn = bv === null || bv === undefined ? (sort === "e_score" ? Infinity : -Infinity) : Number(bv);
    return sort === "e_score" ? an - bn : bn - an; // expected score ascending; everything else descending
  });

  return (
    <section>
      {!anyLines && (
        <div className="notice">
          No betting lines loaded — showing <strong>projections</strong> (expected score + interval).
          Capture FanDuel round O/U lines (<code>scripts/capture_lines.py</code>) to populate edges & EV.
        </div>
      )}
      <div className="controls">
        <label>
          Sort by:&nbsp;
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="e_score">Expected score</option>
            <option value="ev_per_unit">EV per unit</option>
            <option value="edge">Edge</option>
            <option value="model_prob">Model probability</option>
            <option value="line">Line</option>
            <option value="n_eff">Sample (n_eff)</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyActionable} onChange={(e) => setOnlyActionable(e.target.checked)} />
          Actionable bets only
        </label>
        <span className="muted">{bets.length} players</span>
      </div>

      <table className="board">
        <thead>
          <tr>
            <th>Golfer</th><th>Wave</th><th>E[score]</th><th>80% range</th>
            <th>Side</th><th>Line</th><th>Price</th>
            <th>Model P</th><th>Edge</th><th>EV/u</th><th>n_eff</th>
          </tr>
        </thead>
        <tbody>
          {bets.map((b) => (
            <tr key={b.player_id} className={b.actionable ? "actionable" : ""} onClick={() => onSelect(b.player_id)}>
              <td className="name">{b.player_name}</td>
              <td>{b.wave}</td>
              <td>{b.e_score.toFixed(1)}</td>
              <td className="muted">{b.p10.toFixed(1)}–{b.p90.toFixed(1)}</td>
              <td className={b.side === "Over" ? "over" : b.side === "Under" ? "under" : ""}>{b.side || "—"}</td>
              <td>{num(b.line, 1)}</td>
              <td>{b.price === null ? "—" : b.price > 0 ? `+${b.price}` : b.price}</td>
              <td>{pct(b.model_prob)}</td>
              <td className={b.edge && b.edge > 0 ? "pos" : b.edge ? "neg" : ""}>{pct(b.edge)}</td>
              <td className={b.ev_per_unit && b.ev_per_unit > 0 ? "pos" : b.ev_per_unit ? "neg" : ""}>{num(b.ev_per_unit, 3)}</td>
              <td>{b.n_eff.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Click a row for the golfer's rating, course history, weather and predicted score distribution.</p>
    </section>
  );
}
