"""Weather feature: turn per-wave conditions into score shifts, variance, and a
course-fit tilt. This module is the single source of truth for the weather→scoring
relationship (the sample generator imports it too, so synthetic data and the model
stay consistent).
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def exposure_factor(exposure: float) -> float:
    """How strongly raw wind is "felt" at the course (sheltered < links)."""
    return 0.5 + float(exposure)


def effective_wind(wind_mph: float, exposure: float) -> float:
    if wind_mph is None or (isinstance(wind_mph, float) and np.isnan(wind_mph)):
        return 0.0
    return float(wind_mph) * exposure_factor(exposure)


def strokes_shift(wind_mph: float, precip: float, exposure: float, cfg: dict) -> float:
    """Extra strokes added to the field's expected score by wind + precipitation."""
    eff = effective_wind(wind_mph, exposure)
    over_calm = max(0.0, eff - float(cfg["calm_wind_mph"]))
    precip = 0.0 if precip is None or np.isnan(precip) else float(precip)
    return cfg["wind_strokes_per_mph"] * over_calm + cfg["precip_penalty"] * precip


def sd_multiplier(wind_mph: float, exposure: float, cfg: dict) -> float:
    """Variance amplifier: wind widens the round-score distribution."""
    eff = effective_wind(wind_mph, exposure)
    return 1.0 + cfg["wind_variance_per_10mph"] * eff / 10.0


def wave_effects(weather: pd.DataFrame, course_meta: dict, cfg: dict) -> pd.DataFrame:
    """Per-wave table of effective wind, strokes shift, and SD multiplier."""
    exposure = float(course_meta.get("exposure", 0.4))
    rows = []
    if weather is None or weather.empty:
        return pd.DataFrame(columns=["wave", "wind_mph", "effective_wind", "strokes_shift", "sd_mult"])
    for _, r in weather.iterrows():
        wind = r.get("wind_mph")
        precip = r.get("precip", 0.0)
        rows.append(
            {
                "wave": r.get("wave", "all"),
                "wind_mph": wind,
                "effective_wind": effective_wind(wind, exposure),
                "strokes_shift": strokes_shift(wind, precip, exposure, cfg),
                "sd_mult": sd_multiplier(wind, exposure, cfg),
            }
        )
    return pd.DataFrame(rows)
