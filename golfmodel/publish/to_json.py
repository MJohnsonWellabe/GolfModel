"""Write the published JSON artifacts into docs/data for the static site."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from ..config import DOCS_DATA_DIR
from ..data.base import DataBundle
from ..model.pipeline import PipelineResult
from .manifest import DISCLAIMER, SCHEMA, build_manifest


def _write(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=str))


def _histogram(sims_col: np.ndarray, bins: int = 24) -> dict:
    counts, edges = np.histogram(sims_col, bins=bins)
    return {"counts": counts.tolist(), "edges": [round(float(e), 2) for e in edges]}


def publish_event(result: PipelineResult, bundle: DataBundle, out_dir: Path | None = None) -> dict:
    out = out_dir or DOCS_DATA_DIR
    manifest = build_manifest(result)
    _write(out / "manifest.json", manifest)

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

    skills = result.player_skills.set_index("player_id")
    lines = bundle.lines
    rounds = bundle.rounds
    summary_idx = {pid: i for i, pid in enumerate(result.summary["player_id"])}
    index = []
    for _, row in result.summary.iterrows():
        pid = row["player_id"]
        i = summary_idx[pid]
        recent = (
            rounds[rounds["player_id"] == pid]
            .sort_values("date", ascending=False)
            .head(10)[["date", "course_id", "round_num", "to_par"]]
            .to_dict(orient="records")
        )
        course_hist = rounds[(rounds["player_id"] == pid) & (rounds["course_id"] == result.course_id)]
        pl = lines[(lines["player_id"] == pid) & (lines.get("market", "round_ou") == "round_ou")] if not lines.empty else lines
        line_obj = pl.iloc[0].to_dict() if not pl.empty else None
        bet = next((b for b in board_records if b["player_id"] == pid), None)
        rating = {
            "skill": round(float(skills.loc[pid, "skill"]), 3) if pid in skills.index else None,
            "skill_overall": round(float(skills.loc[pid, "skill_overall"]), 3) if pid in skills.index else None,
            "n_eff": round(float(skills.loc[pid, "n_eff"]), 1) if pid in skills.index else 0,
            "n_course": round(float(skills.loc[pid, "n_course"]), 1) if pid in skills.index else 0,
            "course_rounds_played": int(len(course_hist)),
        }
        _write(
            out / "golfers" / f"{pid}.json",
            {
                "schema": SCHEMA,
                "player_id": pid,
                "player_name": row["player_name"],
                "wave": row.get("wave", ""),
                "rating": rating,
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
