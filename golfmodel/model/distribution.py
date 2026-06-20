"""Predictive round-score distribution: per-player variance + summary stats and
market probabilities derived from the Monte-Carlo simulation.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..features.environment import Environment
from .simulate import simulate_field


def assign_score_sd(e_df: pd.DataFrame, env: Environment, cfg: dict) -> pd.DataFrame:
    """Add a ``score_sd`` column: player consistency shrunk toward the field, then
    amplified by the wave's weather SD multiplier and floored at the base SD.
    """
    dcfg = cfg["distribution"]
    base = float(dcfg["base_score_sd"])
    k = float(dcfg["sd_shrinkage_k"])
    if e_df.empty:
        return e_df.assign(score_sd=[])
    field_sd = float(e_df["score_sd_raw"].median())

    out = e_df.copy()
    n = np.nan_to_num(out["n_eff"].to_numpy(), nan=0.0)
    raw = np.nan_to_num(out["score_sd_raw"].to_numpy(), nan=base)
    field_sd = base if not np.isfinite(field_sd) or field_sd <= 0 else field_sd
    shrunk = (n * raw + k * field_sd) / (n + k)
    shrunk = np.maximum(np.nan_to_num(shrunk, nan=base), 0.6 * base)
    sd_mult = out["wave"].map(lambda w: env.wave_sd_mult.get(str(w), 1.0)).to_numpy()
    sd_mult = np.nan_to_num(sd_mult.astype(float), nan=1.0)
    out["score_sd"] = np.clip(shrunk * sd_mult, 0.5 * base, None)
    # Drop any player whose expected score is non-finite (bad/insufficient data).
    out = out[np.isfinite(out["e_strokes"].to_numpy())].reset_index(drop=True)
    return out


def predictive_summary(players: pd.DataFrame, cfg: dict) -> tuple[pd.DataFrame, np.ndarray]:
    """Simulate and return (per-player summary, sims matrix).

    Summary columns: e_score, p10, p25, p50, p75, p90, sd_sim.
    """
    sims = simulate_field(players, cfg)
    q = np.quantile(sims, [0.10, 0.25, 0.50, 0.75, 0.90], axis=0)
    summary = players.copy().reset_index(drop=True)
    summary["e_score"] = sims.mean(axis=0)
    summary["p10"] = q[0]
    summary["p25"] = q[1]
    summary["p50"] = q[2]
    summary["p75"] = q[3]
    summary["p90"] = q[4]
    summary["sd_sim"] = sims.std(axis=0)
    return summary, sims


def prob_over(sims_col: np.ndarray, line: float) -> float:
    """P(score strictly greater than the line) — a push (==) counts as half."""
    over = np.mean(sims_col > line)
    push = np.mean(np.isclose(sims_col, line))
    return float(over + 0.5 * push)


def matchup_prob(sims: np.ndarray, i: int, j: int) -> float:
    """P(player i beats player j) = P(lower score), ties split."""
    a, b = sims[:, i], sims[:, j]
    win = np.mean(a < b)
    tie = np.mean(np.isclose(a, b))
    return float(win + 0.5 * tie)
