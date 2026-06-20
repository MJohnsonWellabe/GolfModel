# GolfModel — Single-Round Score Over/Under Value Model

> ⚠️ **ACADEMIC EXERCISE — NOT BETTING ADVICE.** This project is a personal/educational
> study of statistical modeling and forecast calibration. Nothing here is a recommendation
> to place a wager. Respect the terms of service of every data provider. Do not use this to
> bet real money.

GolfModel estimates each PGA golfer's **expected single-round score** plus a **predictive
interval**, converts that into a probability for an Over/Under (and matchup / outright)
betting line, removes the book's vig, and ranks the **best-value** bets. It then
**back-tests** the engine against tournaments with strict walk-forward (no lookahead).

## How it works

```
GitHub Actions (scheduled + manual)
  fetch data (DataGolf, The Odds API, Open-Meteo weather, manual lines)
        │  → parquet cache (.gitignored)
        ▼
  features (decayed SG · course-fit · field strength · weather/wave · partners)
        │  ── asof firewall (no lookahead) ──►
        ▼
  model (shrunk baseline → SG→strokes → Monte-Carlo predictive distribution)
        ├─► betting (vig removal, edge / EV, ranking)  → docs/data/*.json
        └─► backtest (walk-forward, metrics)           → docs/data/backtest/*.json
        ▼
  Vite + React build → docs/  → GitHub Pages (browser only reads committed JSON)
```

The browser never calls an API or sees a key — it only fetches static JSON that the
pipeline committed. Paid API keys live exclusively in GitHub Actions secrets.

## Quick start (no secrets required)

```bash
make setup            # install python deps + generate sample data
make pipeline         # run the model on bundled SAMPLE data → writes docs/data/*.json
make web-build        # build the React dashboard into docs/
make web-dev          # or: live-reload dev server for the dashboard
make test             # run the test suite
```

`make pipeline` defaults to `SOURCE=sample`, so it runs end-to-end with **zero secrets**
using bundled synthetic data. That is the thin slice that proves the whole pipe.

## Real data

Set keys (locally in a `.gitignored` `.env`, or as GitHub Actions secrets):

```
DATAGOLF_API_KEY=...     # DataGolf Scratch Plus
ODDS_API_KEY=...         # The Odds API
```

Open-Meteo (weather) needs no key. Then:

```bash
make pipeline SOURCE=live
```

## Data sources

| Source | Provides | Key |
|---|---|---|
| **DataGolf** (Scratch Plus) | per-round strokes-gained (OTT/APP/ARG/PUTT), fields, course-fit, odds archives | paid |
| **The Odds API** | live FanDuel lines | paid |
| **Open-Meteo** | hourly + historical weather by course lat/lon | free, no key |
| **Manual lines** | captured FanDuel round-score O/U lines (`data/manual/lines_manual.csv`) | n/a |
| **Sample** | bundled synthetic data so the app runs with no keys | n/a |

See [`docs/`](docs/) for the published site and `golfmodel/` for the package.
The full design lives in the project plan; key modules are documented inline.
