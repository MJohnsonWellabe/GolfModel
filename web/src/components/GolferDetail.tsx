import { useEffect, useState } from "react";
import { fetchJSON } from "../api";
import type { Golfer } from "../types";
import { Histogram } from "./charts";

export function GolferDetail({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const [g, setG] = useState<Golfer | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setG(null);
    fetchJSON<Golfer>(`golfers/${playerId}.json`).then(setG).catch((e) => setErr(String(e)));
  }, [playerId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>✕</button>
        {err && <p className="error">{err}</p>}
        {!g ? (
          <p className="muted">Loading…</p>
        ) : (
          <div>
            <h2>{g.player_name} <span className="muted">· wave {g.wave}</span></h2>

            <div className="detail-grid">
              <div>
                <h3>Strokes-gained profile</h3>
                <table className="mini">
                  <tbody>
                    {Object.entries(g.sg_profile).map(([k, v]) => (
                      <tr key={k}><td>{k.replace("sg_", "SG ").toUpperCase()}</td><td className={v >= 0 ? "pos" : "neg"}>{v.toFixed(2)}</td></tr>
                    ))}
                  </tbody>
                </table>
                <h3>Course-fit weights</h3>
                <table className="mini">
                  <tbody>
                    {Object.entries(g.course_fit).map(([k, v]) => (
                      <tr key={k}><td>{k.replace("sg_", "SG ").toUpperCase()}</td><td>{v.toFixed(2)}×</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h3>Predicted single-round score</h3>
                <p className="big">
                  {g.expected.e_score.toFixed(1)} <span className="muted">± {g.expected.sd.toFixed(1)}</span>
                </p>
                <p className="muted">80% interval: {g.expected.p10.toFixed(1)} – {g.expected.p90.toFixed(1)}</p>
                <Histogram
                  counts={g.distribution.counts}
                  edges={g.distribution.edges}
                  markers={[
                    ...(g.line && typeof g.line.line === "number"
                      ? [{ value: g.line.line as number, label: `line ${(g.line.line as number).toFixed(1)}`, color: "#c0392b" }]
                      : []),
                    { value: g.expected.e_score, label: "E[score]", color: "#2e7d32" },
                  ]}
                />
                {g.bet && (
                  <p className="betline">
                    Model side: <strong className={g.bet.side === "Over" ? "over" : "under"}>{g.bet.side} {g.bet.line.toFixed(1)}</strong>
                    {" "}@ {g.bet.price > 0 ? `+${g.bet.price}` : g.bet.price} ·
                    edge <span className={g.bet.edge > 0 ? "pos" : "neg"}>{(g.bet.edge * 100).toFixed(1)}%</span> ·
                    EV {g.bet.ev_per_unit.toFixed(3)}
                  </p>
                )}
              </div>
            </div>

            <h3>Recent rounds</h3>
            <table className="mini wide">
              <thead><tr><th>Date</th><th>Course</th><th>Rd</th><th>To par</th><th>SG total</th></tr></thead>
              <tbody>
                {g.recent_rounds.map((r, i) => (
                  <tr key={i}>
                    <td>{String(r.date).slice(0, 10)}</td>
                    <td>{r.course_id}</td>
                    <td>{r.round_num}</td>
                    <td className={r.to_par <= 0 ? "pos" : "neg"}>{r.to_par > 0 ? "+" : ""}{r.to_par}</td>
                    <td className={r.sg_total >= 0 ? "pos" : "neg"}>{r.sg_total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
