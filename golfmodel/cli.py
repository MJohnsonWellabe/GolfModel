"""Command-line interface: run the pipeline, the backtest, or regenerate samples."""
from __future__ import annotations

import json

import typer

from .config import DOCS_DATA_DIR, settings

app = typer.Typer(add_completion=False, help="GolfModel — academic round-score O/U value model.")


@app.command("run-pipeline")
def run_pipeline(
    source: str = typer.Option("sample", help="sample | live"),
    event: str = typer.Option(None, help="event id (optional)"),
    round: int = typer.Option(None, help="round number (optional)"),
):
    """Predict the upcoming round and write docs/data/*.json."""
    from .data.registry import load_bundle
    from .model.pipeline import run_event
    from .publish.to_json import publish_event

    bundle = load_bundle(source=source, event_id=event, round_num=round)
    result = run_event(bundle, settings())
    manifest = publish_event(result, bundle)

    typer.echo(
        f"[{source}] event {manifest['event_id']} {manifest['course_name']} "
        f"R{manifest['round_num']} | players={manifest['n_players']} "
        f"bets={manifest['n_bets']} actionable={manifest['n_actionable']} "
        f"sources={manifest['sources']}"
    )
    if not result.board.empty:
        top = result.board.head(5)[["player_name", "side", "line", "price", "edge", "ev_per_unit"]]
        typer.echo(top.to_string(index=False))


@app.command("run-backtest")
def run_backtest_cmd(
    source: str = typer.Option("sample", help="sample | live"),
    n_sims: int = typer.Option(4000, help="Monte-Carlo sims per round"),
):
    """Walk-forward backtest and write docs/data/backtest/summary.json."""
    from .backtest.walkforward import run_backtest
    from .data.adapters.sample import SampleAdapter
    from .data.registry import load_bundle

    if source == "sample":
        rounds = SampleAdapter().rounds_sg(None)
    else:
        rounds = load_bundle(source="live").rounds_sg

    summary = run_backtest(rounds, settings(), n_sims=n_sims)
    out = DOCS_DATA_DIR / "backtest" / "summary.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"schema": 1, **summary}, indent=2, default=str))

    typer.echo(f"Backtest: {summary.get('n_predictions', 0)} predictions -> {out}")
    if summary.get("n_predictions"):
        p = summary["prediction"]
        typer.echo(
            f"  RMSE {p['rmse']} (naive {p['rmse_naive']}) | coverage80 "
            f"{p['interval_coverage_80']} | CRPS {p['crps']} | "
            f"O/U Brier {summary['over_under']['brier']} (0.5-baseline "
            f"{summary['over_under']['brier_baseline_0.5']})"
        )


@app.command("generate-sample")
def generate_sample_cmd():
    """(Re)generate the bundled synthetic sample data."""
    from .data.generate_sample import generate

    meta = generate()
    typer.echo(f"Sample data generated for {meta['event_id']} ({meta['course_id']} R{meta['round_num']}).")


if __name__ == "__main__":
    app()
