"""Run manifest: metadata + disclaimer the frontend pins in its header."""
from __future__ import annotations

from datetime import datetime, timezone

from ..config import course_meta
from ..model.pipeline import PipelineResult

SCHEMA = 1
DISCLAIMER = "ACADEMIC EXERCISE — NOT BETTING ADVICE. For educational use only."


def build_manifest(result: PipelineResult) -> dict:
    cmeta = course_meta(result.course_id)
    n_actionable = int(result.board["actionable"].sum()) if "actionable" in result.board.columns else 0
    return {
        "schema": SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": DISCLAIMER,
        "event_id": result.event_id,
        "course_id": result.course_id,
        "course_name": cmeta.get("name"),
        "round_num": result.round_num,
        "par": result.env_par,
        "course_base_to_par": round(result.course_base, 2),
        "field_strength": round(result.field_strength, 3),
        "n_players": int(len(result.summary)),
        "n_bets": int(len(result.board)),
        "n_actionable": n_actionable,
        "wave_wind": {k: round(v, 1) for k, v in result.wave_wind.items()},
        "course_fit": {k: round(v, 3) for k, v in result.multipliers.items()},
        "sources": result.sources,
    }
