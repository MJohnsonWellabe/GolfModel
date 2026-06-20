"""ESPN free golf API adapter — scores, fields, (best-effort) tee times.

No key required. ESPN's unofficial public JSON feeds:
  - scoreboard?dates=YYYYMMDD-YYYYMMDD  -> events with per-competitor linescores
  - scoreboard (default)                -> current/most-recent event + competitors
  - summary?event=ID                    -> venue + (sometimes) tee times

Per-round scores come from each competitor's ``linescores`` (period = round
number, value = round score, displayValue = to-par string). Tee times/venue are
often absent in the free feed, so wave defaults to a single 'all' wave and the
weather feature applies course-day conditions without an AM/PM split.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd

from ..base import DataAdapter
from ..cache import cached_json
from ..course_map import course_id_for_event, slugify

BASE = "https://site.api.espn.com/apis/site/v2/sports/golf/pga"
_UA = {"User-Agent": "Mozilla/5.0 (GolfModel academic)"}
HISTORY_DAYS = 540


def _get(endpoint: str, params: dict, *, cache_key: str | None = None) -> dict:
    import requests

    def fetch():
        r = requests.get(f"{BASE}/{endpoint}", params=params, headers=_UA, timeout=30)
        r.raise_for_status()
        return r.json()

    return cached_json("espn", cache_key or endpoint, params, fetch)


def _parse_event_rounds(ev: dict) -> list[dict]:
    """Extract per-round score rows for every competitor in one event."""
    comp = (ev.get("competitions") or [{}])[0]
    event_id = str(ev.get("id", ""))
    event_name = ev.get("name", event_id)
    course_id = course_id_for_event(event_name)
    date = ev.get("date")
    rows = []
    for c in comp.get("competitors", []):
        ath = c.get("athlete", {})
        pname = ath.get("displayName") or ath.get("fullName") or ""
        pid = slugify(pname)  # ESPN omits athlete ids here; name slug is the stable join key
        if not pid:
            continue
        for ls in c.get("linescores", []) or []:
            period = ls.get("period")
            value = ls.get("value")
            to_par = _to_par_from_display(ls.get("displayValue"))
            if period is None or value is None or to_par is None:
                continue
            # Skip in-progress/partial rounds: a completed round has 18 holes and a
            # par that lands in a sane range (value - to_par).
            holes = ls.get("linescores") or []
            par = value - to_par
            if len(holes) and len(holes) < 18:
                continue
            if not (66 <= par <= 74):  # implausible par => partial/garbled round
                continue
            rows.append(
                {
                    "player_id": pid,
                    "player_name": pname,
                    "event_id": event_id,
                    "course_id": course_id,
                    "tour": "pga",
                    "date": date,
                    "round_num": int(period),
                    "score": float(value),
                    "to_par": float(to_par),
                    "par": int(round(par)),
                }
            )
    return rows


def _to_par_from_display(disp) -> float | None:
    if disp is None:
        return None
    s = str(disp).strip()
    if s in ("E", "e", "Even", "EVEN"):
        return 0.0
    try:
        return float(s.replace("+", ""))
    except ValueError:
        return None


class EspnAdapter(DataAdapter):
    name = "espn"

    def available(self) -> bool:
        return True

    # --- history: scores across the recent window ---
    def rounds(self, asof: datetime | None = None) -> pd.DataFrame:
        end = pd.Timestamp(asof or datetime.utcnow())
        start = end - pd.Timedelta(days=HISTORY_DAYS)
        rows: list[dict] = []
        # Walk month-sized windows to keep each response small.
        cursor = start
        while cursor < end:
            wnd_end = min(cursor + pd.Timedelta(days=45), end)
            q = f"{cursor.strftime('%Y%m%d')}-{wnd_end.strftime('%Y%m%d')}"
            try:
                payload = _get("scoreboard", {"dates": q, "limit": 200}, cache_key=f"scoreboard_{q}")
            except Exception:  # pragma: no cover - network
                cursor = wnd_end + pd.Timedelta(days=1)
                continue
            for ev in payload.get("events", []):
                rows.extend(_parse_event_rounds(ev))
            cursor = wnd_end + pd.Timedelta(days=1)
        df = pd.DataFrame(rows)
        if not df.empty:
            df = df.drop_duplicates(["player_id", "event_id", "round_num"])
        # Date normalization + the as-of cutoff are applied centrally (schema
        # validation normalizes tz; the pipeline's as-of firewall drops futures).
        return df

    def _current_event(self) -> dict | None:
        try:
            payload = _get("scoreboard", {}, cache_key="scoreboard_current")
        except Exception:  # pragma: no cover
            return None
        evs = payload.get("events", [])
        return evs[0] if evs else None

    # --- upcoming field for the target round ---
    def field(self, event_id=None, round_num=None, asof=None) -> pd.DataFrame:
        ev = None
        if event_id:
            try:
                payload = _get("scoreboard", {"event": event_id}, cache_key=f"event_{event_id}")
                ev = (payload.get("events") or [None])[0]
            except Exception:  # pragma: no cover
                ev = None
        if ev is None:
            ev = self._current_event()
        if ev is None:
            return pd.DataFrame()

        comp = (ev.get("competitions") or [{}])[0]
        ev_id = str(ev.get("id", ""))
        course_id = course_id_for_event(ev.get("name", ev_id))
        # next round = (max completed round across field) + 1
        max_round = 0
        for c in comp.get("competitors", []):
            for ls in c.get("linescores", []) or []:
                if ls.get("value") is not None:
                    max_round = max(max_round, int(ls.get("period", 0)))
        rnd = int(round_num) if round_num else max(1, max_round + 1)

        rows = []
        for c in comp.get("competitors", []):
            ath = c.get("athlete", {})
            pname = ath.get("displayName") or ath.get("fullName") or ""
            if not pname:
                continue
            tee = _competitor_tee_time(c, rnd)
            rows.append(
                {
                    "event_id": ev_id,
                    "course_id": course_id,
                    "round_num": rnd,
                    "player_id": slugify(pname),
                    "player_name": pname,
                    "tee_time": tee,
                    "wave": _wave_from_tee(tee),
                    "group_id": "",
                }
            )
        return pd.DataFrame(rows)


def _competitor_tee_time(c: dict, rnd: int):
    for ls in c.get("linescores", []) or []:
        if int(ls.get("period", -1)) == rnd and ls.get("teeTime"):
            return ls.get("teeTime")
    return c.get("status", {}).get("teeTime") if isinstance(c.get("status"), dict) else None


def _wave_from_tee(tee) -> str:
    if not tee:
        return "all"
    try:
        hour = pd.Timestamp(tee).hour
        return "AM" if hour < 12 else "PM"
    except Exception:
        return "all"
