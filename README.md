# GolfModel — Single-Round Score Over/Under Value Model (free-data)

> ⚠️ **ACADEMIC EXERCISE — NOT BETTING ADVICE.** A personal/educational study of
> statistical modeling and forecast calibration. Nothing here is a recommendation to
> place a wager. Respect every data provider's terms of service. Do not bet real money.

GolfModel estimates each PGA golfer's **expected single-round score** plus a **predictive
interval**, converts that into a probability for an Over/Under line, removes the book's
vig, and ranks the **best-value** bets. It **back-tests** the engine walk-forward (no
lookahead). It runs entirely on **free data**.

## Free-data design

| Need | Source | Cost |
|---|---|---|
| Round scores, fields, tee times | **ESPN** public golf JSON API | free, no key |
| Weather (wind/precip/temp) | **Open-Meteo** (forecast + historical archive) | free, no key |
| FanDuel round-O/U lines | **manual capture** (`scripts/capture_lines.py`) + optional **The Odds API** free tier | free |
| Sample data | bundled synthetic (runs with no network) | n/a |

**No strokes-gained.** Per-round strokes-gained is paid-only (ShotLink/DataGolf), so this
build uses a **score-based rating** instead: each golfer's time-decayed *strokes gained vs
the field*, empirical-Bayes shrunk toward an average tour player, blended with a
**course/cluster-specific** rating for course affinity. It keeps recent form, course
history, similar-field strength, weather, playing-partner term, expected score + interval,
and the value board — it just can't decompose skill into OTT/APP/ARG/PUTT.

## How it works

```
GitHub Actions (scheduled + manual)
  ESPN scores/fields  +  Open-Meteo weather  +  manual/Odds lines
        │  → parquet cache (.gitignored)
        ▼
  features (decayed score rating · course affinity · field strength · weather/wave)
        │  ── as-of firewall (no lookahead) ──►
        ▼
  model (shrunk rating → expected strokes → skew-normal Monte-Carlo distribution)
        ├─► betting (vig removal, edge/EV, ranking)  → docs/data/*.json
        └─► backtest (walk-forward, metrics)         → docs/data/backtest/*.json
        ▼
  Vite + React build → docs/ → GitHub Pages (browser only reads committed JSON)
```

## Quick start (no network needed)

```bash
make setup            # install python deps + generate sample data
make pipeline         # run on bundled SAMPLE data → docs/data/*.json
make backtest         # walk-forward backtest → docs/data/backtest/summary.json
make web-build        # build the React dashboard into docs/
make test             # run the test suite
```

## Live (free) data

```bash
make pipeline SOURCE=live     # pull real ESPN scores/fields + Open-Meteo weather
```

Optional: set `ODDS_API_KEY` (The Odds API free tier) for any available FanDuel round
props, and hand-capture lines with `python scripts/capture_lines.py ...`. Add real venues
(lat/lon, par, exposure, cluster) to `config/courses.yaml` keyed by the slug of the ESPN
event name (e.g. `u_s_open`) so weather and course affinity bind.

## Deploy (GitHub Pages)

Settings → Pages → Deploy from a branch → **folder `/docs`**. The pipeline workflow
refreshes predictions and rebuilds the site on a schedule.

## Honest limitations

- No strokes-gained categories (paid-only) → single score-based rating.
- ESPN's free feed usually omits tee times, so the AM/PM **wave** split degrades to
  course-day weather unless tee times are present.
- Round-O/U lines are niche; real backtest ROI/CLV needs captured FanDuel prices. The
  bundled backtest reports prediction accuracy + O/U calibration and a *synthetic* ROI.
