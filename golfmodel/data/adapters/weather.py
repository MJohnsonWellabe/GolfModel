"""Open-Meteo weather adapter — free, no key.

Provides hourly wind/precip/temperature at a course (lat/lon) for a date, from the
*forecast* API (upcoming rounds) or the *historical archive* API (backtests, keyed
by the asof date). ``wave_conditions`` aggregates hourly data into AM/PM windows.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd
import requests

from ..cache import cached_json

FORECAST = "https://api.open-meteo.com/v1/forecast"
ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
HOURLY = "wind_speed_10m,wind_gusts_10m,precipitation,temperature_2m"


class WeatherAdapter:
    name = "weather"

    def available(self) -> bool:
        return True  # no key required

    def hourly(self, lat: float, lon: float, date: datetime, historical: bool) -> pd.DataFrame:
        """Hourly weather for one course-day. ``historical`` picks archive vs forecast."""
        if lat is None or lon is None:
            return pd.DataFrame()
        day = pd.Timestamp(date).strftime("%Y-%m-%d")
        url = ARCHIVE if historical else FORECAST
        params = {
            "latitude": round(float(lat), 3),
            "longitude": round(float(lon), 3),
            "hourly": HOURLY,
            "start_date": day,
            "end_date": day,
            "wind_speed_unit": "mph",
            "timezone": "auto",
        }

        def fetch():
            r = requests.get(url, params=params, timeout=30)
            r.raise_for_status()
            return r.json()

        try:
            payload = cached_json("weather", "archive" if historical else "forecast", params, fetch)
        except Exception:  # pragma: no cover - network failure
            return pd.DataFrame()
        h = payload.get("hourly", {})
        if not h:
            return pd.DataFrame()
        return pd.DataFrame(
            {
                "time": pd.to_datetime(h.get("time", [])),
                "wind_mph": h.get("wind_speed_10m", []),
                "gust_mph": h.get("wind_gusts_10m", []),
                "precip": h.get("precipitation", []),
                "temp_c": h.get("temperature_2m", []),
            }
        )

    def wave_conditions(
        self,
        lat: float,
        lon: float,
        tee_windows: dict[str, tuple[datetime, datetime]],
        date: datetime,
        historical: bool,
    ) -> pd.DataFrame:
        """Aggregate hourly weather into per-wave conditions for the given tee windows."""
        hourly = self.hourly(lat, lon, date, historical)
        rows = []
        for wave, (start, end) in tee_windows.items():
            if hourly.empty:
                rows.append({"wave": wave, "wind_mph": None, "precip": None, "temp_c": None})
                continue
            mask = (hourly["time"] >= pd.Timestamp(start)) & (hourly["time"] <= pd.Timestamp(end))
            window = hourly[mask] if mask.any() else hourly
            rows.append(
                {
                    "wave": wave,
                    "wind_mph": float(window["wind_mph"].mean()),
                    "precip": float((window["precip"] > 0.1).mean()),
                    "temp_c": float(window["temp_c"].mean()),
                }
            )
        return pd.DataFrame(rows)
