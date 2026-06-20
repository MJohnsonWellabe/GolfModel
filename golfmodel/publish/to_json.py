"""Write the published JSON artifacts into docs/data for the static site."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import DOCS_DATA_DIR, course_meta
from ..data.base import DataBundle
from ..data.schemas import SG_CATEGORIES
from ..model.pipeline import PipelineResult
from .manifest import DISCLAIMER, SCHEMA, build_manifest


def _write(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=str))


def _histogram(sims_col: np.ndarray, bins: int = 24) -> dict:
    counts, edges = np.histogram(sims_col, bins=bins)
    return {"counts": counts.tolist(), "edges": [round(float(e), 2) for e in edges]}


def publish_event(result: PipelineResult, bundle: DataBundle, out_dir: Path | None = None) -> dict:
    """Write manifest, value board, and per-golfer files. Returns the manifest."""
    out = out_dir or DOCS_DATA_DIR
    manifest = build_manifest(result)
    _write(out / "manifest.json", manifest)

    # Value board
    board_records = result.board.to_dict(orient="records") if not result.board.empty else []
    _write(
        out / "value_board.json",
        {
            "schema": SCHEMA,
            "disclaimer": DISCLAIMER,
            "generated_at": manifest["generated_at"],
            "event_id": result.event_id,
            "course_name": manifest["course_name"],
            "round_num": result.round_num,
            "bets": board_records,
        },
    )

    # Per-golfer detail
    skills = result.player_skills.set_index("player_id")
    lines = bundle.lines
    rounds = bundle.rounds_sg
    summary_idx = {pid: i for i, pid in enumerate(result.summary["player_id"])}
    index = []
    for _, row in result.summary.iterrows():
        pid = row["player_id"]
        i = summary_idx[pid]
        sg_profile = {c: round(float(skills.loc[pid, c]), 3) for c in SG_CATEGORIES} if pid in skills.index else {}
        recent = (
            rounds[rounds["player_id"] == pid]
            .sort_values("date", ascending=False)
            .head(10)[["date", "course_id", "round_num", "to_par", "sg_total"]]
            .to_dict(orient="records")
        )
        pl = lines[(lines["player_id"] == pid) & (lines.get("market", "round_ou") == "round_ou")] if not lines.empty else lines
        line_obj = pl.iloc[0].to_dict() if not pl.empty else None
        bet = next((b for b in board_records if b["player_id"] == pid), None)
        _write(
            out / "golfers" / f"{pid}.json",
            {
                "schema": SCHEMA,
                "player_id": pid,
                "player_name": row["player_name"],
                "wave": row.get("wave", ""),
                "sg_profile": sg_profile,
                "course_fit": {k: round(v, 3) for k, v in result.multipliers.items()},
                "expected": {
                    "e_score": round(float(row["e_score"]), 2),
                    "p10": round(float(row["p10"]), 2),
                    "p50": round(float(row["p50"]), 2),
                    "p90": round(float(row["p90"]), 2),
                    "sd": round(float(row["sd_sim"]), 2),
                },
                "line": line_obj,
                "bet": bet,
                "distribution": _histogram(result.sims[:, i]),
                "recent_rounds": recent,
            },
        )
        index.append({"player_id": pid, "player_name": row["player_name"]})

    _write(out / "golfers" / "index.json", {"schema": SCHEMA, "players": index})
    return manifest
