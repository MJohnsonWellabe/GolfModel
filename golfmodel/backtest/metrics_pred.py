"""Prediction-accuracy metrics: RMSE/MAE, interval coverage, and CRPS."""
from __future__ import annotations

import numpy as np


def rmse(pred: np.ndarray, actual: np.ndarray) -> float:
    pred, actual = np.asarray(pred, float), np.asarray(actual, float)
    return float(np.sqrt(np.mean((pred - actual) ** 2)))


def mae(pred: np.ndarray, actual: np.ndarray) -> float:
    pred, actual = np.asarray(pred, float), np.asarray(actual, float)
    return float(np.mean(np.abs(pred - actual)))


def interval_coverage(lo: np.ndarray, hi: np.ndarray, actual: np.ndarray) -> float:
    """Fraction of actuals inside [lo, hi] (e.g. an 80% interval should give ~0.8)."""
    lo, hi, actual = np.asarray(lo, float), np.asarray(hi, float), np.asarray(actual, float)
    return float(np.mean((actual >= lo) & (actual <= hi)))


def crps_sample(sims_col: np.ndarray, y: float, max_pairs: int = 2000) -> float:
    """Sample CRPS for one prediction: E|S-y| - 0.5 E|S-S'|."""
    s = np.asarray(sims_col, float)
    term1 = np.mean(np.abs(s - y))
    rng = np.random.default_rng(0)
    a = rng.choice(s, size=min(max_pairs, len(s)), replace=True)
    b = rng.choice(s, size=min(max_pairs, len(s)), replace=True)
    term2 = np.mean(np.abs(a - b))
    return float(term1 - 0.5 * term2)
