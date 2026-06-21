"""Canonical internal schemas — the contract every adapter maps into.

Free-data rebuild: there is no free per-round strokes-gained, so the core table
is plain round SCORES (``rounds``). Skill is derived from scores vs the field.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class Schema:
    name: str
    columns: dict[str, str]  # column -> pandas dtype string

    @property
    def required(self) -> list[str]:
        return list(self.columns)


# Per-round scores (the core training table). No strokes-gained (paid-only).
ROUNDS = Schema(
    "rounds",
    {
        "player_id": "string",
        "player_name": "string",
        "event_id": "string",
        "course_id": "string",
        "tour": "string",
        "date": "datetime64[ns]",
        "round_num": "int64",
        "score": "float64",
        "to_par": "float64",
        "par": "int64",
    },
)

# Upcoming-round field: who is teeing off, when, in what group/wave.
# Tee time/wave are best-effort (ESPN's free feed often omits them).
FIELD = Schema(
    "field",
    {
        "event_id": "string",
        "course_id": "string",
        "round_num": "int64",
        "player_id": "string",
        "player_name": "string",
        "tee_time": "datetime64[ns]",
        "wave": "string",
        "group_id": "string",
    },
)


def validate(df: pd.DataFrame, schema: Schema, *, allow_extra: bool = True) -> pd.DataFrame:
    """Check required columns exist, coerce dtypes, return canonical column order."""
    missing = [c for c in schema.required if c not in df.columns]
    if missing:
        raise ValueError(f"{schema.name}: missing required columns {missing}")
    out = df.copy()
    for col, dtype in schema.columns.items():
        try:
            if dtype.startswith("datetime"):
                # Normalize any tz-aware input (e.g. ESPN's UTC stamps) to naive UTC
                # so all date comparisons across sources are consistent.
                ser = pd.to_datetime(out[col], utc=True, errors="coerce")
                out[col] = ser.dt.tz_localize(None)
            else:
                out[col] = out[col].astype(dtype)
        except (ValueError, TypeError) as exc:
            raise ValueError(f"{schema.name}.{col}: cannot coerce to {dtype}: {exc}") from exc
    cols = schema.required + ([c for c in out.columns if c not in schema.required] if allow_extra else [])
    return out[cols]
