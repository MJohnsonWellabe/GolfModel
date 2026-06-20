"""Map a player's score-based rating to an expected single-round score.

E[strokes] = par + course_base − skill + weather_shift(wave) + partner_adj

``skill`` is strokes gained vs the field (positive = better = lower score).
"""
from __future__ import annotations

import pandas as pd

from ..features.environment import Environment


def expected_scores(
    player_skills: pd.DataFrame,
    field: pd.DataFrame,
    env: Environment,
    partner_adj: pd.Series,
) -> pd.DataFrame:
    """Return per-player expected strokes/to-par for the upcoming round."""
    skills = player_skills.drop_duplicates("player_id").set_index("player_id")
    padj_map = partner_adj.groupby(level=0).first().to_dict()
    default_shift = next(iter(env.wave_shift.values()), 0.0)
    rows = []
    seen: set[str] = set()
    for _, fr in field.iterrows():
        pid = fr["player_id"]
        if pid in seen or not pid or pid not in skills.index:
            continue
        seen.add(pid)
        wave = str(fr.get("wave", "all"))
        shift = env.wave_shift.get(wave, default_shift)
        padj = float(padj_map.get(pid, 0.0))
        skill = float(skills.loc[pid, "skill"])
        e_strokes = env.par + env.course_base - skill + shift + padj
        rows.append(
            {
                "player_id": pid,
                "player_name": skills.loc[pid, "player_name"],
                "wave": wave,
                "skill": skill,
                "skill_overall": float(skills.loc[pid, "skill_overall"]),
                "e_strokes": float(e_strokes),
                "e_to_par": float(e_strokes - env.par),
                "n_eff": float(skills.loc[pid, "n_eff"]),
                "n_course": float(skills.loc[pid, "n_course"]),
                "score_sd_raw": float(skills.loc[pid, "score_sd_raw"]),
            }
        )
    return pd.DataFrame(rows)
