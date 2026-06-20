"""Probability calibration (isotonic) for backtested predictions.

Fit on out-of-sample (predicted_prob, outcome) pairs so the model's stated P(Over)
matches realized frequencies. Used by the backtest to report calibrated metrics;
the live pipeline can load a fitted map if available.
"""
from __future__ import annotations

import numpy as np
from sklearn.isotonic import IsotonicRegression


class ProbabilityCalibrator:
    def __init__(self) -> None:
        self._iso: IsotonicRegression | None = None

    def fit(self, probs: np.ndarray, outcomes: np.ndarray) -> "ProbabilityCalibrator":
        probs = np.asarray(probs, dtype=float)
        outcomes = np.asarray(outcomes, dtype=float)
        if len(probs) < 25 or len(np.unique(outcomes)) < 2:
            self._iso = None  # not enough signal; identity map
            return self
        self._iso = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip")
        self._iso.fit(probs, outcomes)
        return self

    def apply(self, probs: np.ndarray) -> np.ndarray:
        probs = np.asarray(probs, dtype=float)
        if self._iso is None:
            return probs
        return self._iso.predict(probs)
