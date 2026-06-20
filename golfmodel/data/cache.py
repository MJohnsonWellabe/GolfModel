"""Content-addressed parquet/JSON cache for raw API responses.

Keyed on (adapter, endpoint, params, asof) so a given fetch is reproducible and
re-runs are cheap. Lives under data/raw and data/interim (both .gitignored).
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from ..config import DATA_DIR

RAW_DIR = DATA_DIR / "raw"
INTERIM_DIR = DATA_DIR / "interim"


def _key(adapter: str, endpoint: str, params: dict[str, Any]) -> str:
    blob = json.dumps({"a": adapter, "e": endpoint, "p": params}, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def cached_json(adapter: str, endpoint: str, params: dict[str, Any], fetch: Callable[[], Any]) -> Any:
    """Return cached JSON for this request, else fetch + store it."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / adapter / f"{endpoint}_{_key(adapter, endpoint, params)}.json"
    if path.exists():
        return json.loads(path.read_text())
    data = fetch()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, default=str))
    return data


def cached_frame(name: str, build: Callable[[], pd.DataFrame], *, refresh: bool = False) -> pd.DataFrame:
    """Cache a normalized analytical table as parquet under data/interim."""
    INTERIM_DIR.mkdir(parents=True, exist_ok=True)
    path = INTERIM_DIR / f"{name}.parquet"
    if path.exists() and not refresh:
        return pd.read_parquet(path)
    df = build()
    df.to_parquet(path, index=False)
    return df


def clear() -> None:  # pragma: no cover - maintenance helper
    for d in (RAW_DIR, INTERIM_DIR):
        if d.exists():
            for p in d.rglob("*"):
                if p.is_file():
                    p.unlink()
