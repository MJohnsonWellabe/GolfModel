"""Build the value board: join model probabilities to lines, pick the best side,
compute edge/EV, apply sanity filters, and rank.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .edge import ev_per_unit, kelly_fraction
from .vig import remove_vig_two_way


def value_board(
    summary: pd.DataFrame,
    sims: np.ndarray,
    lines: pd.DataFrame,
    cfg: dict,
) -> pd.DataFrame:
    """One row per actionable round-O/U bet, ranked by EV (best first).

    ``summary`` must align row-for-row with ``sims`` columns (same player order).
    """
    from ..model.distribution import prob_over

    bcfg = cfg["betting"]
    idx = {pid: i for i, pid in enumerate(summary["player_id"])}
    ou = lines[lines["market"] == "round_ou"] if "market" in lines.columns else lines

    rows = []
    for _, ln in ou.iterrows():
        pid = ln["player_id"]
        if pid not in idx:
            continue
        i = idx[pid]
        prow = summary.iloc[i]
        line = float(ln["line"])
        p_over_model = prob_over(sims[:, i], line)

        p_over_nv, _ = remove_vig_two_way(ln["over_price"], ln["under_price"], bcfg["vig_method"])
        edge_over = p_over_model - p_over_nv
        edge_under = -edge_over

        if edge_over >= edge_under:
            side, p_model, price, edge = "Over", p_over_model, ln["over_price"], edge_over
        else:
            side, p_model, price, edge = "Under", 1 - p_over_model, ln["under_price"], edge_under

        rows.append(
            {
                "player_id": pid,
                "player_name": prow["player_name"],
                "wave": prow.get("wave", ""),
                "line": line,
                "side": side,
                "price": int(price),
                "model_prob": round(float(p_model), 4),
                "novig_prob": round(float(p_model - edge), 4),
                "edge": round(float(edge), 4),
                "ev_per_unit": round(ev_per_unit(p_model, price), 4),
                "kelly": round(kelly_fraction(p_model, price) * float(bcfg["kelly_fraction"]), 4),
                "e_score": round(float(prow["e_score"]), 2),
                "n_eff": round(float(prow["n_eff"]), 1),
            }
        )

    board = pd.DataFrame(rows)
    if board.empty:
        return board
    board["actionable"] = (board["edge"] >= bcfg["min_edge"]) & (board["n_eff"] >= bcfg["min_n_eff"])
    return board.sort_values(["actionable", "ev_per_unit"], ascending=[False, False]).reset_index(drop=True)
