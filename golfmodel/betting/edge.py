"""Edge and expected value from model probabilities vs offered prices."""
from __future__ import annotations

from .vig import american_to_decimal


def ev_per_unit(model_prob: float, american_price: float) -> float:
    """Expected profit per 1 unit staked at the given price (decimal-1 payout)."""
    dec = american_to_decimal(american_price)
    return float(model_prob * (dec - 1.0) - (1.0 - model_prob))


def kelly_fraction(model_prob: float, american_price: float, cap: float = 1.0) -> float:
    """Full Kelly stake fraction (clamped to [0, cap]); caller scales it down."""
    dec = american_to_decimal(american_price)
    b = dec - 1.0
    if b <= 0:
        return 0.0
    f = (model_prob * dec - 1.0) / b
    return float(min(max(f, 0.0), cap))


def edge_two_way(p_over_model: float, p_over_novig: float) -> dict:
    """Edge for both sides of a two-way market (positive = model likes that side)."""
    return {
        "edge_over": float(p_over_model - p_over_novig),
        "edge_under": float((1 - p_over_model) - (1 - p_over_novig)),
    }
