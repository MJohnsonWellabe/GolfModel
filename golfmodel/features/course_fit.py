"""Course-fit: which strokes-gained categories matter most at THIS course.

Ridge-regresses historical per-round ``to_par`` at the course on the four SG
components; the coefficient magnitudes reveal category importance. Blended toward
the course's attribute prior when course history is thin. Returns per-category
multipliers with mean 1 (neutral course == all 1s == plain SG total).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

from ..data.schemas import SG_CATEGORIES


def _normalize_mean1(weights: dict[str, float]) -> dict[str, float]:
    vals = np.array([weights[c] for c in SG_CATEGORIES], dtype=float)
    vals = np.clip(vals, 0.05, None)
    vals = vals / vals.mean()
    return {c: float(v) for c, v in zip(SG_CATEGORIES, vals)}


def course_fit_multipliers(
    course_rounds: pd.DataFrame,
    attribute_prior: dict[str, float],
    ridge_alpha: float,
    prior_strength: float,
) -> dict[str, float]:
    """Blend empirical (ridge) importance with the attribute prior."""
    prior = _normalize_mean1({c: float(attribute_prior.get(c, 1.0)) for c in SG_CATEGORIES})

    n = len(course_rounds)
    if n < 8:
        return prior  # not enough history to trust the regression

    x = course_rounds[SG_CATEGORIES].to_numpy(dtype=float)
    y = course_rounds["to_par"].to_numpy(dtype=float)
    model = Ridge(alpha=ridge_alpha, fit_intercept=True)
    model.fit(x, y)
    # More negative coefficient => that category separates scoring more here.
    importance = {c: abs(float(b)) for c, b in zip(SG_CATEGORIES, model.coef_)}
    emp = _normalize_mean1(importance)

    blend = n / (n + prior_strength)
    combined = {c: blend * emp[c] + (1 - blend) * prior[c] for c in SG_CATEGORIES}
    return _normalize_mean1(combined)
