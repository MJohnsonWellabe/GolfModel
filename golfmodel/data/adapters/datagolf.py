"""DataGolf (Scratch Plus) adapter — per-round strokes-gained, fields, odds archives.

Requires DATAGOLF_API_KEY. Network calls are cached (data/raw). Endpoints follow
DataGolf's documented API; field mapping normalizes into the canonical schema.
Returns empty frames (rather than raising) when the key is absent so the registry
can fall back gracefully.
"""
from __future__ import annotations

from datetime import datetime

import pandas as pd
import requests

from ...config import secret
from ..base import DataAdapter
from ..cache import cached_json
from ..schemas import SG_CATEGORIES

BASE = "https://feeds.datagolf.com"
_DG_SG = {  # DataGolf field name -> canonical
    "sg_ott": "sg_ott",
    "sg_app": "sg_app",
    "sg_arg": "sg_arg",
    "sg_putt": "sg_putt",
    "sg_total": "sg_total",
}


class DataGolfAdapter(DataAdapter):
    name = "datagolf"

    def __init__(self) -> None:
        self.key = secret("DATAGOLF_API_KEY")

    def available(self) -> bool:
        return bool(self.key)

    def _get(self, endpoint: str, params: dict) -> object:
        params = {**params, "key": self.key, "file_format": "json"}

        def fetch():
            r = requests.get(f"{BASE}/{endpoint}", params=params, timeout=30)
            r.raise_for_status()
            return r.json()

        cache_params = {k: v for k, v in params.items() if k != "key"}
        return cached_json("datagolf", endpoint.replace("/", "_"), cache_params, fetch)

    def rounds_sg(self, asof: datetime | None = None) -> pd.DataFrame:
        if not self.available():
            return pd.DataFrame()
        # historical-raw-data/rounds returns per-round stats incl. strokes-gained.
        try:
            payload = self._get("historical-raw-data/rounds", {"tour": "pga", "year": _years(asof)})
        except Exception:  # pragma: no cover - network/credential failure
            return pd.DataFrame()
        rows = payload.get("rounds", payload) if isinstance(payload, dict) else payload
        recs = []
        for r in rows or []:
            rec = {
                "player_id": str(r.get("dg_id", r.get("player_id", ""))),
                "player_name": r.get("player_name", ""),
                "event_id": str(r.get("event_id", r.get("event_name", ""))),
                "course_id": str(r.get("course_id", r.get("course_name", ""))),
                "tour": r.get("tour", "pga"),
                "date": r.get("date") or r.get("teetime"),
                "round_num": int(r.get("round_num", r.get("round", 1)) or 1),
                "score": r.get("score"),
                "to_par": r.get("score_to_par", r.get("round_score")),
            }
            for cat in SG_CATEGORIES + ["sg_total"]:
                rec[cat] = r.get(_DG_SG.get(cat, cat))
            recs.append(rec)
        df = pd.DataFrame(recs)
        if asof is not None and not df.empty:
            df = df[pd.to_datetime(df["date"], errors="coerce") < pd.Timestamp(asof)]
        return df

    def field(self, event_id=None, round_num=None, asof=None) -> pd.DataFrame:
        if not self.available():
            return pd.DataFrame()
        try:
            payload = self._get("field-updates", {"tour": "pga"})
        except Exception:  # pragma: no cover
            return pd.DataFrame()
        recs = []
        for r in (payload.get("field", []) if isinstance(payload, dict) else []):
            recs.append(
                {
                    "event_id": str(event_id or payload.get("event_name", "")),
                    "course_id": str(payload.get("course_id", payload.get("course", ""))),
                    "round_num": int(round_num or payload.get("current_round", 1)),
                    "player_id": str(r.get("dg_id", "")),
                    "player_name": r.get("player_name", ""),
                    "tee_time": r.get(f"r{round_num}_teetime") or r.get("teetime"),
                    "wave": "",
                    "group_id": str(r.get("group", "")),
                }
            )
        return pd.DataFrame(recs)

    def lines(self, event_id=None, round_num=None, asof=None) -> pd.DataFrame:
        # DataGolf odds archives cover matchups/3-balls/outrights (not round-O/U).
        if not self.available():
            return pd.DataFrame()
        try:
            payload = self._get("betting-tools/matchups", {"tour": "pga", "market": "round_matchups", "book": "fanduel"})
        except Exception:  # pragma: no cover
            return pd.DataFrame()
        recs = []
        for r in (payload.get("matchups", []) if isinstance(payload, dict) else []):
            recs.append(
                {
                    "market": "matchup",
                    "book": "FanDuel",
                    "event_id": str(event_id or ""),
                    "round_num": int(round_num or 0),
                    "player_id": str(r.get("p1_dg_id", "")),
                    "line": 0.0,
                    "over_price": r.get("p1_price"),
                    "under_price": r.get("p2_price"),
                    "captured_at": payload.get("last_updated"),
                    "opponent_id": str(r.get("p2_dg_id", "")),
                }
            )
        return pd.DataFrame(recs)


def _years(asof: datetime | None) -> str:
    year = (asof or datetime.utcnow()).year
    return f"{year-1},{year}"
