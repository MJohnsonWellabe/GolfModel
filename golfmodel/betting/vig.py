"""American-odds conversions and two-way vig removal."""
from __future__ import annotations

import numpy as np


def american_to_decimal(price: float) -> float:
    price = float(price)
    if price > 0:
        return 1.0 + price / 100.0
    return 1.0 + 100.0 / abs(price)


def american_to_prob(price: float) -> float:
    """Implied (vig-inclusive) probability from an American price."""
    return 1.0 / american_to_decimal(price)


def prob_to_american(p: float) -> int:
    p = min(0.999, max(0.001, float(p)))
    dec = 1.0 / p
    if dec >= 2.0:
        return int(round((dec - 1.0) * 100))
    return int(round(-100.0 / (dec - 1.0)))


def remove_vig_two_way(over_price: float, under_price: float, method: str = "multiplicative") -> tuple[float, float]:
    """Return (p_over, p_under) with the vig removed so they sum to 1."""
    po = american_to_prob(over_price)
    pu = american_to_prob(under_price)
    if method == "shin":
        return _shin(po, pu)
    total = po + pu
    if total <= 0:
        return 0.5, 0.5
    return po / total, pu / total


def _shin(po: float, pu: float) -> tuple[float, float]:
    """Shin's method: back out insider-trading proportion z, then fair probs."""
    booksum = po + pu
    qs = np.array([po, pu]) / booksum
    # Solve for z in [0, 0.2] minimizing implied overround mismatch.
    best_z, best_err = 0.0, float("inf")
    for z in np.linspace(0.0, 0.2, 201):
        fair = (np.sqrt(z * z + 4 * (1 - z) * qs * qs * booksum) - z) / (2 * (1 - z))
        err = abs(fair.sum() - 1.0)
        if err < best_err:
            best_err, best_z = err, z
    z = best_z
    fair = (np.sqrt(z * z + 4 * (1 - z) * qs * qs * booksum) - z) / (2 * (1 - z))
    fair = fair / fair.sum()
    return float(fair[0]), float(fair[1])
