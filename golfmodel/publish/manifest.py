"""Run manifest: metadata + disclaimer the frontend pins in its header."""
from __future__ import annotations

from datetime import datetime, timezone

from ..config import course_meta
from ..model.pipeline import PipelineResult

SCHEMA = 3  # score-prediction model (betting removed)
DISCLAIMER = "ACADEMIC EXERCISE — score prediction only. Not betting advice."


def build_manifest(result: PipelineResult) -> dict:
    cmeta = course_meta(result.course_id)
    return {
        "schema": SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": DISCLAIMER,
        "model": "score-based rating (free data)",
        "event_id": result.event_id,
        "course_id": result.course_id,
        "course_name": cmeta.get("name"),
        "round_num": result.round_num,
        "par": result.env_par,
        "course_base_to_par": round(result.course_base, 2),
        "field_strength": round(result.field_strength, 3),
        "n_players": int(len(result.summary)),
        "wave_wind": {k: round(v, 1) for k, v in result.wave_wind.items()},
        "sources": result.sources,
    }
