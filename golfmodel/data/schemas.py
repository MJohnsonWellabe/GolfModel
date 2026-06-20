"""Canonical internal schemas — the contract every adapter maps into.

Kept deliberately lightweight (plain pandas validation) so a schema check can
never break imports over a third-party version mismatch. Each schema lists the
required columns; ``validate`` ensures presence, coerces dtypes, and orders
columns. The model code only ever sees these canonical frames.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

SG_CATEGORIES = ["sg_ott", "sg_app", "sg_arg", "sg_putt"]


@dataclass(frozen=True)
class Schema:
    name: str
    columns: dict[str, str]  # column -> pandas dtype string

    @property
    def required(self) -> list[str]:
        return list(self.columns)


# Per-round strokes-gained history (the core training table).
ROUNDS_SG = Schema(
    "rounds_sg",
    {
        "player_id": "string",
        "player_name": "string",
        "event_id": "string",
        "course_id": "string",
        "tour": "string",
        "date": "datetime64[ns]",
        "round_num": "int64",
        "sg_ott": "float64",
        "sg_app": "float64",
        "sg_arg": "float64",
        "sg_putt": "float64",
        "sg_total": "float64",
        "score": "float64",
        "to_par": "float64",
    },
)

# Upcoming-round field: who is teeing off, when, in what group/wave.
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

# Betting lines. ``market`` in {round_ou, matchup, outright}. For round_ou the
# line/over_price/under_price columns are used; for matchup, opponent_id + price.
LINES = Schema(
    "lines",
    {
        "market": "string",
        "book": "string",
        "event_id": "string",
        "round_num": "int64",
        "player_id": "string",
        "line": "float64",
        "over_price": "float64",
        "under_price": "float64",
        "captured_at": "datetime64[ns]",
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
                out[col] = pd.to_datetime(out[col])
            else:
                out[col] = out[col].astype(dtype)
        except (ValueError, TypeError) as exc:  # surface bad data clearly
            raise ValueError(f"{schema.name}.{col}: cannot coerce to {dtype}: {exc}") from exc
    cols = schema.required + ([c for c in out.columns if c not in schema.required] if allow_extra else [])
    return out[cols]
