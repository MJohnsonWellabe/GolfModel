"""Adapter registry: composes a canonical DataBundle from free sources.

``source='sample'`` runs entirely on bundled synthetic data (no network).
``source='live'`` uses per-table fallback chains:
    rounds  : ESPN -> Sample
    field   : ESPN -> Sample
    weather : Open-Meteo (from field tee windows / course-day) -> Sample
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd

from ..config import course_meta, settings
from .base import DataBundle
from .schemas import FIELD, ROUNDS, validate
from .adapters.sample import SampleAdapter
from .adapters.espn import EspnAdapter
from .adapters.weather import WeatherAdapter


def _first_nonempty(frames):
    for name, df in frames:
        if df is not None and not df.empty:
            return df, name
    return pd.DataFrame(), None


def tee_windows(field: pd.DataFrame, window_hours: float, event_date: datetime | None):
    """Min/max tee-time window per wave. If tee times are missing (common on the
    free ESPN feed), fall back to a single daytime window on the event date."""
    out: dict[str, tuple[datetime, datetime]] = {}
    f = field.copy()
    if "tee_time" in f.columns:
        f["tee_time"] = pd.to_datetime(f["tee_time"], errors="coerce")
    have_tees = "tee_time" in f.columns and f["tee_time"].notna().any()
    if have_tees:
        for wave, grp in f.dropna(subset=["tee_time"]).groupby(f["wave"].fillna("all")):
            start = grp["tee_time"].min()
            end = grp["tee_time"].max() + timedelta(hours=window_hours)
            out[str(wave)] = (start.to_pydatetime(), end.to_pydatetime())
    elif event_date is not None:
        day = pd.Timestamp(event_date).normalize()
        out["all"] = ((day + timedelta(hours=6)).to_pydatetime(), (day + timedelta(hours=18)).to_pydatetime())
    return out


def load_bundle(source="sample", event_id=None, round_num=None, asof=None, historical_weather=False) -> DataBundle:
    sample = SampleAdapter()
    if source == "sample":
        meta = sample.meta()
        event_id = event_id or meta["event_id"]
        round_num = round_num or meta["round_num"]
        asof = asof or pd.Timestamp(meta["asof"]).to_pydatetime()
        return DataBundle(
            rounds=validate(sample.rounds(asof), ROUNDS),
            field=validate(sample.field(event_id, round_num), FIELD),
            weather=sample.weather(),
            event_id=event_id,
            course_id=meta["course_id"],
            round_num=round_num,
            asof=asof,
            sources=["sample"],
        )

    # --- live (free) ---
    asof = asof or pd.Timestamp(datetime.utcnow())  # predict as of "now"
    espn, weather = EspnAdapter(), WeatherAdapter()
    sources: list[str] = []

    rounds, src = _first_nonempty([("espn", espn.rounds(asof)), ("sample", sample.rounds(asof))])
    sources.append(src or "sample")
    field_df, fsrc = _first_nonempty(
        [("espn", espn.field(event_id, round_num, asof)), ("sample", sample.field(event_id, round_num))]
    )
    sources.append(fsrc or "sample")

    field_df = validate(field_df, FIELD)
    event_id = event_id or (field_df["event_id"].iloc[0] if not field_df.empty else None)
    round_num = round_num or (int(field_df["round_num"].iloc[0]) if not field_df.empty else None)
    course_id = field_df["course_id"].iloc[0] if not field_df.empty else (event_id or "")

    # Weather from Open-Meteo at the course lat/lon over the tee windows.
    wx = pd.DataFrame()
    cm = course_meta(course_id)
    if cm.get("lat") is not None and not field_df.empty:
        event_date = pd.to_datetime(field_df["tee_time"], errors="coerce").min()
        if pd.isna(event_date):
            event_date = pd.Timestamp(asof or datetime.utcnow())
        windows = tee_windows(field_df, settings()["weather"]["tee_window_hours"], event_date)
        if windows:
            wx = weather.wave_conditions(cm["lat"], cm["lon"], windows, event_date, historical_weather)
            if not wx.empty:
                sources.append("weather:open-meteo")
    if wx.empty:
        wx = sample.weather()

    return DataBundle(
        rounds=validate(rounds, ROUNDS),
        field=field_df,
        weather=wx,
        event_id=event_id,
        course_id=course_id,
        round_num=round_num,
        asof=asof,
        sources=sorted(set(sources)),
    )
