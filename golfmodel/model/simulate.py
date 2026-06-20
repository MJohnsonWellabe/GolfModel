"""Monte-Carlo simulation of a field's single-round scores.

Each player's idiosyncratic round is drawn from a skew-normal (right tail = blow-up
holes) calibrated to a target mean and SD. A shared per-wave environment shock is
added so players teeing together share conditions — which makes within-wave matchups
correctly cancel the common shock while round-O/U totals retain it.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats


def _skewnorm_params(mean: float, sd: float, skew_a: float) -> tuple[float, float, float]:
    """Solve skew-normal (a, loc, scale) for a target mean and SD."""
    a = float(skew_a)
    delta = a / np.sqrt(1 + a * a)
    # var = scale^2 (1 - 2 delta^2 / pi); mean = loc + scale delta sqrt(2/pi)
    scale = sd / np.sqrt(1 - 2 * delta * delta / np.pi)
    loc = mean - scale * delta * np.sqrt(2 / np.pi)
    return a, loc, scale


def simulate_field(players: pd.DataFrame, cfg: dict) -> np.ndarray:
    """Return a [n_sims, n_players] array of simulated scores.

    ``players`` needs columns: e_strokes, score_sd, wave.
    """
    dcfg = cfg["distribution"]
    n_sims = int(dcfg["monte_carlo_sims"])
    skew = float(dcfg["skew"])
    shock_sd = float(dcfg["shared_shock_sd"])
    rng = np.random.default_rng(int(dcfg["random_seed"]))

    n_players = len(players)
    sims = np.empty((n_sims, n_players), dtype=float)

    # Per-wave shared shocks (same shock for everyone in a wave, each sim).
    waves = players["wave"].astype(str).to_numpy()
    unique_waves = list(dict.fromkeys(waves))
    shocks = {w: rng.normal(0.0, shock_sd, size=n_sims) for w in unique_waves}

    for j, (_, p) in enumerate(players.reset_index(drop=True).iterrows()):
        a, loc, scale = _skewnorm_params(float(p["e_strokes"]), float(p["score_sd"]), skew)
        draws = stats.skewnorm.rvs(a, loc=loc, scale=scale, size=n_sims, random_state=rng)
        sims[:, j] = draws + shocks[str(p["wave"])]
    return sims
