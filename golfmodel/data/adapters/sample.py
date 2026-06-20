"""Sample adapter: reads bundled synthetic data. Always available, no network.

Auto-generates the sample data on first use if missing.
"""
from __future__ import annotations

import json
from datetime import datetime

import pandas as pd

from ...config import DATA_DIR
from ..base import DataAdapter
from .. import generate_sample

SAMPLE_DIR = DATA_DIR / "sample"


class SampleAdapter(DataAdapter):
    name = "sample"

    def __init__(self) -> None:
        if not (SAMPLE_DIR / "rounds.parquet").exists():
            generate_sample.generate()

    def available(self) -> bool:
        return True

    def meta(self) -> dict:
        return json.loads((SAMPLE_DIR / "meta.json").read_text())

    def _read(self, name: str) -> pd.DataFrame:
        path = SAMPLE_DIR / f"{name}.parquet"
        return pd.read_parquet(path) if path.exists() else pd.DataFrame()

    def rounds(self, asof: datetime | None = None) -> pd.DataFrame:
        df = self._read("rounds")
        if asof is not None and not df.empty:
            df = df[pd.to_datetime(df["date"]) < pd.Timestamp(asof)]
        return df

    def field(self, event_id=None, round_num=None, asof=None) -> pd.DataFrame:
        return self._read("field")

    def lines(self, event_id=None, round_num=None, asof=None) -> pd.DataFrame:
        df = self._read("lines")
        if asof is not None and not df.empty and "captured_at" in df.columns:
            df = df[pd.to_datetime(df["captured_at"]) <= pd.Timestamp(asof)]
        return df

    def weather(self) -> pd.DataFrame:
        return self._read("weather")
