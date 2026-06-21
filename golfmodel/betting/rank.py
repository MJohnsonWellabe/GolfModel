"""Build the value board: every player in the field appears as a projection
(expected score + interval); rows where a round-O/U line exists also get the best
side, edge, EV and Kelly. Ranked so actionable bets float to the top, then the
sharpest projections.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .edge import ev_per_unit, kelly_fraction
from .vig import remove_vig_two_way


def value_board(summary: pd.DataFrame, sims: np.ndarray, lines: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """One row per field player. ``summary`` aligns row-for-row with ``sims`` columns."""
    from ..model.distribution import prob_over

    bcfg = cfg["betting"]
    if summary.empty:
        return pd.DataFrame()

    ou = lines[lines["market"] == "round_ou"] if ("market" in lines.columns and not lines.empty) else lines
    line_by_player = {str(r["player_id"]): r for _, r in ou.iterrows()} if not ou.empty else {}

    rows = []
    for i, prow in summary.reset_index(drop=True).iterrows():
        pid = str(prow["player_id"])
        base = {
            "player_id": pid,
            "player_name": prow["player_name"],
            "wave": prow.get("wave", ""),
            "e_score": round(float(prow["e_score"]), 2),
            "p10": round(float(prow["p10"]), 2),
            "p90": round(float(prow["p90"]), 2),
            "n_eff": round(float(prow["n_eff"]), 1),
            "has_line": False,
            "line": None, "side": "", "price": None,
            "model_prob": None, "novig_prob": None, "edge": None,
            "ev_per_unit": None, "kelly": None, "actionable": False,
        }
        ln = line_by_player.get(pid)
        if ln is not None and pd.notna(ln.get("line")):
            line = float(ln["line"])
            p_over_model = prob_over(sims[:, i], line)
            p_over_nv, _ = remove_vig_two_way(ln["over_price"], ln["under_price"], bcfg["vig_method"])
            edge_over = p_over_model - p_over_nv
            if edge_over >= -edge_over:
                side, p_model, price, edge = "Over", p_over_model, ln["over_price"], edge_over
            else:
                side, p_model, price, edge = "Under", 1 - p_over_model, ln["under_price"], -edge_over
            base.update(
                {
                    "has_line": True,
                    "line": line,
                    "side": side,
                    "price": int(price),
                    "model_prob": round(float(p_model), 4),
                    "novig_prob": round(float(p_model - edge), 4),
                    "edge": round(float(edge), 4),
                    "ev_per_unit": round(ev_per_unit(p_model, price), 4),
                    "kelly": round(kelly_fraction(p_model, price) * float(bcfg["kelly_fraction"]), 4),
                    "actionable": bool(edge >= bcfg["min_edge"] and float(prow["n_eff"]) >= bcfg["min_n_eff"]),
                }
            )
        rows.append(base)

    board = pd.DataFrame(rows)
    # Actionable bets first, then players with a line, then sharpest projection (lowest e_score).
    board["_ev_sort"] = board["ev_per_unit"].fillna(-1e9)
    board = board.sort_values(
        ["actionable", "has_line", "_ev_sort", "e_score"], ascending=[False, False, False, True]
    ).drop(columns="_ev_sort")
    return board.reset_index(drop=True)
