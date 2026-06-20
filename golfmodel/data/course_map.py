"""Map ESPN event names to stable course ids.

ESPN's free feed often omits venue/coordinates, so we identify a course by a slug
of its (recurring) event name. ``config/courses.yaml`` can then attach lat/lon
(for Open-Meteo weather), par, exposure, and an optional similarity ``cluster``.
Unknown events still get a stable slug id; they simply fall back to neutral
weather/affinity until added to the config.
"""
from __future__ import annotations

import re


def slugify(name: str) -> str:
    s = (name or "").lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s or "unknown_event"


def course_id_for_event(event_name: str) -> str:
    return slugify(event_name)
