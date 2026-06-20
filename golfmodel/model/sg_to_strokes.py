"""Map course-weighted strokes-gained skill to an expected single-round score.

E[strokes] = par + course_base - weighted_sg(wave) + weather_shift(wave) + partner_adj

``weighted_sg`` uses per-wave course-fit multipliers (the same course tilt, further
tilted by that wave's wind). Sign convention: positive SG lowers the score.
"""
from __future__ import annotations

import pandas as pd

from ..data.schemas import SG_CATEGORIES
from ..features.environment import Environment


def expected_scores(
    player_skills: pd.DataFrame,
    field: pd.DataFrame,
    wave_multipliers: dict[str, dict[str, float]],
    env: Environment,
    partner_adj: pd.Series,
) -> pd.DataFrame:
    """Return per-player expected strokes/to-par for the upcoming round."""
    skills = player_skills.set_index("player_id")
    rows = []
    for _, fr in field.iterrows():
        pid = fr["player_id"]
        if pid not in skills.index:
            continue
        wave = str(fr.get("wave", "all"))
        mult = wave_multipliers.get(wave) or wave_multipliers.get("all") or {c: 1.0 for c in SG_CATEGORIES}
        weighted_sg = sum(mult[c] * float(skills.loc[pid, c]) for c in SG_CATEGORIES)
        shift = env.wave_shift.get(wave, next(iter(env.wave_shift.values()), 0.0))
        padj = float(partner_adj.get(pid, 0.0))
        e_strokes = env.par + env.course_base - weighted_sg + shift + padj
        rows.append(
            {
                "player_id": pid,
                "player_name": skills.loc[pid, "player_name"],
                "wave": wave,
                "weighted_sg": float(weighted_sg),
                "e_strokes": float(e_strokes),
                "e_to_par": float(e_strokes - env.par),
                "n_eff": float(skills.loc[pid, "n_eff"]),
                "score_sd_raw": float(skills.loc[pid, "score_sd_raw"]),
            }
        )
    return pd.DataFrame(rows)
