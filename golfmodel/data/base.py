"""Adapter base class + the canonical data bundle passed to the model."""
from __future__ import annotations

from abc import ABC
from dataclasses import dataclass, field
from datetime import datetime

import pandas as pd


@dataclass
class DataBundle:
    """Everything the model needs for one event/round, already canonicalized."""

    rounds: pd.DataFrame             # historical per-round scores (training data)
    field: pd.DataFrame              # upcoming-round field (players, tee times, waves)
    weather: pd.DataFrame = field(default_factory=pd.DataFrame)  # per-wave conditions
    event_id: str | None = None
    course_id: str | None = None
    round_num: int | None = None
    asof: datetime | None = None
    sources: list[str] = field(default_factory=list)


class DataAdapter(ABC):
    """An adapter exposes one or more canonical tables from a single source.

    Adapters return empty frames for tables they do not provide; the registry
    composes them via a fallback chain. ``available`` lets the registry skip an
    adapter without raising. Every table method takes an ``asof`` cutoff so
    backtests stay leak-free.
    """

    name: str = "base"

    def available(self) -> bool:
        return True

    def rounds(self, asof: datetime | None = None) -> pd.DataFrame:
        return pd.DataFrame()

    def field(self, event_id: str | None, round_num: int | None, asof: datetime | None = None) -> pd.DataFrame:
        return pd.DataFrame()
