"""Adapter registry: composes a canonical DataBundle from the available sources.

``source='sample'`` runs entirely on bundled synthetic data (no secrets).
``source='live'`` uses per-table fallback chains:
    rounds_sg : DataGolf -> Sample
    field     : DataGolf -> Sample
    lines     : Manual -> Odds API -> Sample
    weather   : Open-Meteo (computed from field tee times) -> Sample
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd

from ..config import course_meta
from .base import DataBundle
from .schemas import FIELD, LINES, ROUNDS_SG, validate
from .adapters.sample import SampleAdapter
from .adapters.datagolf import DataGolfAdapter
from .adapters.odds_api import OddsApiAdapter
from .adapters.manual_lines import ManualLinesAdapter
from .adapters.weather import WeatherAdapter


def _first_nonempty(frames: list[pd.DataFrame]) -> tuple[pd.DataFrame, str | None]:
    for name, df in frames:
        if df is not None and not df.empty:
            return df, name
    return pd.DataFrame(), None


def tee_windows(field: pd.DataFrame, window_hours: float) -> dict[str, tuple[datetime, datetime]]:
    """Min/max tee-time window per wave, padded so play time is covered."""
    out: dict[str, tuple[datetime, datetime]] = {}
    if field.empty or "tee_time" not in field.columns:
        return out
    f = field.copy()
    f["tee_time"] = pd.to_datetime(f["tee_time"])
    for wave, grp in f.groupby(f.get("wave", "all")):
        start = grp["tee_time"].min()
        end = grp["tee_time"].max() + timedelta(hours=window_hours)
        out[str(wave)] = (start.to_pydatetime(), end.to_pydatetime())
    return out


def load_bundle(
    source: str = "sample",
    event_id: str | None = None,
    round_num: int | None = None,
    asof: datetime | None = None,
    historical_weather: bool = False,
) -> DataBundle:
    sample = SampleAdapter()
    if source == "sample":
        meta = sample.meta()
        event_id = event_id or meta["event_id"]
        round_num = round_num or meta["round_num"]
        asof = asof or pd.Timestamp(meta["asof"]).to_pydatetime()
        bundle = DataBundle(
            rounds_sg=validate(sample.rounds_sg(asof), ROUNDS_SG),
            field=validate(sample.field(event_id, round_num), FIELD),
            lines=validate(sample.lines(event_id, round_num, asof), LINES),
            weather=sample.weather(),
            event_id=event_id,
            course_id=meta["course_id"],
            round_num=round_num,
            asof=asof,
            sources=["sample"],
        )
        return bundle

    # --- live ---
    dg, odds, manual, weather = DataGolfAdapter(), OddsApiAdapter(), ManualLinesAdapter(), WeatherAdapter()
    sources: list[str] = []

    rounds, src = _first_nonempty([("datagolf", dg.rounds_sg(asof)), ("sample", sample.rounds_sg(asof))])
    sources.append(src or "sample")
    field_df, fsrc = _first_nonempty(
        [("datagolf", dg.field(event_id, round_num, asof)), ("sample", sample.field(event_id, round_num))]
    )
    sources.append(fsrc or "sample")
    lines_df, lsrc = _first_nonempty(
        [
            ("manual_lines", manual.lines(event_id, round_num, asof)),
            ("odds_api", odds.lines(event_id, round_num, asof)),
            ("sample", sample.lines(event_id, round_num, asof)),
        ]
    )
    sources.append(lsrc or "sample")

    field_df = validate(field_df, FIELD)
    course_id = field_df["course_id"].iloc[0] if not field_df.empty else (event_id or "")

    # Weather: compute per-wave conditions from Open-Meteo at the course lat/lon.
    wx = pd.DataFrame()
    cm = course_meta(course_id)
    from ..config import settings

    windows = tee_windows(field_df, settings()["weather"]["tee_window_hours"])
    if windows and cm.get("lat") is not None:
        date = pd.to_datetime(field_df["tee_time"]).min()
        wx = weather.wave_conditions(cm["lat"], cm["lon"], windows, date, historical_weather)
        sources.append("weather:open-meteo")
    if wx.empty:
        wx = sample.weather()

    return DataBundle(
        rounds_sg=validate(rounds, ROUNDS_SG),
        field=field_df,
        lines=validate(lines_df, LINES),
        weather=wx,
        event_id=event_id,
        course_id=course_id,
        round_num=round_num,
        asof=asof,
        sources=sorted(set(sources)),
    )
