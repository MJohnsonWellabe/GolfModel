"""Configuration loading: YAML settings + course metadata + environment/secrets.

Paths are resolved relative to the repo root so the package works from any CWD.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

try:  # optional: load a local .gitignored .env for live runs
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover - dotenv is optional
    pass

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = REPO_ROOT / "config"
DATA_DIR = REPO_ROOT / "data"
DOCS_DATA_DIR = REPO_ROOT / "docs" / "data"


def _read_yaml(path: Path) -> dict[str, Any]:
    with open(path) as fh:
        return yaml.safe_load(fh) or {}


@lru_cache(maxsize=1)
def settings() -> dict[str, Any]:
    """Global model/pipeline parameters from config/settings.yaml."""
    return _read_yaml(CONFIG_DIR / "settings.yaml")


@lru_cache(maxsize=1)
def courses() -> dict[str, dict[str, Any]]:
    """Course metadata keyed by course_id, with normalized attribute priors."""
    raw = _read_yaml(CONFIG_DIR / "courses.yaml").get("courses", {})
    out: dict[str, dict[str, Any]] = {}
    cats = settings()["baseline"]["categories"]
    for cid, meta in raw.items():
        meta = dict(meta)
        prior = meta.get("attribute_prior", {c: 1.0 for c in cats})
        # Normalize so the prior multipliers average to 1 across categories
        # (neutral course == all 1s == plain SG total).
        vals = [float(prior.get(c, 1.0)) for c in cats]
        mean = sum(vals) / len(vals) if vals else 1.0
        meta["attribute_prior"] = {c: float(prior.get(c, 1.0)) / mean for c in cats}
        out[cid] = meta
    return out


def course_meta(course_id: str) -> dict[str, Any]:
    """Course metadata with sane defaults for unknown courses."""
    cats = settings()["baseline"]["categories"]
    default = {
        "name": course_id,
        "par": settings()["environment"]["default_par"],
        "yardage": 7100,
        "lat": None,
        "lon": None,
        "exposure": 0.4,
        "attribute_prior": {c: 1.0 for c in cats},
    }
    return {**default, **courses().get(course_id, {})}


@lru_cache(maxsize=1)
def tours() -> dict[str, Any]:
    return _read_yaml(CONFIG_DIR / "tours.yaml")


def secret(name: str) -> str | None:
    """Read an API key from the environment (never hardcode keys)."""
    val = os.environ.get(name)
    return val or None
