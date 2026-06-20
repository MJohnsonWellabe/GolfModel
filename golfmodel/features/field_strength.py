"""Field strength + similar-field re-weighting (score-based).

Field strength = mean current rating of the players in a field. Similar-field
re-weighting discounts a player's historical rounds played against fields of very
different strength (Gaussian kernel on field-strength distance), so padding stats
against weak fields is regressed when projecting into a strong field.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def field_strength(player_skills: pd.DataFrame, field_player_ids: list[str], col: str = "skill") -> float:
    """Mean rating over the players in the field."""
    in_field = player_skills[player_skills["player_id"].isin(field_player_ids)]
    if in_field.empty or col not in in_field.columns:
        return 0.0
    return float(in_field[col].mean())


def attach_field_strength(rounds: pd.DataFrame, skill_by_player: pd.Series) -> pd.DataFrame:
    """Add a per-round ``field_strength`` column = mean current rating of that
    round's field (using the supplied player->rating map)."""
    df = rounds.copy()
    df["_p_skill"] = df["player_id"].map(skill_by_player).fillna(0.0)
    df["field_strength"] = df.groupby(["event_id", "round_num"])["_p_skill"].transform("mean")
    return df.drop(columns="_p_skill")


def similar_field_weights(rounds: pd.DataFrame, current_strength: float, bandwidth: float) -> pd.Series:
    """Per-round multiplier in (0,1] based on field-strength similarity."""
    if "field_strength" not in rounds.columns:
        return pd.Series(1.0, index=rounds.index)
    dist = (rounds["field_strength"].astype(float) - float(current_strength)).abs()
    w = np.exp(-0.5 * (dist / float(bandwidth)) ** 2)
    return pd.Series(w, index=rounds.index).clip(lower=0.05)
