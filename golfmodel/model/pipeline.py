"""Orchestrate a single event/round: data bundle -> predictions -> value board."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import course_meta, settings
from ..data.base import DataBundle
from ..data.schemas import SG_CATEGORIES
from ..features.asof import apply_asof, assert_no_lookahead
from ..features.course_fit import course_fit_multipliers
from ..features.environment import compute_environment
from ..features.partners import partner_adjustments
from ..features.weather import wind_course_fit_adjust
from .baseline import compute_player_skills
from .distribution import assign_score_sd, predictive_summary
from .sg_to_strokes import expected_scores
from ..betting.rank import value_board


@dataclass
class PipelineResult:
    summary: pd.DataFrame        # per-player expected score + interval
    board: pd.DataFrame          # ranked value bets
    sims: np.ndarray             # [n_sims, n_players]
    player_skills: pd.DataFrame  # shrunk SG by category per player
    multipliers: dict            # base course-fit multipliers
    field_strength: float
    env_par: int
    course_base: float
    wave_wind: dict
    event_id: str | None
    course_id: str | None
    round_num: int | None
    sources: list


def run_event(bundle: DataBundle, cfg: dict | None = None) -> PipelineResult:
    cfg = cfg or settings()
    asof = bundle.asof

    rounds = apply_asof(bundle.rounds_sg, asof)
    assert_no_lookahead(rounds, asof)  # firewall: no future round leaks in
    field = bundle.field
    cmeta = course_meta(bundle.course_id)

    field_ids = field["player_id"].tolist()
    player_skills, fs = compute_player_skills(rounds, field_ids, asof, cfg)

    course_rounds = rounds[rounds["course_id"] == bundle.course_id]
    base_mult = course_fit_multipliers(
        course_rounds,
        cmeta["attribute_prior"],
        cfg["course_fit"]["ridge_alpha"],
        cfg["course_fit"]["prior_strength"],
    )

    env = compute_environment(course_rounds, cmeta, bundle.weather, cfg)

    # Per-wave course-fit tilt (wind up-weights ball-striking on exposed courses).
    waves = set(field.get("wave", pd.Series(["all"])).astype(str)) | set(env.wave_wind)
    wave_mult = {}
    for w in waves:
        wind = env.wave_wind.get(w, 0.0)
        wave_mult[w] = wind_course_fit_adjust(base_mult, wind / max(0.0001, 0.5 + cmeta["exposure"]), cmeta["exposure"])
    wave_mult.setdefault("all", base_mult)

    partner_adj = partner_adjustments(field, player_skills, cfg["partners"])
    e_df = expected_scores(player_skills, field, wave_mult, env, partner_adj)
    e_df = assign_score_sd(e_df, env, cfg)
    summary, sims = predictive_summary(e_df, cfg)
    board = value_board(summary, sims, bundle.lines, cfg)

    return PipelineResult(
        summary=summary,
        board=board,
        sims=sims,
        player_skills=player_skills,
        multipliers=base_mult,
        field_strength=fs,
        env_par=env.par,
        course_base=env.course_base,
        wave_wind=env.wave_wind,
        event_id=bundle.event_id,
        course_id=bundle.course_id,
        round_num=bundle.round_num,
        sources=bundle.sources,
    )
