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
    """Course metadata keyed by course_id (slug of the ESPN event name)."""
    return _read_yaml(CONFIG_DIR / "courses.yaml").get("courses", {})


def course_meta(course_id: str | None) -> dict[str, Any]:
    """Course metadata with sane defaults for unknown courses."""
    default = {
        "name": course_id or "Unknown",
        "par": settings()["environment"]["default_par"],
        "lat": None,
        "lon": None,
        "exposure": 0.4,
        "cluster": None,
    }
    return {**default, **courses().get(course_id, {})}


@lru_cache(maxsize=1)
def tours() -> dict[str, Any]:
    return _read_yaml(CONFIG_DIR / "tours.yaml")


def secret(name: str) -> str | None:
    """Read an API key from the environment (never hardcode keys)."""
    val = os.environ.get(name)
    return val or None
