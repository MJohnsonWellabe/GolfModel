"""Player baseline skill: decayed SG by category, similar-field re-weighted, then
empirical-Bayes shrunk toward the field mean.
"""
from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd

from ..data.schemas import SG_CATEGORIES
from ..features.decay import decayed_player_table
from ..features.field_strength import field_strength, similar_field_weights


def compute_player_skills(
    rounds: pd.DataFrame,
    field_player_ids: list[str],
    asof: datetime,
    cfg: dict,
) -> tuple[pd.DataFrame, float]:
    """Return (player_skills, field_strength).

    player_skills columns: player_id, player_name, n_eff, score_sd_raw, <SG cats>.
    Two passes: (1) decay-only skills to estimate the current field strength,
    (2) re-weight each player's history by similar-field kernel and recompute,
    then shrink each category toward the population mean.
    """
    d = cfg["decay"]
    hl, max_age = d["halflife_days"], d["max_age_days"]

    raw = decayed_player_table(rounds, asof, hl, max_age)
    if raw.empty:
        return raw, 0.0

    fs = field_strength(raw, field_player_ids)

    # Pass 2: similar-field re-weighting of historical rounds.
    extra = similar_field_weights(rounds, fs, cfg["field_strength"]["similarity_bandwidth"])
    table = decayed_player_table(rounds, asof, hl, max_age, extra_weight=extra)

    # Empirical-Bayes shrinkage toward the population (tour-average) mean per category.
    k = float(cfg["baseline"]["shrinkage_k"])
    mu = {c: float(table[c].mean()) for c in SG_CATEGORIES}
    n = table["n_eff"].to_numpy()
    for c in SG_CATEGORIES:
        table[c] = (n * table[c].to_numpy() + k * mu[c]) / (n + k)

    return table.reset_index(drop=True), fs
