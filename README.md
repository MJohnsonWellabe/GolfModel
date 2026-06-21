# GolfModel — Single-Round Score Prediction (free data)

> ⚠️ **ACADEMIC EXERCISE — score prediction only.** A personal/educational study of
> statistical modeling and forecast calibration. Not betting advice. Respect every data
> provider's terms of service.

GolfModel predicts each PGA golfer's **expected single-round score** plus a **predictive
interval**, and **back-tests** itself walk-forward against the rounds that actually
happened this year. It runs entirely on **free data**.

## Free-data design

| Need | Source | Cost |
|---|---|---|
| Round scores, fields, tee times | **ESPN** public golf JSON API | free, no key |
| Weather (wind/precip/temp) | **Open-Meteo** (forecast + historical archive) | free, no key |
| Sample data | bundled synthetic (runs with no network) | n/a |

**No strokes-gained.** Per-round strokes-gained is paid-only (ShotLink/DataGolf), so this
build uses a **score-based rating**: each golfer's time-decayed *strokes gained vs the
field*, empirical-Bayes shrunk toward an average tour player, blended with a
course/cluster-specific rating for course affinity — plus weather/wave and an optional
playing-partner term. Output: an expected score + interval per golfer.

## How it works

```
GitHub Actions (scheduled + manual)
  ESPN scores/fields  +  Open-Meteo weather
        │  → parquet cache (.gitignored)
        ▼
  features (decayed score rating · course affinity · field strength · weather/wave)
        │  ── as-of firewall (no lookahead) ──►
        ▼
  model (shrunk rating → expected strokes → skew-normal Monte-Carlo distribution)
        ├─► predictions (expected score + interval)  → docs/data/*.json
        └─► backtest (walk-forward vs actual scores)  → docs/data/backtest/summary.json
        ▼
  Vite + React build → docs/ → GitHub Pages (browser only reads committed JSON)
```

## Quick start (no network needed)

```bash
make setup            # install python deps + generate sample data
make pipeline         # predict on bundled SAMPLE data → docs/data/*.json
make backtest         # score-prediction backtest → docs/data/backtest/summary.json
make web-build        # build the dashboard into docs/
make test             # run the test suite
```

## Live (free) data

```bash
make pipeline SOURCE=live                          # real ESPN predictions for the next round
python -m golfmodel run-backtest --source live --year 2026   # test on this year's rounds
```

Add real venues (lat/lon, par, exposure, cluster) to `config/courses.yaml` keyed by the
slug of the ESPN event name (e.g. `u_s_open`) so weather and course affinity bind.

## The backtest

For each played round in the test year, the model is rebuilt from data dated **strictly
before** that round (the `asof` firewall) and compared to the score that actually
happened. Metrics: RMSE / MAE vs a naive season-to-date-mean baseline, 80% interval
coverage, and CRPS — plus predicted-vs-actual scatter, error histogram, and per-round /
per-event breakdowns. The dashboard's **Backtest** tab renders all of it.

## Deploy (GitHub Pages)

Settings → Pages → Deploy from a branch → **folder `/docs`**. The pipeline workflow
refreshes predictions and rebuilds the site on a schedule.

## Honest limitations

- No strokes-gained categories (paid-only) → single score-based rating.
- ESPN's free feed usually omits tee times, so the AM/PM **wave** split degrades to
  course-day weather unless tee times are present.
- Single-round golf is mostly noise: even a good model sits near a ~3-stroke RMSE floor.
  The model is unbiased and well-calibrated and beats the naive baseline by a few percent —
  which is about the realistic ceiling.
