"""Playing-partner effect — deliberately low-signal, OFF by default.

Kept as a separable additive term so the backtest can quantify whether grouping
with stronger/weaker partners moves a player's score at all. Until proven, it
contributes exactly zero. Enable via config: ``partners.enabled: true``.
"""
from __future__ import annotations

import pandas as pd


def partner_adjustments(field: pd.DataFrame, player_skills: pd.DataFrame, cfg: dict) -> pd.Series:
    """Return a per-player additive strokes adjustment (index = player_id).

    Default (disabled) returns zeros. When enabled, applies a tiny shrinkage of a
    player's expectation toward their group's mean skill, scaled by ``effect_sd``.
    """
    ids = field["player_id"].tolist()
    zero = pd.Series(0.0, index=ids)
    if not cfg.get("enabled", False):
        return zero

    effect = float(cfg.get("effect_sd", 0.0))
    if effect <= 0 or "group_id" not in field.columns:
        return zero

    skill_total = player_skills.set_index("player_id")["skill"]
    f = field[["player_id", "group_id"]].copy()
    f["skill"] = f["player_id"].map(skill_total).fillna(0.0)
    group_mean = f.groupby("group_id")["skill"].transform("mean")
    # Small pull of expected strokes toward the group (sign: stronger group -> tiny help).
    adj = -effect * (f["skill"] - group_mean)
    return pd.Series(adj.to_numpy(), index=f["player_id"].to_numpy())
