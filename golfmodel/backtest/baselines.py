"""Baselines the model must beat, used as the independent O/U "line" too."""
from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd


def season_to_date_mean(rounds: pd.DataFrame, asof: datetime) -> pd.Series:
    """Naive predictor: each player's mean score over prior rounds (index=player_id).

    This doubles as an independent market line for the backtest's O/U calibration
    test — our distribution must predict over/under vs THIS line better than chance.
    """
    prior = rounds[pd.to_datetime(rounds["date"]) < pd.Timestamp(asof)]
    if prior.empty:
        return pd.Series(dtype=float)
    return prior.groupby("player_id")["score"].mean()


def field_mean_score(rounds: pd.DataFrame, asof: datetime) -> float:
    prior = rounds[pd.to_datetime(rounds["date"]) < pd.Timestamp(asof)]
    return float(prior["score"].mean()) if not prior.empty else np.nan
