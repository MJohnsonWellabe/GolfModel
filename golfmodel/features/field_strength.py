"""Field strength + similar-field re-weighting.

Field strength = decay-weighted average baseline skill of the field. Similar-field
re-weighting discounts a player's historical rounds that were played against fields
of very different strength, via a Gaussian kernel on field-strength distance — so a
player who padded stats against weak fields is regressed in an elite field.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def field_strength(player_skills: pd.DataFrame, field_player_ids: list[str]) -> float:
    """Mean total skill (sum of category skills) over the players in the field."""
    from ..data.schemas import SG_CATEGORIES

    in_field = player_skills[player_skills["player_id"].isin(field_player_ids)]
    if in_field.empty:
        return 0.0
    totals = in_field[SG_CATEGORIES].sum(axis=1)
    return float(totals.mean())


def similar_field_weights(
    rounds: pd.DataFrame, current_strength: float, bandwidth: float
) -> pd.Series:
    """Per-round multiplier in (0,1] based on field-strength similarity.

    Requires a ``field_strength`` column on ``rounds``; if absent, returns all 1s
    (no re-weighting).
    """
    if "field_strength" not in rounds.columns:
        return pd.Series(1.0, index=rounds.index)
    dist = (rounds["field_strength"].astype(float) - float(current_strength)).abs()
    w = np.exp(-0.5 * (dist / float(bandwidth)) ** 2)
    return pd.Series(w, index=rounds.index).clip(lower=0.05)
