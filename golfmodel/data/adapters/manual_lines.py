"""Manual lines adapter — authoritative source for captured FanDuel round-O/U lines.

Reads data/manual/lines_manual.csv (committed). Because round-score O/U is a niche
market that's hard to get in bulk, hand-captured lines are a first-class input.
``scripts/capture_lines.py`` appends rows here.
"""
from __future__ import annotations

from datetime import datetime

import pandas as pd

from ...config import DATA_DIR
from ..base import DataAdapter

MANUAL_CSV = DATA_DIR / "manual" / "lines_manual.csv"


class ManualLinesAdapter(DataAdapter):
    name = "manual_lines"

    def available(self) -> bool:
        return MANUAL_CSV.exists()

    def lines(self, event_id=None, round_num=None, asof=None) -> pd.DataFrame:
        if not self.available():
            return pd.DataFrame()
        df = pd.read_csv(MANUAL_CSV)
        if df.empty:
            return df
        if event_id is not None:
            df = df[df["event_id"].astype(str) == str(event_id)]
        if round_num is not None and "round_num" in df.columns:
            df = df[df["round_num"] == int(round_num)]
        if asof is not None and "captured_at" in df.columns:
            df = df[pd.to_datetime(df["captured_at"]) <= pd.Timestamp(asof)]
        return df
