"""Generate deterministic synthetic sample data (scores only) so the app runs
with no network. Mirrors the free-data shape: per-round scores, an upcoming
field with AM/PM waves + weather, and FanDuel-style round Over/Under lines.

Run: ``python -m golfmodel.data.generate_sample``
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from ..config import DATA_DIR, course_meta, courses
from ..features import weather as wx

SAMPLE_DIR = DATA_DIR / "sample"
REF_DATE = datetime(2026, 6, 18, 0, 0, 0)
N_PLAYERS = 60
SEED = 7


def _american_from_prob(p: float, vig: float = 0.045) -> int:
    p_book = min(0.97, max(0.03, p + vig / 2))
    dec = 1.0 / p_book
    if dec >= 2.0:
        return int(round((dec - 1.0) * 100))
    return int(round(-100.0 / (dec - 1.0)))


def _normal_cdf(x, mu, sd):
    from math import erf, sqrt

    return 0.5 * (1 + erf((x - mu) / (sd * sqrt(2))))


def generate() -> dict:
    from ..config import settings

    rng = np.random.default_rng(SEED)
    cfg = settings()
    base_sd = cfg["distribution"]["base_score_sd"]
    sample_courses = [cid for cid in courses() if cid.startswith("sample_")]

    players = [
        {
            "player_id": f"P{i:03d}",
            "player_name": f"Player {i:03d}",
            "skill": float(rng.normal(0.0, 1.6)),       # strokes vs field
            "course_pref": {cid: float(rng.normal(0, 0.6)) for cid in sample_courses},
            "consistency": float(rng.uniform(0.85, 1.2)),
        }
        for i in range(N_PLAYERS)
    ]
    course_base = {cid: float(rng.normal(-1.0, 1.0)) for cid in sample_courses}

    rows = []
    n_events = 70
    for e in range(n_events):
        cid = sample_courses[e % len(sample_courses)]
        meta = course_meta(cid)
        ev_date = REF_DATE - timedelta(days=int(7 * (n_events - e)) + int(rng.integers(0, 3)))
        field_players = rng.choice(players, size=int(rng.integers(40, 56)), replace=False)
        for rnd in range(1, 3):
            wind = float(max(0.0, rng.normal(8.0, 5.0)))
            precip = 1.0 if rng.random() < 0.12 else 0.0
            shock = float(rng.normal(0.0, cfg["distribution"]["shared_shock_sd"]))
            weather_pen = wx.strokes_shift(wind, precip, meta["exposure"], cfg["weather"])
            sd_mult = wx.sd_multiplier(wind, meta["exposure"], cfg["weather"])
            for p in field_players:
                skill = p["skill"] + p["course_pref"][cid]
                noise = float(rng.normal(0, base_sd * p["consistency"] * sd_mult))
                to_par = course_base[cid] - skill + weather_pen + shock + noise
                score = meta["par"] + to_par
                rows.append(
                    {
                        "player_id": p["player_id"],
                        "player_name": p["player_name"],
                        "event_id": f"H{e:03d}",
                        "course_id": cid,
                        "tour": "pga",
                        "date": ev_date,
                        "round_num": rnd,
                        "score": round(score, 1),
                        "to_par": round(to_par, 1),
                        "par": meta["par"],
                    }
                )
    rounds = pd.DataFrame(rows)

    # Upcoming event: one round, AM/PM waves, weather, lines.
    up_event, up_course, up_round = "U001", sample_courses[0], 2
    up_meta = course_meta(up_course)
    up_date = REF_DATE + timedelta(days=1)
    field_players = list(rng.choice(players, size=48, replace=False))
    wave_cond = {"AM": {"wind": 7.0, "precip": 0.0, "temp": 17.0}, "PM": {"wind": 19.0, "precip": 1.0, "temp": 21.0}}

    field_rows, weather_rows, line_rows = [], [], []
    for wave, cond in wave_cond.items():
        weather_rows.append(
            {"event_id": up_event, "course_id": up_course, "round_num": up_round, "wave": wave,
             "wind_mph": round(cond["wind"], 1), "precip": cond["precip"], "temp_c": cond["temp"]}
        )
    tee0 = up_date.replace(hour=7)
    for idx, p in enumerate(field_players):
        wave = "AM" if idx < len(field_players) // 2 else "PM"
        offset = (idx % (len(field_players) // 2)) * 11
        tee = tee0 + timedelta(minutes=offset + (0 if wave == "AM" else 300))
        field_rows.append(
            {"event_id": up_event, "course_id": up_course, "round_num": up_round, "player_id": p["player_id"],
             "player_name": p["player_name"], "tee_time": tee, "wave": wave, "group_id": f"G{idx // 3:02d}"}
        )
        cond = wave_cond[wave]
        weather_pen = wx.strokes_shift(cond["wind"], cond["precip"], up_meta["exposure"], cfg["weather"])
        skill = p["skill"] + p["course_pref"][up_course]
        true_mean = up_meta["par"] + course_base[up_course] - skill + weather_pen
        true_sd = base_sd * p["consistency"]
        line = round(true_mean * 2) / 2 + float(rng.choice([-0.5, 0.0, 0.0, 0.5]))
        p_over = 1.0 - _normal_cdf(line, true_mean, true_sd)
        line_rows.append(
            {"market": "round_ou", "book": "FanDuel", "event_id": up_event, "round_num": up_round,
             "player_id": p["player_id"], "line": float(line), "over_price": _american_from_prob(p_over),
             "under_price": _american_from_prob(1 - p_over), "captured_at": REF_DATE, "opponent_id": ""}
        )

    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    rounds.to_parquet(SAMPLE_DIR / "rounds.parquet", index=False)
    pd.DataFrame(field_rows).to_parquet(SAMPLE_DIR / "field.parquet", index=False)
    pd.DataFrame(line_rows).to_parquet(SAMPLE_DIR / "lines.parquet", index=False)
    pd.DataFrame(weather_rows).to_parquet(SAMPLE_DIR / "weather.parquet", index=False)
    meta = {"event_id": up_event, "course_id": up_course, "round_num": up_round,
            "asof": REF_DATE.isoformat(), "event_date": up_date.isoformat()}
    (SAMPLE_DIR / "meta.json").write_text(json.dumps(meta, indent=2))
    return meta


if __name__ == "__main__":
    m = generate()
    print(f"Sample data written to {SAMPLE_DIR} for event {m['event_id']} ({m['course_id']} R{m['round_num']}).")
