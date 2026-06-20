"""Canonical schema validation + adapter conformance."""
from __future__ import annotations

import pandas as pd
import pytest

from golfmodel.data.adapters.sample import SampleAdapter
from golfmodel.data.schemas import FIELD, LINES, ROUNDS_SG, validate


def test_validate_missing_column_raises():
    df = pd.DataFrame({"player_id": ["a"]})
    with pytest.raises(ValueError):
        validate(df, ROUNDS_SG)


def test_validate_coerces_and_orders():
    raw = {c: [0] for c in ROUNDS_SG.required}
    raw["date"] = ["2026-01-01"]
    raw["player_id"] = ["P1"]
    out = validate(pd.DataFrame(raw), ROUNDS_SG)
    assert list(out.columns)[: len(ROUNDS_SG.required)] == ROUNDS_SG.required
    assert str(out["date"].dtype).startswith("datetime")


def test_sample_adapter_conforms_to_schemas():
    a = SampleAdapter()
    validate(a.rounds_sg(), ROUNDS_SG)
    validate(a.field(), FIELD)
    validate(a.lines(), LINES)  # should not raise
