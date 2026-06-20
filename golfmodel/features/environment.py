"""Round scoring-environment: the course's neutral difficulty + per-wave weather.

``course_base`` is the expected to-par for a tour-average player (SG total = 0) in
average historical conditions at the course, estimated as the mean of
``to_par + sg_total`` over historical rounds there (this removes field-strength
bias). Per-wave weather shifts and SD multipliers come from the weather feature.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from . import weather as wx


@dataclass
class Environment:
    par: int
    course_base: float                       # neutral to-par for an average player
    wave_shift: dict[str, float] = field(default_factory=dict)   # extra strokes by wave
    wave_sd_mult: dict[str, float] = field(default_factory=dict)  # SD multiplier by wave
    wave_wind: dict[str, float] = field(default_factory=dict)     # effective wind by wave


def compute_environment(
    course_rounds: pd.DataFrame,
    course_meta: dict,
    weather: pd.DataFrame,
    cfg: dict,
) -> Environment:
    par = int(course_meta.get("par", cfg["environment"]["default_par"]))

    if course_rounds.empty:
        course_base = 0.0
    else:
        neutral = course_rounds["to_par"].astype(float) + course_rounds["sg_total"].astype(float)
        course_base = float(neutral.mean())

    eff = wx.wave_effects(weather, course_meta, cfg["weather"])
    wave_shift, wave_sd, wave_wind = {}, {}, {}
    for _, r in eff.iterrows():
        wave_shift[str(r["wave"])] = float(r["strokes_shift"])
        wave_sd[str(r["wave"])] = float(r["sd_mult"])
        wave_wind[str(r["wave"])] = float(r["effective_wind"])
    return Environment(par=par, course_base=course_base, wave_shift=wave_shift,
                       wave_sd_mult=wave_sd, wave_wind=wave_wind)
