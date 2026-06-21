"""Walk-forward score-prediction backtest with a strict as-of firewall.

For each played round (chronologically) we rebuild the score-based rating from
data dated strictly before that round, predict the score distribution, and score
it against the actual result. By default we *test* on the target year (e.g. 2026),
using everything before each round (incl. prior years) as training history — so it
answers "what would the model have predicted for this year's rounds, vs reality?"

A naive baseline (each player's prior-rounds mean score) is scored alongside.
"""
from __future__ import annotations

import copy

import numpy as np
import pandas as pd

from ..config import course_meta, settings
from ..features.environment import compute_environment
from ..model.baseline import compute_player_skills
from ..model.distribution import assign_score_sd, predictive_summary
from ..model.sg_to_strokes import expected_scores
from . import baselines, metrics_pred

_EMPTY_WEATHER = pd.DataFrame(columns=["wave", "wind_mph", "precip", "temp_c"])


def run_backtest(
    rounds: pd.DataFrame,
    cfg: dict | None = None,
    *,
    test_year: int | None = 2026,
    min_history_rounds: int = 2000,
    n_sims: int = 2500,
) -> dict:
    cfg = copy.deepcopy(cfg or settings())
    cfg["distribution"]["monte_carlo_sims"] = n_sims
    cfg["partners"]["enabled"] = False

    rounds = rounds.copy()
    rounds["date"] = pd.to_datetime(rounds["date"])
    keys = (
        rounds[["event_id", "round_num", "date", "course_id"]]
        .drop_duplicates().sort_values("date").reset_index(drop=True)
    )

    records = []
    for _, key in keys.iterrows():
        asof, cid = key["date"], key["course_id"]
        if test_year is not None and asof.year != test_year:
            continue
        this_round = rounds[(rounds["event_id"] == key["event_id"]) & (rounds["round_num"] == key["round_num"])]
        prior = rounds[rounds["date"] < asof]
        if len(prior) < min_history_rounds:
            continue  # not enough history to make a fair prediction yet

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

        naive = baselines.season_to_date_mean(rounds, asof)
        actual = this_round.set_index("player_id")["score"]
        event_name = course_meta(cid).get("name", cid)
        for i, prow in summary.reset_index(drop=True).iterrows():
            pid = prow["player_id"]
            if pid not in actual.index or pid not in naive.index:
                continue
            records.append(
                {
                    "date": asof, "event": event_name, "round_num": int(key["round_num"]),
                    "player_id": pid, "player_name": prow["player_name"],
                    "pred": float(prow["e_score"]), "actual": float(actual.loc[pid]),
                    "p10": float(prow["p10"]), "p90": float(prow["p90"]),
                    "crps": metrics_pred.crps_sample(sims[:, i], float(actual.loc[pid])),
                    "naive": float(naive.loc[pid]),
                }
            )

    return _aggregate(pd.DataFrame(records), test_year)


def _aggregate(df: pd.DataFrame, test_year: int | None) -> dict:
    if df.empty:
        return {"n_predictions": 0, "test_year": test_year,
                "note": "no backtestable rounds (insufficient history for the test window)"}

    pred, actual, naive = df["pred"].to_numpy(), df["actual"].to_numpy(), df["naive"].to_numpy()
    rmse, rmse_naive = metrics_pred.rmse(pred, actual), metrics_pred.rmse(naive, actual)

    # Predicted-vs-actual scatter (down-sampled for the chart).
    samp = df.sample(min(400, len(df)), random_state=0)
    scatter = [{"pred": round(float(r.pred), 1), "actual": round(float(r.actual), 1)} for r in samp.itertuples()]

    # Error histogram (pred - actual).
    err = pred - actual
    counts, edges = np.histogram(err, bins=np.arange(-15.5, 16.5, 1.0))
    error_hist = {"counts": counts.tolist(), "edges": [round(float(e), 1) for e in edges]}

    by_round = []
    for rn, g in df.groupby("round_num"):
        by_round.append({"round": int(rn), "n": int(len(g)),
                         "rmse": round(metrics_pred.rmse(g["pred"], g["actual"]), 3)})

    by_event = []
    for (ev, dt), g in df.groupby(["event", df["date"].dt.date]):
        by_event.append({"event": ev, "date": str(dt), "n": int(len(g)),
                         "rmse": round(metrics_pred.rmse(g["pred"], g["actual"]), 3),
                         "rmse_naive": round(metrics_pred.rmse(g["naive"], g["actual"]), 3)})
    by_event.sort(key=lambda x: x["date"])

    # Best/worst individual predictions (by absolute error).
    df = df.assign(abs_err=(df["pred"] - df["actual"]).abs())
    best = df.nsmallest(8, "abs_err")
    worst = df.nlargest(8, "abs_err")
    def _ex(g):
        return [{"player": r.player_name, "event": r.event, "round": int(r.round_num),
                 "pred": round(float(r.pred), 1), "actual": round(float(r.actual), 1)} for r in g.itertuples()]

    return {
        "schema": 3,
        "test_year": test_year,
        "n_predictions": int(len(df)),
        "n_rounds": int(df.groupby(["event", "round_num", df["date"].dt.date]).ngroups),
        "date_range": [str(df["date"].min().date()), str(df["date"].max().date())],
        "headline": {
            "rmse": round(rmse, 3),
            "mae": round(metrics_pred.mae(pred, actual), 3),
            "rmse_naive": round(rmse_naive, 3),
            "mae_naive": round(metrics_pred.mae(naive, actual), 3),
            "improvement_vs_naive_pct": round(100 * (rmse_naive - rmse) / rmse_naive, 1) if rmse_naive else 0.0,
            "interval_coverage_80": round(metrics_pred.interval_coverage(df["p10"], df["p90"], actual), 3),
            "crps": round(float(df["crps"].mean()), 3),
            "mean_actual": round(float(actual.mean()), 2),
            "mean_pred": round(float(pred.mean()), 2),
        },
        "scatter": scatter,
        "error_hist": error_hist,
        "by_round": by_round,
        "by_event": by_event,
        "examples": {"best": _ex(best), "worst": _ex(worst)},
    }
