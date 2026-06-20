"""Exponential time-decay aggregation of per-round values (score-based)."""
from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd


def decay_weights(dates: pd.Series, asof: datetime, halflife_days: float, max_age_days: float) -> np.ndarray:
    """Half-life exponential weights; rounds older than max_age (or at/after the
    cutoff) get weight 0 — mirroring the strict as-of firewall."""
    age = (pd.Timestamp(asof) - pd.to_datetime(dates)).dt.total_seconds() / 86400.0
    age_arr = age.to_numpy()
    w = np.power(0.5, age_arr / float(halflife_days))
    w = np.where(age_arr > float(max_age_days), 0.0, w)
    w = np.where(age_arr <= 0, 0.0, w)
    return w.astype(float)


def decayed_player_table(
    rounds: pd.DataFrame,
    asof: datetime,
    halflife_days: float,
    max_age_days: float,
    value_col: str = "gain",
    extra_weight: pd.Series | None = None,
) -> pd.DataFrame:
    """Per-player decay-weighted mean of ``value_col`` + effective sample + score SD.

    ``extra_weight`` (indexed like ``rounds``) optionally multiplies the decay
    weights (used by the similar-field re-weighting).
    Returns columns: player_id, player_name, n_eff, value, score_sd_raw.
    """
    cols = ["player_id", "player_name", "n_eff", "value", "score_sd_raw"]
    if rounds.empty:
        return pd.DataFrame(columns=cols)

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
        val = float(np.average(grp[value_col].to_numpy(), weights=wt))
        tp = grp["to_par"].to_numpy()
        mean_tp = np.average(tp, weights=wt)
        var = np.average((tp - mean_tp) ** 2, weights=wt)
        out.append(
            {
                "player_id": pid,
                "player_name": grp["player_name"].iloc[0],
                "n_eff": float(tot),
                "value": val,
                "score_sd_raw": float(np.sqrt(max(var, 1e-6))),
            }
        )
    return pd.DataFrame(out, columns=cols)


def add_field_relative_gain(rounds: pd.DataFrame) -> pd.DataFrame:
    """Add a ``gain`` column = field-mean score − player score for each round
    (positive = beat the field). Field mean is per (event_id, round_num).
    """
    if rounds.empty:
        return rounds.assign(gain=[])
    df = rounds.copy()
    field_mean = df.groupby(["event_id", "round_num"])["score"].transform("mean")
    df["gain"] = field_mean - df["score"]
    df["field_mean_to_par"] = field_mean - df["par"]
    return df
