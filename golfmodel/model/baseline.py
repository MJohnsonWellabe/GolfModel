"""Score-based player rating (free-data replacement for strokes-gained).

Skill = decay-weighted "strokes gained vs the field" (field-mean score minus the
player's score), similar-field re-weighted and empirical-Bayes shrunk toward 0
(an average tour player). A course-specific rating (this course + similar-cluster
courses) is blended in to capture course/"horses-for-courses" affinity — the free
stand-in for the old per-category course-fit.
"""
from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd

from ..config import course_meta
from ..features.decay import add_field_relative_gain, decayed_player_table
from ..features.field_strength import attach_field_strength, field_strength, similar_field_weights


def compute_player_skills(
    rounds: pd.DataFrame,
    field_player_ids: list[str],
    course_id: str | None,
    asof: datetime,
    cfg: dict,
) -> tuple[pd.DataFrame, float]:
    """Return (player_skills, field_strength).

    player_skills columns: player_id, player_name, n_eff, n_course,
    skill_overall, skill (blended), score_sd_raw.
    """
    d, r = cfg["decay"], cfg["rating"]
    hl, max_age = d["halflife_days"], d["max_age_days"]
    cols = ["player_id", "player_name", "n_eff", "n_course", "skill_overall", "skill", "score_sd_raw"]
    if rounds.empty:
        return pd.DataFrame(columns=cols), 0.0

    g = add_field_relative_gain(rounds)

    # Pass 1: overall rating (decay only) to estimate field strength.
    raw = decayed_player_table(g, asof, hl, max_age, value_col="gain")
    raw["skill"] = raw["n_eff"] / (raw["n_eff"] + r["shrinkage_k"]) * raw["value"]
    fs = field_strength(raw, field_player_ids)

    # Attach each historical round's field strength (from current ratings), then
    # re-weight by similarity to the upcoming field and EB shrink toward 0.
    g = attach_field_strength(g, raw.set_index("player_id")["skill"])
    extra = similar_field_weights(g, fs, cfg["field_strength"]["similarity_bandwidth"])
    overall = decayed_player_table(g, asof, hl, max_age, value_col="gain", extra_weight=extra)
    overall["skill_overall"] = overall["n_eff"] / (overall["n_eff"] + r["shrinkage_k"]) * overall["value"]

    # Course / cluster affinity table.
    cluster = course_meta(course_id).get("cluster")
    course_mask = g["course_id"] == course_id
    if cluster:
        same_cluster = g["course_id"].map(lambda c: course_meta(c).get("cluster") == cluster)
        cw = np.where(course_mask, 1.0, np.where(same_cluster & (g["course_id"] != course_id), r["cluster_weight"], 0.0))
    else:
        cw = np.where(course_mask, 1.0, 0.0)
    cw = pd.Series(cw, index=g.index) * extra
    course_rounds = g[cw > 0]
    course_tbl = decayed_player_table(
        course_rounds, asof, hl, max_age, value_col="gain", extra_weight=cw.loc[cw > 0]
    ).rename(columns={"value": "course_value", "n_eff": "n_course"})[["player_id", "n_course", "course_value"]]

    out = overall.merge(course_tbl, on="player_id", how="left")
    out["n_course"] = out["n_course"].fillna(0.0)
    out["course_value"] = out["course_value"].fillna(out["skill_overall"])
    kc = r["course_shrinkage_k"]
    out["skill"] = (out["n_course"] * out["course_value"] + kc * out["skill_overall"]) / (out["n_course"] + kc)
    out = out[["player_id", "player_name", "n_eff", "n_course", "skill_overall", "skill", "score_sd_raw"]]
    return out.reset_index(drop=True), fs
