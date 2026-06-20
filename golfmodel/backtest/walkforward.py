"""Walk-forward backtest over historical rounds with a strict as-of firewall.

For each played round (chronologically) we rebuild the score-based rating from
data dated strictly before that round, predict the score distribution, and score
it against the actual result. An *independent* line (each player's season-to-date
mean) tests the calibration of our Over/Under probabilities and drives a synthetic
flat-stake betting simulation.

Honesty notes:
- Backtest runs weather-free (free historical weather-by-tee-time isn't wired in).
- ROI is vs a SYNTHETIC vig'd line from the naive baseline (mechanics demo only);
  real ROI/CLV require captured FanDuel prices.
"""
from __future__ import annotations

import copy

import numpy as np
import pandas as pd

from ..config import course_meta, settings
from ..features.environment import compute_environment
from ..model.baseline import compute_player_skills
from ..model.distribution import assign_score_sd, predictive_summary, prob_over
from ..model.sg_to_strokes import expected_scores
from ..betting.vig import american_to_decimal, prob_to_american, remove_vig_two_way
from . import baselines, metrics_bet, metrics_pred

_EMPTY_WEATHER = pd.DataFrame(columns=["wave", "wind_mph", "precip", "temp_c"])


def run_backtest(rounds: pd.DataFrame, cfg: dict | None = None, *, warmup_events: int = 20,
                 n_sims: int = 4000, min_edge: float | None = None) -> dict:
    cfg = copy.deepcopy(cfg or settings())
    cfg["distribution"]["monte_carlo_sims"] = n_sims
    cfg["partners"]["enabled"] = False
    edge_thr = cfg["betting"]["min_edge"] if min_edge is None else min_edge

    rounds = rounds.copy()
    rounds["date"] = pd.to_datetime(rounds["date"])
    keys = (
        rounds[["event_id", "round_num", "date", "course_id"]]
        .drop_duplicates().sort_values("date").reset_index(drop=True)
    )

    records = []
    field_sd_global = float(rounds["to_par"].std())

    for n, key in keys.iterrows():
        if n < warmup_events:
            continue
        asof, cid = key["date"], key["course_id"]
        this_round = rounds[(rounds["event_id"] == key["event_id"]) & (rounds["round_num"] == key["round_num"])]
        prior = rounds[rounds["date"] < asof]
        if prior.empty:
            continue

        field_ids = this_round["player_id"].tolist()
        skills, _ = compute_player_skills(prior, field_ids, cid, asof, cfg)
        if skills.empty:
            continue
        course_rounds = prior[prior["course_id"] == cid]
        env = compute_environment(course_rounds, course_meta(cid), _EMPTY_WEATHER, cfg)

        field = this_round[["player_id", "player_name"]].copy()
        field["wave"] = "all"
        field["group_id"] = ""
        zero = pd.Series(0.0, index=field["player_id"])
        e_df = expected_scores(skills, field, env, zero)
        if e_df.empty:
            continue
        e_df = assign_score_sd(e_df, env, cfg)
        summary, sims = predictive_summary(e_df, cfg)

        line_naive = baselines.season_to_date_mean(rounds, asof)
        actual = this_round.set_index("player_id")["score"]
        for i, prow in summary.reset_index(drop=True).iterrows():
            pid = prow["player_id"]
            if pid not in actual.index or pid not in line_naive.index:
                continue
            y, line = float(actual.loc[pid]), float(line_naive.loc[pid])
            p_over = prob_over(sims[:, i], line)
            outcome = 1.0 if y > line else 0.0

            mkt_p_over = 0.5
            over_price = prob_to_american(min(0.97, mkt_p_over + 0.025))
            under_price = prob_to_american(min(0.97, (1 - mkt_p_over) + 0.025))
            p_nv_over, _ = remove_vig_two_way(over_price, under_price, cfg["betting"]["vig_method"])
            edge_over = p_over - p_nv_over
            if edge_over >= -edge_over:
                price, won, edge, entry_novig = over_price, outcome, edge_over, p_nv_over
            else:
                price, won, edge, entry_novig = under_price, 1 - outcome, -edge_over, 1 - p_nv_over

            records.append(
                {
                    "date": asof, "player_id": pid, "pred": float(prow["e_score"]), "actual": y,
                    "p10": float(prow["p10"]), "p90": float(prow["p90"]),
                    "crps": metrics_pred.crps_sample(sims[:, i], y),
                    "naive_pred": line, "p_over": p_over, "outcome": outcome,
                    "bet": 1.0 if edge >= edge_thr else 0.0, "bet_won": won,
                    "bet_dec": american_to_decimal(price), "entry_novig": entry_novig,
                }
            )

    return _aggregate(pd.DataFrame(records), field_sd_global)


def _aggregate(df: pd.DataFrame, field_sd: float) -> dict:
    if df.empty:
        return {"n_predictions": 0, "note": "no backtestable rounds (insufficient history)"}

    pred, actual, naive = df["pred"].to_numpy(), df["actual"].to_numpy(), df["naive_pred"].to_numpy()
    bets = df[df["bet"] == 1.0]
    settle = (
        metrics_bet.settle_flat(np.ones(len(bets)), bets["bet_dec"].to_numpy(), bets["bet_won"].to_numpy())
        if not bets.empty else {"roi": 0.0, "hit_rate": 0.0, "n_bets": 0, "profit": 0.0}
    )
    bank, cum = [], 0.0
    for _, r in bets.sort_values("date").iterrows():
        cum += (r["bet_dec"] - 1.0) if r["bet_won"] else -1.0
        bank.append({"date": str(pd.Timestamp(r["date"]).date()), "bankroll": round(cum, 3)})

    return {
        "n_predictions": int(len(df)),
        "date_range": [str(df["date"].min().date()), str(df["date"].max().date())],
        "prediction": {
            "rmse": round(metrics_pred.rmse(pred, actual), 4),
            "mae": round(metrics_pred.mae(pred, actual), 4),
            "rmse_naive": round(metrics_pred.rmse(naive, actual), 4),
            "interval_coverage_80": round(metrics_pred.interval_coverage(df["p10"], df["p90"], actual), 4),
            "crps": round(float(df["crps"].mean()), 4),
        },
        "over_under": {
            "brier": round(metrics_bet.brier(df["p_over"], df["outcome"]), 4),
            "brier_baseline_0.5": round(metrics_bet.brier(np.full(len(df), 0.5), df["outcome"].to_numpy()), 4),
            "log_loss": round(metrics_bet.log_loss(df["p_over"], df["outcome"]), 4),
            "reliability": metrics_bet.reliability_curve(df["p_over"].to_numpy(), df["outcome"].to_numpy()),
        },
        "betting_synthetic": settle,
        "bankroll_curve": bank,
        "disclaimer": "ROI is vs a synthetic vig'd line (mechanics demo). Real ROI/CLV need captured book prices.",
    }
