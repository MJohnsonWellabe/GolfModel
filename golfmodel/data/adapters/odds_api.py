"""The Odds API adapter — live FanDuel golf lines (best-effort for round-score O/U).

Requires ODDS_API_KEY. Round-score O/U is a thin market; this adapter returns
whatever FanDuel player props are available and leaves the manual-lines adapter
as the authoritative source for that market.
"""
from __future__ import annotations

from datetime import datetime

import pandas as pd
import requests

from ...config import secret
from ..base import DataAdapter
from ..cache import cached_json

BASE = "https://api.the-odds-api.com/v4"


class OddsApiAdapter(DataAdapter):
    name = "odds_api"

    def __init__(self) -> None:
        self.key = secret("ODDS_API_KEY")

    def available(self) -> bool:
        return bool(self.key)

    def lines(self, event_id=None, round_num=None, asof=None) -> pd.DataFrame:
        if not self.available():
            return pd.DataFrame()
        params = {
            "apiKey": self.key,
            "regions": "us",
            "bookmakers": "fanduel",
            "markets": "player_round_score",  # niche; may be empty
            "oddsFormat": "american",
        }

        def fetch():
            r = requests.get(f"{BASE}/sports/golf_pga/odds", params=params, timeout=30)
            r.raise_for_status()
            return r.json()

        try:
            payload = cached_json("odds_api", "golf_odds", {k: v for k, v in params.items() if k != "apiKey"}, fetch)
        except Exception:  # pragma: no cover - network/credential/empty-market
            return pd.DataFrame()

        recs = []
        for ev in payload or []:
            for bk in ev.get("bookmakers", []):
                if bk.get("key") != "fanduel":
                    continue
                for mk in bk.get("markets", []):
                    for oc in mk.get("outcomes", []):
                        recs.append(
                            {
                                "market": "round_ou",
                                "book": "FanDuel",
                                "event_id": str(event_id or ev.get("id", "")),
                                "round_num": int(round_num or 0),
                                "player_id": oc.get("description", oc.get("name", "")),
                                "line": oc.get("point"),
                                "over_price": oc.get("price") if oc.get("name") == "Over" else None,
                                "under_price": oc.get("price") if oc.get("name") == "Under" else None,
                                "captured_at": bk.get("last_update", datetime.utcnow().isoformat()),
                                "opponent_id": "",
                            }
                        )
        return pd.DataFrame(recs)
