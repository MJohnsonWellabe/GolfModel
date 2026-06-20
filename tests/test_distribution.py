"""Predictive distribution: skew-normal moments, P(Over) monotonicity, end-to-end."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from golfmodel.config import settings
from golfmodel.data.registry import load_bundle
from golfmodel.model.distribution import prob_over
from golfmodel.model.pipeline import run_event
from golfmodel.model.simulate import _skewnorm_params, simulate_field


def test_skewnorm_params_hit_target_moments():
    a, loc, scale = _skewnorm_params(mean=70.0, sd=2.5, skew_a=3.0)
    from scipy import stats

    draws = stats.skewnorm.rvs(a, loc=loc, scale=scale, size=200000, random_state=0)
    assert draws.mean() == pytest.approx(70.0, abs=0.05)
    assert draws.std() == pytest.approx(2.5, abs=0.05)
    assert stats.skew(draws) > 0  # right-skewed


def test_prob_over_monotonic_in_line():
    cfg = settings().copy()
    players = pd.DataFrame({"e_strokes": [70.0], "score_sd": [2.7], "wave": ["all"]})
    sims = simulate_field(players, cfg)
    probs = [prob_over(sims[:, 0], line) for line in [66, 68, 70, 72, 74]]
    assert all(probs[i] >= probs[i + 1] for i in range(len(probs) - 1))


def test_prob_over_at_mean_is_about_half_for_symmetric():
    cfg = settings().copy()
    cfg = {**cfg, "distribution": {**cfg["distribution"], "skew": 0.0, "shared_shock_sd": 0.0}}
    players = pd.DataFrame({"e_strokes": [70.0], "score_sd": [3.0], "wave": ["all"]})
    sims = simulate_field(players, cfg)
    assert prob_over(sims[:, 0], 70.0) == pytest.approx(0.5, abs=0.03)


def test_end_to_end_sample_pipeline_produces_board():
    bundle = load_bundle(source="sample")
    result = run_event(bundle, settings())
    assert len(result.summary) > 0
    assert {"e_score", "p10", "p90"}.issubset(result.summary.columns)
    assert not result.board.empty
    # every probability is a valid probability
    assert result.board["model_prob"].between(0, 1).all()
