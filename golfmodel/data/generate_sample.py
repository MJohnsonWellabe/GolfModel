"""Generate deterministic synthetic sample data so the app runs with no secrets.

Creates a small but realistic world: ~60 players with latent per-category skill,
~2 seasons of rounds across the sample courses (with strokes-gained + scores that
respect course-fit and weather), plus one upcoming round with a field, tee-time
waves, weather, and FanDuel-style Over/Under + matchup lines.

Run: ``python -m golfmodel.data.generate_sample``
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from ..config import DATA_DIR, course_meta, courses, settings
from ..features import weather as wx
from .schemas import SG_CATEGORIES

SAMPLE_DIR = DATA_DIR / "sample"
REF_DATE = datetime(2026, 6, 18, 0, 0, 0)  # "today" for the sample world
N_PLAYERS = 60
SEED = 7


def _american_from_prob(p: float, vig: float = 0.045) -> int:
    """Convert a true probability to an American price with a bit of vig baked in."""
    p_book = min(0.97, max(0.03, p + vig / 2))
    dec = 1.0 / p_book
    if dec >= 2.0:
        return int(round((dec - 1.0) * 100))
    return int(round(-100.0 / (dec - 1.0)))


def generate() -> dict:
    rng = np.random.default_rng(SEED)
    course_ids = list(courses().keys())
    cfg = settings()
    base_sd = cfg["distribution"]["base_score_sd"]

    # --- latent player skills (SG vs tour average, per category) ---
    players = []
    for i in range(N_PLAYERS):
        skill = {c: float(rng.normal(0.0, 0.55)) for c in SG_CATEGORIES}
        players.append(
            {
                "player_id": f"P{i:03d}",
                "player_name": f"Player {i:03d}",
                "skill": skill,
                "consistency": float(rng.uniform(0.85, 1.2)),  # SD multiplier
            }
        )

    # --- course neutral difficulty (to-par for a tour-average player, calm) ---
    course_base = {cid: float(rng.normal(-1.0, 1.0)) for cid in course_ids}

    # --- historical rounds over ~500 days ---
    rows = []
    n_events = 70
    for e in range(n_events):
        cid = course_ids[e % len(course_ids)]
        meta = course_meta(cid)
        ev_date = REF_DATE - timedelta(days=int(7 * (n_events - e)) + int(rng.integers(0, 3)))
        prior = meta["attribute_prior"]
        field_players = rng.choice(players, size=int(rng.integers(40, 56)), replace=False)
        event_field_sg = float(np.mean([sum(p["skill"].values()) for p in field_players]))
        exposure = meta["exposure"]
        for rnd in range(1, 3):  # 2 sample rounds per historical event
            wind = float(max(0.0, rng.normal(8.0, 5.0)))  # raw wind; exposure applied in feature
            precip = 1.0 if rng.random() < 0.12 else 0.0
            shock = float(rng.normal(0.0, cfg["distribution"]["shared_shock_sd"]))
            weather_pen = wx.strokes_shift(wind, precip, exposure, cfg["weather"])
            sd_mult = wx.sd_multiplier(wind, exposure, cfg["weather"])
            for p in field_players:
                # course-weighted skill: prior multipliers (mean 1) reweight categories
                cat_sg = {c: p["skill"][c] + rng.normal(0, 0.35) for c in SG_CATEGORIES}
                weighted = sum(prior[c] * cat_sg[c] for c in SG_CATEGORIES)
                sg_total = sum(cat_sg.values())
                noise_sd = base_sd * p["consistency"] * sd_mult
                to_par = (
                    course_base[cid] - weighted + weather_pen + shock + float(rng.normal(0, noise_sd))
                )
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
                        **{c: round(cat_sg[c], 3) for c in SG_CATEGORIES},
                        "sg_total": round(sg_total, 3),
                        "score": round(score, 1),
                        "to_par": round(to_par, 1),
                        "field_strength": round(event_field_sg, 3),
                        "wind_mph": round(wind, 1),
                    }
                )
    rounds_sg = pd.DataFrame(rows)

    # --- upcoming event: one round, AM/PM waves, weather, lines ---
    up_event = "U001"
    up_course = course_ids[0]
    up_round = 2
    up_meta = course_meta(up_course)
    up_date = REF_DATE + timedelta(days=1)
    field_players = list(rng.choice(players, size=48, replace=False))

    field_rows, weather_rows, line_rows = [], [], []
    # Two waves with deliberately different raw conditions (the round-O/U edge).
    wave_cond = {
        "AM": {"wind": 7.0, "precip": 0.0, "temp": 17.0},
        "PM": {"wind": 19.0, "precip": 1.0, "temp": 21.0},
    }
    for wave, cond in wave_cond.items():
        weather_rows.append(
            {
                "event_id": up_event,
                "course_id": up_course,
                "round_num": up_round,
                "wave": wave,
                "wind_mph": round(cond["wind"], 1),
                "precip": cond["precip"],
                "temp_c": cond["temp"],
            }
        )

    tee0 = up_date.replace(hour=7)
    for idx, p in enumerate(field_players):
        wave = "AM" if idx < len(field_players) // 2 else "PM"
        group = idx // 3
        offset = (idx % (len(field_players) // 2)) * 11
        tee = tee0 + timedelta(minutes=offset + (0 if wave == "AM" else 300))
        field_rows.append(
            {
                "event_id": up_event,
                "course_id": up_course,
                "round_num": up_round,
                "player_id": p["player_id"],
                "player_name": p["player_name"],
                "tee_time": tee,
                "wave": wave,
                "group_id": f"G{group:02d}",
            }
        )
        # A "true" expected score to derive plausible book lines (model must rediscover it).
        cond = wave_cond[wave]
        weather_pen = wx.strokes_shift(cond["wind"], cond["precip"], up_meta["exposure"], cfg["weather"])
        weighted = sum(up_meta["attribute_prior"][c] * p["skill"][c] for c in SG_CATEGORIES)
        true_mean = up_meta["par"] + course_base[up_course] - weighted + weather_pen
        true_sd = base_sd * p["consistency"]
        # FanDuel-style round Over/Under: line near true mean, slightly rounded; add vig.
        line = round(true_mean * 2) / 2 + float(rng.choice([-0.5, 0.0, 0.0, 0.5]))
        p_over = 1.0 - _normal_cdf(line, true_mean, true_sd)
        line_rows.append(
            {
                "market": "round_ou",
                "book": "FanDuel",
                "event_id": up_event,
                "round_num": up_round,
                "player_id": p["player_id"],
                "line": float(line),
                "over_price": _american_from_prob(p_over),
                "under_price": _american_from_prob(1 - p_over),
                "captured_at": REF_DATE,
                "opponent_id": "",
            }
        )

    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    rounds_sg.to_parquet(SAMPLE_DIR / "rounds_sg.parquet", index=False)
    pd.DataFrame(field_rows).to_parquet(SAMPLE_DIR / "field.parquet", index=False)
    pd.DataFrame(line_rows).to_parquet(SAMPLE_DIR / "lines.parquet", index=False)
    pd.DataFrame(weather_rows).to_parquet(SAMPLE_DIR / "weather.parquet", index=False)
    meta = {
        "event_id": up_event,
        "course_id": up_course,
        "round_num": up_round,
        "asof": REF_DATE.isoformat(),
        "event_date": up_date.isoformat(),
    }
    (SAMPLE_DIR / "meta.json").write_text(json.dumps(meta, indent=2))
    return meta


def _normal_cdf(x: float, mu: float, sd: float) -> float:
    from math import erf, sqrt

    return 0.5 * (1 + erf((x - mu) / (sd * sqrt(2))))


if __name__ == "__main__":
    m = generate()
    print(f"Sample data written to {SAMPLE_DIR} for event {m['event_id']} "
          f"({m['course_id']} R{m['round_num']}).")
