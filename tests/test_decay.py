"""Time-decay weighting + decayed player table."""
from __future__ import annotations

from datetime import datetime

import pandas as pd
import pytest

from golfmodel.features.decay import decay_weights, decayed_player_table
from golfmodel.data.schemas import SG_CATEGORIES


def test_halflife_halves_weight():
    asof = datetime(2026, 6, 20)
    dates = pd.to_datetime([asof - pd.Timedelta(days=0), asof - pd.Timedelta(days=180)])
    # subtract a tiny epsilon so the "now" row isn't treated as future (weight 0)
    dates = dates - pd.Timedelta(seconds=1)
    w = decay_weights(pd.Series(dates), asof, halflife_days=180, max_age_days=10000)
    assert w[1] / w[0] == pytest.approx(0.5, rel=1e-3)


def test_recent_rounds_dominate_mean():
    asof = datetime(2026, 6, 20)
    rows = []
    # old rounds: SG ~ -1 ; recent rounds: SG ~ +1
    for d, val in [(700, -1.0), (10, 1.0)]:
        for _ in range(5):
            rec = {
                "player_id": "P1", "player_name": "P1",
                "date": asof - pd.Timedelta(days=d), "to_par": -val,
            }
            for c in SG_CATEGORIES:
                rec[c] = val / len(SG_CATEGORIES)
            rows.append(rec)
    df = pd.DataFrame(rows)
    table = decayed_player_table(df, asof, halflife_days=120, max_age_days=10000)
    # weighted mean should lean toward the recent (+) rounds
    assert table.iloc[0]["sg_ott"] > 0
