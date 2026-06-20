#!/usr/bin/env python
"""Append a captured FanDuel round-score Over/Under line to the manual store.

Round-O/U is a niche market, so lines are hand-captured. Every captured line is
timestamped and appended to data/manual/lines_manual.csv, building a historical
store over time for backtesting.

Usage:
  python scripts/capture_lines.py --event U001 --round 2 --player P012 \
      --line 70.5 --over -110 --under -110
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
from pathlib import Path

CSV = Path(__file__).resolve().parent.parent / "data" / "manual" / "lines_manual.csv"
HEADER = ["market", "book", "event_id", "round_num", "player_id", "line",
          "over_price", "under_price", "captured_at", "opponent_id"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", required=True)
    ap.add_argument("--round", type=int, required=True)
    ap.add_argument("--player", required=True)
    ap.add_argument("--line", type=float, required=True)
    ap.add_argument("--over", type=int, required=True, help="American over price")
    ap.add_argument("--under", type=int, required=True, help="American under price")
    ap.add_argument("--book", default="FanDuel")
    args = ap.parse_args()

    CSV.parent.mkdir(parents=True, exist_ok=True)
    new_file = not CSV.exists() or CSV.stat().st_size == 0
    with open(CSV, "a", newline="") as fh:
        w = csv.writer(fh)
        if new_file:
            w.writerow(HEADER)
        w.writerow([
            "round_ou", args.book, args.event, args.round, args.player, args.line,
            args.over, args.under, datetime.now(timezone.utc).isoformat(), "",
        ])
    print(f"Captured {args.book} {args.player} R{args.round} O/U {args.line} "
          f"({args.over}/{args.under}) -> {CSV}")


if __name__ == "__main__":
    main()
