"""Exponential time-decay aggregation of per-round strokes-gained."""
from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd

from ..data.schemas import SG_CATEGORIES


def decay_weights(dates: pd.Series, asof: datetime, halflife_days: float, max_age_days: float) -> np.ndarray:
    """Half-life exponential weights; rounds older than max_age get weight 0."""
    age = (pd.Timestamp(asof) - pd.to_datetime(dates)).dt.total_seconds() / 86400.0
    age_arr = age.to_numpy()
    w = np.power(0.5, age_arr / float(halflife_days))
    w = np.where(age_arr > float(max_age_days), 0.0, w)
    # Mirror the strict as-of firewall: never weight rows at/after the cutoff.
    w = np.where(age_arr <= 0, 0.0, w)
    return w.astype(float)


def decayed_player_table(
    rounds: pd.DataFrame,
    asof: datetime,
    halflife_days: float,
    max_age_days: float,
    extra_weight: pd.Series | None = None,
) -> pd.DataFrame:
    """Per-player decay-weighted mean SG by category + effective sample + score SD.

    ``extra_weight`` (indexed like ``rounds``) optionally multiplies the decay
    weights — used by the similar-field re-weighting.
    """
    if rounds.empty:
        return pd.DataFrame(columns=["player_id", "player_name", "n_eff", "score_sd_raw", *SG_CATEGORIES])

    df = rounds.copy()
    w = decay_weights(df["date"], asof, halflife_days, max_age_days)
    if extra_weight is not None:
        w = w * extra_weight.reindex(df.index).fillna(1.0).to_numpy()
    df["_w"] = w

    out = []
    for pid, grp in df.groupby("player_id"):
        wt = grp["_w"].to_numpy()
        tot = wt.sum()
        if tot <= 0:
            continue
        rec = {
            "player_id": pid,
            "player_name": grp["player_name"].iloc[0],
            "n_eff": float(tot),
        }
        for c in SG_CATEGORIES:
            rec[c] = float(np.average(grp[c].to_numpy(), weights=wt))
        # Consistency proxy: weighted SD of to_par around the player's weighted mean.
        tp = grp["to_par"].to_numpy()
        mean_tp = np.average(tp, weights=wt)
        var = np.average((tp - mean_tp) ** 2, weights=wt)
        rec["score_sd_raw"] = float(np.sqrt(max(var, 1e-6)))
        out.append(rec)
    return pd.DataFrame(out)
