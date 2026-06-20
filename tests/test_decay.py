"""Time-decay weighting + decayed player table (score-based)."""
from __future__ import annotations

from datetime import datetime

import pandas as pd
import pytest

from golfmodel.features.decay import add_field_relative_gain, decay_weights, decayed_player_table


def test_halflife_halves_weight():
    asof = datetime(2026, 6, 20)
    dates = pd.to_datetime([asof, asof - pd.Timedelta(days=180)]) - pd.Timedelta(seconds=1)
    w = decay_weights(pd.Series(dates), asof, halflife_days=180, max_age_days=10000)
    assert w[1] / w[0] == pytest.approx(0.5, rel=1e-3)


def test_field_relative_gain_is_field_centered():
    df = pd.DataFrame(
        {
            "player_id": ["A", "B"], "player_name": ["A", "B"],
            "event_id": ["E", "E"], "round_num": [1, 1], "par": [70, 70],
            "date": pd.to_datetime(["2026-01-01", "2026-01-01"]), "score": [68.0, 72.0],
            "to_par": [-2.0, 2.0], "course_id": ["c", "c"],
        }
    )
    g = add_field_relative_gain(df)
    # field mean = 70; A gains +2, B gains -2
    assert g.set_index("player_id")["gain"].to_dict() == {"A": 2.0, "B": -2.0}


def test_recent_rounds_dominate_mean():
    asof = datetime(2026, 6, 20)
    rows = []
    for d, val in [(700, -1.0), (10, 1.0)]:  # old bad, recent good
        for _ in range(5):
            rows.append({"player_id": "P1", "player_name": "P1",
                         "date": asof - pd.Timedelta(days=d), "to_par": -val, "gain": val})
    df = pd.DataFrame(rows)
    table = decayed_player_table(df, asof, halflife_days=120, max_age_days=10000, value_col="gain")
    assert table.iloc[0]["value"] > 0  # leans toward recent (+) rounds
