"""Betting / classification metrics: Brier, log-loss, ROI, CLV, hit rate, and a
reliability (calibration) curve.
"""
from __future__ import annotations

import numpy as np


def brier(prob: np.ndarray, outcome: np.ndarray) -> float:
    prob, outcome = np.asarray(prob, float), np.asarray(outcome, float)
    return float(np.mean((prob - outcome) ** 2))


def log_loss(prob: np.ndarray, outcome: np.ndarray, eps: float = 1e-6) -> float:
    prob = np.clip(np.asarray(prob, float), eps, 1 - eps)
    outcome = np.asarray(outcome, float)
    return float(-np.mean(outcome * np.log(prob) + (1 - outcome) * np.log(1 - prob)))


def reliability_curve(prob: np.ndarray, outcome: np.ndarray, bins: int = 10) -> list[dict]:
    """Binned predicted-vs-realized frequencies for a calibration diagram."""
    prob, outcome = np.asarray(prob, float), np.asarray(outcome, float)
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for k in range(bins):
        mask = (prob >= edges[k]) & (prob < edges[k + 1] if k < bins - 1 else prob <= edges[k + 1])
        if mask.sum() == 0:
            continue
        out.append(
            {
                "pred": round(float(prob[mask].mean()), 4),
                "actual": round(float(outcome[mask].mean()), 4),
                "n": int(mask.sum()),
            }
        )
    return out


def settle_flat(stakes: np.ndarray, decimal_odds: np.ndarray, won: np.ndarray) -> dict:
    """Flat-stake bankroll metrics: ROI and hit rate over settled bets."""
    stakes = np.asarray(stakes, float)
    dec = np.asarray(decimal_odds, float)
    won = np.asarray(won, float)
    if stakes.sum() == 0:
        return {"roi": 0.0, "hit_rate": 0.0, "n_bets": 0, "profit": 0.0}
    profit = np.sum(won * stakes * (dec - 1.0) - (1 - won) * stakes)
    return {
        "roi": float(profit / stakes.sum()),
        "hit_rate": float(won.mean()),
        "n_bets": int(len(stakes)),
        "profit": float(profit),
    }


def clv(entry_prob: np.ndarray, close_prob: np.ndarray) -> float:
    """Mean closing-line value: how much our entry no-vig prob beat the close.

    Positive => we consistently bet sides the market moved toward (genuine edge
    signal that needs far fewer samples than ROI).
    """
    entry_prob, close_prob = np.asarray(entry_prob, float), np.asarray(close_prob, float)
    if len(entry_prob) == 0:
        return 0.0
    return float(np.mean(close_prob - entry_prob))
