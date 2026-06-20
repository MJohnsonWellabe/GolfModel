"""The most important test: features must never see data at/after the cutoff."""
from __future__ import annotations

from datetime import datetime

import pandas as pd
import pytest

from golfmodel.features.asof import apply_asof, assert_no_lookahead
from golfmodel.features.decay import decay_weights
from golfmodel.data.adapters.sample import SampleAdapter


def _frame():
    return pd.DataFrame(
        {
            "date": pd.to_datetime(["2026-01-01", "2026-06-01", "2026-06-20", "2026-07-01"]),
            "value": [1, 2, 3, 4],
        }
    )


def test_apply_asof_excludes_cutoff_and_future():
    cutoff = datetime(2026, 6, 20)
    out = apply_asof(_frame(), cutoff)
    assert out["date"].max() < pd.Timestamp(cutoff)
    assert set(out["value"]) == {1, 2}  # the 06-20 row is excluded (strict <)


def test_assert_no_lookahead_raises_on_leak():
    cutoff = datetime(2026, 6, 1)
    with pytest.raises(AssertionError):
        assert_no_lookahead(_frame(), cutoff)


def test_decay_weights_never_weight_future_rows():
    asof = datetime(2026, 6, 20)
    w = decay_weights(_frame()["date"], asof, halflife_days=180, max_age_days=730)
    # rows on/after asof (06-20, 07-01) must have zero weight
    assert w[2] == 0.0 and w[3] == 0.0
    assert w[0] > 0 and w[1] > 0


def test_sample_adapter_respects_asof():
    adapter = SampleAdapter()
    asof = datetime(2026, 1, 1)
    df = adapter.rounds_sg(asof)
    assert (pd.to_datetime(df["date"]) < pd.Timestamp(asof)).all()
