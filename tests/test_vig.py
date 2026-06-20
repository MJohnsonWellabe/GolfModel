"""Vig removal and odds-conversion invariants."""
from __future__ import annotations

import pytest

from golfmodel.betting.edge import ev_per_unit, kelly_fraction
from golfmodel.betting.vig import (
    american_to_decimal,
    american_to_prob,
    prob_to_american,
    remove_vig_two_way,
)


def test_american_conversions_roundtrip():
    for price in (-200, -110, 100, 150, 250):
        p = american_to_prob(price)
        assert 0 < p < 1
        assert prob_to_american(p) == pytest.approx(price, abs=2)


def test_even_money_decimal():
    assert american_to_decimal(100) == pytest.approx(2.0)
    assert american_to_decimal(-100) == pytest.approx(2.0)


@pytest.mark.parametrize("method", ["multiplicative", "shin"])
def test_remove_vig_sums_to_one(method):
    p_over, p_under = remove_vig_two_way(-110, -110, method)
    assert p_over + p_under == pytest.approx(1.0, abs=1e-6)
    assert p_over == pytest.approx(0.5, abs=0.02)


def test_vig_inclusive_probs_exceed_one():
    # raw implied probs include the hold, so they sum to > 1
    assert american_to_prob(-110) + american_to_prob(-110) > 1.0


def test_ev_and_kelly_positive_when_model_beats_price():
    # model says 60% on a +100 (even) bet -> positive EV and positive Kelly
    assert ev_per_unit(0.60, 100) == pytest.approx(0.20, abs=1e-6)
    assert kelly_fraction(0.60, 100) > 0


def test_ev_negative_when_model_below_price():
    assert ev_per_unit(0.40, 100) < 0
    assert kelly_fraction(0.40, 100) == 0.0
