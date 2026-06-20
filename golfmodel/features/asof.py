"""The no-lookahead firewall.

Every feature must be built using only data strictly before the prediction cutoff.
``apply_asof`` enforces it; ``assert_no_lookahead`` is used in tests and (cheaply)
in the backtest loop to guarantee no future row ever leaks into a feature.
"""
from __future__ import annotations

from datetime import datetime

import pandas as pd


def apply_asof(df: pd.DataFrame, asof: datetime | None, date_col: str = "date") -> pd.DataFrame:
    """Return only rows with ``date_col`` strictly before ``asof``."""
    if asof is None or df.empty or date_col not in df.columns:
        return df
    return df[pd.to_datetime(df[date_col]) < pd.Timestamp(asof)].copy()


def assert_no_lookahead(df: pd.DataFrame, asof: datetime | None, date_col: str = "date") -> None:
    """Raise if any row is dated on/after the cutoff (a leak)."""
    if asof is None or df.empty or date_col not in df.columns:
        return
    latest = pd.to_datetime(df[date_col]).max()
    if latest >= pd.Timestamp(asof):
        raise AssertionError(
            f"Lookahead leak: {date_col} max {latest} >= asof {asof}"
        )
